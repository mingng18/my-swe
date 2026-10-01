// src/harness/agent-factory.ts
/**
 * Agent factory -- builds a configured DeepAgent instance.
 *
 * Extracted from deepagents.ts so that the factory can be reused by the
 * blueprint compiler's AgentExecutor without pulling in all of the harness
 * (thread management, sandbox resolution, cleanup, etc.).
 */

import { createLogger } from "../utils/logger";
import { loadLlmConfig, loadModelConfig } from "../utils/config";
import { createChatModel } from "../utils/model-factory";
import {
  createDeepAgent,
  FilesystemBackend,
  type DeepAgent,
} from "deepagents";
import {
  isLangfuseEnabled,
} from "../utils/langfuse";
import { MemorySaver } from "@langchain/langgraph";
import {
  modelRetryMiddleware,
  modelFallbackMiddleware,
  toolRetryMiddleware,
  modelCallLimitMiddleware,
  contextEditingMiddleware,
} from "langchain";
import { createProgressiveContextEdit } from "../middleware/progressive-context-edit";
import { createLoopDetectionMiddleware } from "../middleware/loop-detection";
import { createEnsureNoEmptyMsgMiddleware } from "../middleware/ensure-no-empty-msg";
import { createSkillCompactionProtectionMiddleware } from "../middleware/skill-compaction-protection";
import { createCompactionMiddleware } from "../middleware/compact-middleware";
import { CallbackHandler as LangfuseLangChain } from "langfuse-langchain";
import { constructSystemPrompt } from "../prompt";
import { allTools, sandboxAllTools } from "../tools";
import { builtInSubagents } from "../subagents/registry";
import { loadRepoAgents, mergeSubagents } from "../subagents/agentsLoader";
import { asyncSubagents } from "../subagents/async";
import type { SandboxService } from "../integrations/sandbox-service";

const logger = createLogger("agent-factory");

const useSandbox = process.env.USE_SANDBOX === "true";
const AGENT_RECURSION_LIMIT = Number.parseInt(
  process.env.AGENT_RECURSION_LIMIT || "1000",
  10,
);

/**
 * Create a fully-configured DeepAgent instance.
 *
 * This is the same code that was previously inlined in deepagents.ts.
 *
 * @param args.workspaceRoot - Optional workspace root for MCP tools and system prompt
 * @param args.backend - Optional backend (SandboxService or FilesystemBackend)
 */
export async function createAgentInstance(args: {
  workspaceRoot?: string;
  backend?: SandboxService | FilesystemBackend;
}): Promise<DeepAgent> {
  const modelConfig = loadModelConfig();
  const chatModel = await createChatModel(modelConfig);
  const { fallback } = loadLlmConfig();

  const middleware: unknown[] = [
    // Resilience: automatic retry on transient model errors
    modelRetryMiddleware({
      maxRetries: 3,
      backoffFactor: 2.0,
      initialDelayMs: 750,
    }),
    // Resilience: automatic retry on tool failures
    toolRetryMiddleware({
      maxRetries: 2,
      backoffFactor: 2.0,
      initialDelayMs: 1000,
    }),
    // Limits: prevent runaway agent loops
    modelCallLimitMiddleware({
      runLimit: AGENT_RECURSION_LIMIT,
      exitBehavior: "end",
    }),
    // Skills: protect skill content from context compaction
    createSkillCompactionProtectionMiddleware(),
    // Context management: 4-level compaction cascade
    createCompactionMiddleware({
      model: chatModel,
      modelName: modelConfig.model || "gpt-4o",
      config: {
        cascadeTrigger: process.env.COMPACTION_CASCADE_TRIGGER_FRACTION
          ? {
              type: "fraction",
              value: Math.max(
                0,
                Math.min(
                  1,
                  (() => {
                    const parsed = Number.parseFloat(
                      process.env.COMPACTION_CASCADE_TRIGGER_FRACTION || "",
                    );
                    if (Number.isNaN(parsed)) {
                      logger.warn(
                        { envValue: process.env.COMPACTION_CASCADE_TRIGGER_FRACTION },
                        "[agent-factory] Invalid COMPACTION_CASCADE_TRIGGER_FRACTION, using default 0.7",
                      );
                      return 0.7;
                    }
                    return parsed;
                  })(),
                ),
              ),
            }
          : { type: "fraction", value: 0.7 },
        trigger: process.env.COMPACTION_TRIGGER_FRACTION
          ? {
              type: "fraction",
              value: Number.parseFloat(process.env.COMPACTION_TRIGGER_FRACTION),
            }
          : { type: "fraction", value: 0.85 },
        keep: process.env.COMPACTION_KEEP_MESSAGES
          ? {
              type: "messages",
              value: Number.parseInt(process.env.COMPACTION_KEEP_MESSAGES, 10),
            }
          : { type: "messages", value: 10 },
        maxConsecutiveFailures: Number.parseInt(
          process.env.COMPACTION_MAX_FAILURES || "3",
          10,
        ),
        microcompact: {
          enabled: process.env.COMPACTION_MICROCOMPACT !== "false",
          gapThresholdMinutes: Number.parseInt(
            process.env.COMPACTION_MICROCOMPACT_GAP_MINUTES || "60",
            10,
          ),
        },
        restoration: {
          enabled: process.env.COMPACTION_RESTORATION !== "false",
          maxFiles: Number.parseInt(
            process.env.COMPACTION_RESTORATION_MAX_FILES || "5",
            10,
          ),
        },
      },
    }),
    // Legacy: progressive compaction with message importance scoring
    contextEditingMiddleware({
      edits: [createProgressiveContextEdit()],
    }),
    // Custom: detect and break tool-call loops
    createLoopDetectionMiddleware(),
    // Custom: ensure model always produces meaningful output
    createEnsureNoEmptyMsgMiddleware(),
  ];

  // Add model fallback if configured
  if (fallback) {
    try {
      const fallbackModelConfig = loadModelConfig(fallback);
      const fallbackModel = await createChatModel(fallbackModelConfig);
      middleware.push(modelFallbackMiddleware(fallbackModel));
    } catch (err) {
      logger.warn(
        { err },
        "[agent-factory] Failed to create fallback model, skipping",
      );
    }
  }

  let tools = useSandbox ? sandboxAllTools : allTools;

  // Load MCP tools if enabled and workspace is available
  if (process.env.MCP_ENABLED !== "false" && args.workspaceRoot) {
    try {
      const { loadMcpTools } = await import("../mcp/tool-factory.js");
      const mcpTools = await loadMcpTools(args.workspaceRoot);

      if (mcpTools.length > 0) {
        tools = [...tools, ...mcpTools];
        logger.info(
          { mcpToolCount: mcpTools.length },
          "[agent-factory] MCP tools loaded",
        );
      }
    } catch (err) {
      logger.warn(
        { err },
        "[agent-factory] Failed to load MCP tools, continuing without them",
      );
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const config: Record<string, any> = {
    model: chatModel,
    systemPrompt: constructSystemPrompt(args.workspaceRoot || process.cwd()),
    checkpointer: new MemorySaver(),
    tools,
    middleware,
  };

  // Add LangChain callback for automatic tracing
  if (isLangfuseEnabled()) {
    config.callbacks = [new LangfuseLangChain()];
    logger.debug("[agent-factory] Langfuse LangChain callback registered");
  }

  if (args.backend) {
    config.backend = args.backend;
  }

  // Add subagents if enabled
  if (process.env.SUBAGENTS_ENABLED !== "false") {
    const repoAgentsDir = process.env.REPO_AGENTS_DIR || ".agents/agents";
    const repoAgents = await loadRepoAgents(repoAgentsDir);
    const allSubagents = mergeSubagents(builtInSubagents, repoAgents);

    config.subagents = allSubagents;
    logger.info(
      {
        total: allSubagents.length,
        builtIn: builtInSubagents.length,
        repo: repoAgents.length,
      },
      "[agent-factory] Subagents enabled",
    );
  }

  // Add async subagents if enabled
  if (process.env.ASYNC_SUBAGENTS_ENABLED === "true") {
    config.asyncSubagents = asyncSubagents;
    logger.info(
      { count: asyncSubagents.length },
      "[agent-factory] Async subagents enabled",
    );
  }

  const agent = createDeepAgent(config);
  return agent;
}
