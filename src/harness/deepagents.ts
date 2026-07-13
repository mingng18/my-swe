import { createLogger } from "../utils/logger";
import {
  threadManager,
  threadRepoMap,
  THREAD_TTL_MS,
  type RepoContext,
} from "./thread-manager";
import {
  loadLlmConfig,
  loadModelConfig,
  getRoleModelConfig,
  isArchitectEditorRoutingEnabled,
} from "../utils/config";
import { getMode, getModelOverride, purgeStaleSessions } from "../utils/session-store";
import { createChatModel } from "../utils/model-factory";
import { createDeepAgent, FilesystemBackend, type DeepAgent } from "deepagents";
import {
  isLangfuseEnabled,
  flushLangfuse,
  shutdownLangfuse,
  createTrace,
  maskSensitiveData,
} from "../utils/langfuse";
import {
  startThreadCleanupScheduler,
  stopThreadCleanupScheduler,
  type ThreadMapCleanupFn,
} from "../utils/thread-cleanup-scheduler";
import { CallbackHandler as LangfuseLangChain } from "langfuse-langchain";
import type { BaseCallbackHandler } from "@langchain/core/callbacks/base";
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
import { toolInvocationTracker } from "../middleware/tool-invocation-limits";
import { createSkillCompactionProtectionMiddleware } from "../middleware/skill-compaction-protection";
import { createCompactionMiddleware } from "../middleware/compact-middleware";
import { createAgentFirewallMiddleware } from "../middleware/agent-firewall";
import {
  createHooksMiddleware,
  fireSessionStart,
  registerHooksThreadCleanup,
} from "../hooks";
import type {
  AgentHarness,
  AgentInvokeOptions,
  AgentResponse,
} from "./agentHarness";
import { createMiddleware } from "langchain";
import { constructSystemPrompt } from "../prompt";
import { allTools, sandboxAllTools } from "../tools";
import { writeRepoMemoryAfterAgentTurn } from "../memory/supabaseRepoMemory";
import { openPrIfNeeded } from "../middleware/open-pr";
import {
  gitHasUncommittedChanges,
  gitCleanRepository,
  gitPull,
} from "../utils/github";
import {
  SandboxService,
  createSandboxServiceWithConfig,
} from "../integrations/sandbox-service";
import {
  acquireRepoSandbox,
  releaseRepoSandbox,
  type SandboxProfile,
  getSandboxProfileFromEnv,
} from "../integrations/daytona-pool";
import {
  loadPersistedThreadRepos,
  persistThreadRepo,
  removePersistedThreadRepo,
} from "../utils/thread-metadata-store";
import { clearSandboxBackend, setSandboxBackend } from "../utils/sandboxState";
import { installDependencies } from "../nodes/deterministic/DependencyInstallerNode";
import { builtInSubagents } from "../subagents/registry";
import { loadRepoAgents, mergeSubagents } from "../subagents/agentsLoader";
import { asyncSubagents } from "../subagents/async";
import { type BaseMessage, type ToolCall } from "@langchain/core/messages";
import { type BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  streamRegistry,
  type SSEEvent,
  type LLMStartEvent,
} from "../stream";

const logger = createLogger("deepagents");

// ============================================================================
// SSE Event Emission Helpers
// ============================================================================

/**
 * Emit an event to the SSE stream for a thread
 * Uses buffering to handle cases where client hasn't connected yet
 */
function emitStreamEvent(threadId: string, event: SSEEvent): void {
  streamRegistry.emitEvent(threadId, event);
}

/**
 * Emit todo events (called by middleware)
 */
export function emitTodoEvent(
  threadId: string,
  event:
    | { type: "add"; id: string; subject: string; status: string }
    | { type: "update"; id: string; status: string }
    | { type: "complete"; id: string },
): void {
  if (event.type === "add") {
    emitStreamEvent(threadId, {
      type: "todo_added",
      id: event.id,
      subject: event.subject,
      status: event.status as "pending" | "in_progress" | "completed",
    });
  } else if (event.type === "update") {
    emitStreamEvent(threadId, {
      type: "todo_updated",
      id: event.id,
      status: event.status as "pending" | "in_progress" | "completed",
    });
  } else if (event.type === "complete") {
    emitStreamEvent(threadId, {
      type: "todo_completed",
      id: event.id,
    });
  }
}

const useSandbox = process.env.USE_SANDBOX === "true";
const AGENT_RECURSION_LIMIT = Number.parseInt(
  process.env.AGENT_RECURSION_LIMIT || "1000",
  10,
);
let hasLoadedPersistedRepos = false;

// ============================================================================
// Thread Cleanup Configuration
// ============================================================================

export async function cleanupThreadMaps(
  ttlMs: number = 3600000,
): Promise<number> {
  const before =
    threadManager.threadAgentMap.size +
    threadManager.threadSandboxMap.size +
    threadManager.threadRepoMap.size;
  threadManager.purgeStale();
  const after =
    threadManager.threadAgentMap.size +
    threadManager.threadSandboxMap.size +
    threadManager.threadRepoMap.size;
  return before - after;
}

async function buildMiddleware(
  chatModel: BaseChatModel,
  modelConfig: any,
  fallback?: { openaiBaseUrl?: string; openaiApiKey?: string; model?: string },
): Promise<any[]> {
  const middleware: any[] = [
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
    // Context management: 4-level compaction cascade (COLLAPSE, TRUNCATE, MICROCOMPACT, SUMMARIZE)
    createCompactionMiddleware({
      model: chatModel,
      modelName: modelConfig.model || "gpt-4o",
      config: {
        // Cascade trigger (when to start compaction at all)
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
                        {
                          envValue:
                            process.env.COMPACTION_CASCADE_TRIGGER_FRACTION,
                        },
                        "[deepagents] Invalid COMPACTION_CASCADE_TRIGGER_FRACTION, using default 0.7",
                      );
                      return 0.7;
                    }
                    return parsed;
                  })(),
                ),
              ),
            }
          : { type: "fraction", value: 0.7 },
        // Summarize trigger (when to use expensive LLM summarization)
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
    // Legacy: progressive compaction with message importance scoring (kept as fallback)
    contextEditingMiddleware({
      edits: [createProgressiveContextEdit()],
    }),
    // Custom: detect and break tool-call loops
    createLoopDetectionMiddleware(),
    // Custom: ensure model always produces meaningful output
    createEnsureNoEmptyMsgMiddleware(),
    // Custom: command/network allowlist + cost kill-switch (permissive when unconfigured)
    createAgentFirewallMiddleware(),
    // Custom: event-driven hooks (SessionStart / PreToolUse / PostToolUse); no-op when unconfigured
    createHooksMiddleware(),
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
        "[deepagents] Failed to create fallback model, skipping",
      );
    }
  }

  return middleware;
}

export async function loadAgentTools(
  workspaceRoot?: string,
  opts?: { includeMcp?: boolean },
): Promise<any[]> {
  let tools = useSandbox ? sandboxAllTools : allTools;

  // Load MCP tools if enabled and workspace is available. Plan mode opts out
  // (includeMcp === false) so dynamically-registered MCP server tools — which
  // evade the static PLAN_MODE_BLOCKED_TOOLS denylist — can never write while
  // the agent is planning. (#510)
  if (opts?.includeMcp !== false && process.env.MCP_ENABLED !== "false" && workspaceRoot) {
    try {
      const { loadMcpTools } = await import("../mcp/tool-factory.js");
      const mcpTools = await loadMcpTools(workspaceRoot);

      if (mcpTools.length > 0) {
        tools = [...tools, ...mcpTools];
        logger.info(
          { mcpToolCount: mcpTools.length },
          "[deepagents] MCP tools loaded",
        );
      }
    } catch (err) {
      logger.warn(
        { err },
        "[deepagents] Failed to load MCP tools, continuing without them",
      );
    }
  }

  return tools;
}

/**
 * Tool names that mutate state, run shell, or otherwise make changes. Plan mode
 * (#498) filters these out so "no edits" is enforced at the tool layer rather
 * than relying solely on a natural-language prefix.
 *
 * Kept as a module export so tests can assert the denylist without re-importing.
 */
export const PLAN_MODE_BLOCKED_TOOLS = new Set<string>([
  // PR / GitHub mutations
  "commit_and_open_pr",
  "merge_pr",
  "create_github_issue",
  "comment_github_issue",
  "close_github_issue",
  "reopen_github_issue",
  "github_comment",
  // Shell + sandbox mutations
  "sandbox_shell",
  "sandbox_network",
  "sandbox_delete",
  "sandbox_mkdir",
  "sandbox_move",
  "sandbox_copy",
  "write_sandbox_file",
  // Memory / artifact mutations
  "artifact_delete",
  "artifact_update",
  "memory_forget",
  "rewind_checkpoint",
  // MCP wildcard — can invoke any MCP tool, including mutating ones
  "call_mcp_tool",
]);

function isReadOnlyTool(tool: any): boolean {
  const name: string | undefined = tool?.name;
  if (!name) return false;
  return !PLAN_MODE_BLOCKED_TOOLS.has(name);
}

/**
 * Plan-mode toolset: same load path as `loadAgentTools`, but write/shell/mutation
 * tools are filtered out so the agent physically cannot edit while planning.
 */
export async function loadReadOnlyTools(workspaceRoot?: string): Promise<any[]> {
  // Exclude MCP tools entirely in plan mode (#510): they're loaded as top-level
  // tools and a mutating MCP server tool would evade the static denylist.
  const all = await loadAgentTools(workspaceRoot, { includeMcp: false });
  const filtered = all.filter(isReadOnlyTool);
  const dropped = all.length - filtered.length;
  logger.info(
    { total: all.length, kept: filtered.length, dropped },
    "[deepagents] Plan mode: filtered write/shell/mutation tools (MCP excluded)",
  );
  return filtered;
}

async function configureSubagents(config: any): Promise<void> {
  // Add subagents if enabled
  if (process.env.SUBAGENTS_ENABLED !== "false") {
    // Load repo-specific agents
    const repoAgentsDir = process.env.REPO_AGENTS_DIR || ".agents/agents";
    const repoAgents = await loadRepoAgents(repoAgentsDir);

    // Merge built-in and repo agents
    const allSubagents = mergeSubagents(builtInSubagents, repoAgents);

    config.subagents = allSubagents;
    logger.info(
      {
        total: allSubagents.length,
        builtIn: builtInSubagents.length,
        repo: repoAgents.length,
      },
      "[deepagents] Subagents enabled",
    );
  }

  // Add async subagents if enabled
  if (process.env.ASYNC_SUBAGENTS_ENABLED === "true") {
    config.asyncSubagents = asyncSubagents;
    logger.info(
      { count: asyncSubagents.length },
      "[deepagents] Async subagents enabled",
    );
  }
}

// Per-thread in-memory checkpointer so that rebuilding a thread's agent (e.g.
// when /model changes the model, or /plan<->/act toggles mode) preserves that
// thread's conversation history. The map lives on `threadManager` and is
// bounded (LRU cap + TTL), so a long-lived server can't grow it without limit.
// `threadManager.clearAgent()` deliberately keeps the checkpointer; the TTL
// disposal path (`purgeStale`/`clearAll`) drops both agent and checkpointer.

async function createAgentInstance(args: {
  workspaceRoot?: string;
  backend?: SandboxService | FilesystemBackend;
  threadId?: string;
}): Promise<DeepAgent> {
  // Model selection (#497 Architect/Editor routing):
  // The primary agent's dominant workload is file edits and tool-calls, so it
  // runs on the EDITOR model (cheaper/faster) when the split is enabled. When
  // either ARCHITECT_MODEL or EDITOR_MODEL is unset, getRoleModelConfig returns
  // the single MODEL config exactly as today (no role tag), so default behavior
  // is unchanged. The role tag flows into telemetry/pricing via loadModelConfig.
  let modelConfig = getRoleModelConfig("editor");
  // Per-thread model override (/model). No override = today's single MODEL / EDITOR.
  const override = args.threadId ? getModelOverride(args.threadId) : undefined;
  if (override) {
    modelConfig = { ...modelConfig, model: override };
  }
  if (isArchitectEditorRoutingEnabled()) {
    logger.info(
      {
        editorModel: modelConfig.model,
        architectModel: process.env.ARCHITECT_MODEL,
      },
      "[deepagents] Architect/Editor routing enabled; agent running on EDITOR model",
    );
  }
  const chatModel = await createChatModel(modelConfig);
  const { fallback } = loadLlmConfig();

  const middleware = await buildMiddleware(chatModel, modelConfig, fallback);
  // Plan mode (#498): enforce "no edits" at the tool layer by loading only
  // read-only tools. Mode changes (/plan, /act) recreate the agent via
  // clearAgent(); the per-thread checkpointer preserves history across it.
  const planMode = args.threadId
    ? getMode(args.threadId) === "plan"
    : false;
  const tools = planMode
    ? await loadReadOnlyTools(args.workspaceRoot)
    : await loadAgentTools(args.workspaceRoot);

  const config: any = {
    model: chatModel,
    systemPrompt: constructSystemPrompt(args.workspaceRoot || process.cwd()),
    checkpointer: args.threadId
      ? threadManager.getCheckpointer(args.threadId)
      : new MemorySaver(),
    tools,
    middleware,
  };

  // Add LangChain callback for automatic tracing
  if (isLangfuseEnabled()) {
    config.callbacks = [new LangfuseLangChain()];
    logger.debug("[deepagents] Langfuse LangChain callback registered");
  }

  if (args.backend) {
    config.backend = args.backend;
  }

  await configureSubagents(config);

  const agent = createDeepAgent(config);
  return agent;
}

// ---------------------------------------------------------------------------
// Architect planning step (#497)
// ---------------------------------------------------------------------------
//
// When Architect/Editor routing is enabled (BOTH ARCHITECT_MODEL and EDITOR_MODEL
// set), the editor agent's user message is preceded by a concise plan produced
// by the ARCHITECT model. The architect reasons over the task + repo context and
// emits a short, actionable plan; the editor (the agent itself) then implements
// it. When routing is disabled, this is a no-op and the editor runs exactly as
// today — no extra LLM call, byte-for-byte default behavior.
//
// The call is best-effort: any failure (network, parse, etc.) is swallowed so
// the editor turn still proceeds on the original user message. This avoids
// introducing a new throw across the async invoke path.

const ARCHITECT_PLAN_SYSTEM_PROMPT = `You are the Architect. Produce a concise, actionable implementation plan for the task below. Focus on:
- The specific files/functions to add or change (paths when known).
- The key steps in dependency order (numbered).
- Risks, edge cases, or open questions worth flagging.

Do NOT implement anything. Keep the plan under ~250 words. The editor agent will receive your plan plus the original task and execute it.`;

/**
 * Hard cap on the architect plan length (#497). The prompt asks for ~250 words,
 * but the model can ramble; an unbounded plan bloats the editor's context. We
 * truncate to a generous bound that still leaves room for the original task.
 */
const ARCHITECT_PLAN_MAX_CHARS = 2000;

/**
 * Generate a concise architect plan for a task.
 *
 * Returns the plan text (to be prepended to the editor's user message), or the
 * empty string when routing is disabled or planning fails. Exported for tests.
 *
 * Cost/usage attribution (#497): when `threadId` is supplied, the architect call
 * is wrapped in `llm_start`/`llm_end` stream events tagged with
 * `role: "architect"`, and the LangChain Langfuse callback (when Langfuse is
 * enabled) is attached to the invoke so the architect's tokens are traced —
 * mirroring how the editor turn is instrumented. Without this the architect
 * usage was invisible.
 *
 * Plan size (#497): the plan is truncated to {@link ARCHITECT_PLAN_MAX_CHARS}
 * before being returned, so an over-long plan can't unboundedly inflate the
 * editor's context.
 *
 * Best-effort: any failure (network, parse, etc.) is swallowed so the editor
 * turn still proceeds on the original user message — no new throw crosses the
 * async invoke path.
 *
 * @param options.threadId when provided, stream events are emitted for this
 *   thread and Langfuse tracing is attached. Omit to skip attribution (used by
 *   tests that only assert on the model config).
 */
export async function generateArchitectPlan(
  task: string,
  repoContext?: { owner?: string; name?: string; workspaceDir?: string },
  options?: { threadId?: string },
): Promise<string> {
  if (!isArchitectEditorRoutingEnabled()) return "";

  const threadId = options?.threadId;
  try {
    const modelConfig = getRoleModelConfig("architect");
    const model = await createChatModel(modelConfig);

    const repoLine = repoContext?.owner && repoContext?.name
      ? `\n\nRepo: ${repoContext.owner}/${repoContext.name}`
      : "";
    const userContent = `Task:\n${task}${repoLine}`;

    // Cost/usage attribution (#497): emit llm_start (role='architect') and
    // attach the Langfuse callback when enabled, so the architect's tokens are
    // visible in both the SSE stream and Langfuse — same shape as the editor
    // turn below. Best-effort: the events themselves must never throw.
    const invokeOptions: { callbacks?: BaseCallbackHandler[] } = {};
    if (isLangfuseEnabled()) {
      invokeOptions.callbacks = [new LangfuseLangChain()];
    }
    if (threadId) {
      emitStreamEvent(threadId, {
        type: "llm_start",
        model: modelConfig.model,
        role: "architect",
        timestamp: Date.now(),
      });
    }

    const response = await model.invoke(
      [
        { role: "system", content: ARCHITECT_PLAN_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      invokeOptions,
    );

    const plan =
      typeof response.content === "string"
        ? response.content.trim()
        : "";

    // Unbounded plan size (#497): cap before returning so the editor's context
    // can't be inflated by a rambling architect. Truncate at a sentence/line
    // boundary when possible for readability.
    const cappedPlan = capArchitectPlan(plan, ARCHITECT_PLAN_MAX_CHARS);

    if (threadId) {
      emitStreamEvent(threadId, {
        type: "llm_end",
        totalTokens: Math.round(cappedPlan.length / 4),
        role: "architect",
        timestamp: Date.now(),
      });
    }

    if (!cappedPlan) return "";

    logger.info(
      {
        architectModel: modelConfig.model,
        planLength: cappedPlan.length,
        truncated: plan.length > ARCHITECT_PLAN_MAX_CHARS,
      },
      "[deepagents] Architect plan generated for editor turn",
    );

    return cappedPlan;
  } catch (err) {
    // Best-effort: a planning failure must NOT break the editor turn. Emit a
    // matching llm_end so a streamed llm_start never dangles without a pair.
    if (threadId) {
      try {
        emitStreamEvent(threadId, {
          type: "llm_end",
          totalTokens: 0,
          role: "architect",
          timestamp: Date.now(),
        });
      } catch {
        // Streaming must never break the editor turn.
      }
    }
    logger.warn(
      { err },
      "[deepagents] Architect planning failed; editor will run without a plan",
    );
    return "";
  }
}

/**
 * Truncate an architect plan to `maxChars`, preferring a clean break at the last
 * newline within the bound so the truncated plan reads as a complete thought.
 * Returns the empty string unchanged.
 */
function capArchitectPlan(plan: string, maxChars: number): string {
  if (plan.length <= maxChars) return plan;
  const slice = plan.slice(0, maxChars);
  const lastNewline = slice.lastIndexOf("\n");
  const body = lastNewline > maxChars * 0.5 ? slice.slice(0, lastNewline) : slice;
  return `${body}\n[plan truncated to stay within ${maxChars} chars]`;
}

// Retry/fallback logic is now handled by prebuilt middleware
// (modelRetryMiddleware, modelFallbackMiddleware, toolRetryMiddleware)

/**
 * When true, DeepAgents runs via LangGraph stream() and prints graph steps, tool calls,
 * and streamed LLM tokens to stderr. User-facing channels (Telegram, GitHub, HTTP JSON)
 * still only receive the final harness reply — this is for the operator terminal only.
 *
 * Default: on when stderr is a TTY (local `bun run start`), off in typical Docker/CI.
 * Override: AGENT_TRACE_STDERR=true | false | 1 | 0
 */
function shouldTraceAgentToTerminal(): boolean {
  const v = process.env.AGENT_TRACE_STDERR?.trim().toLowerCase();
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return Boolean(process.stderr.isTTY);
}

function trimStr(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

function formatStreamNs(ns: unknown): string {
  if (ns == null) return "main";
  if (Array.isArray(ns)) return ns.length === 0 ? "main" : ns.join(" > ");
  return String(ns);
}

function parseLangGraphStreamChunk(raw: unknown): {
  ns: unknown;
  mode: string;
  payload: unknown;
} | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  if (raw.length >= 3) {
    return { ns: raw[0], mode: String(raw[1]), payload: raw[2] };
  }
  return { ns: null, mode: String(raw[0]), payload: raw[1] };
}

function summarizeUpdateForTrace(node: string, data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const d = data as Record<string, unknown>;
  const msgs = d.messages;
  if (!Array.isArray(msgs) || msgs.length === 0) return "";
  const last = msgs[msgs.length - 1] as Record<string, unknown> | undefined;
  if (!last) return "";
  const toolCalls = last.tool_calls as Array<{ name?: string }> | undefined;
  if (toolCalls?.length) {
    // ⚡ Bolt: Replaced Array.prototype.reduce with .map().join() for faster string concatenation by avoiding callback overhead per element.
    return " → " + toolCalls.map(t => t.name ?? "?").join(", ");
  }
  if (last.type === "tool" || last.role === "tool") {
    return ` → tool:${String(last.name ?? "?")}`;
  }
  void node;
  return "";
}

function stringifyPayloadForTrace(data: unknown, max: number): string {
  try {
    return trimStr(JSON.stringify(data), max);
  } catch {
    return trimStr(String(data), max);
  }
}

function messageChunkText(msg: Record<string, unknown>): string {
  const c = msg.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((part: unknown) => {
        if (!part || typeof part !== "object") return "";
        const p = part as { type?: string; text?: string };
        return p.type === "text" && typeof p.text === "string" ? p.text : "";
      })
      .join("");
  }
  return "";
}

function logAgentTraceChunk(
  ns: unknown,
  mode: string,
  payload: unknown,
  trace: { midLine: boolean; loggedRequests: Set<string> },
): void {
  const src = formatStreamNs(ns);
  if (mode === "updates") {
    if (trace.midLine) {
      process.stderr.write("\n");
      trace.midLine = false;
    }
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const entries = Object.entries(payload as Record<string, unknown>);
      const parts = entries.map(
        ([k, v]) => `${k}${summarizeUpdateForTrace(k, v)}`,
      );
      logger.info(`[agent-trace] [${src}] step: ${parts.join(", ")}`);
    } else {
      logger.info(
        `[agent-trace] [${src}] updates ${stringifyPayloadForTrace(payload, 400)}`,
      );
    }
    return;
  }

  if (mode === "messages") {
    const tuple = payload as [
      Record<string, unknown>?,
      { langgraph_node?: string }?,
    ];
    const msg = tuple?.[0];
    const meta = tuple?.[1];
    if (!msg || typeof msg !== "object") return;
    const node = meta?.langgraph_node ?? "?";

    // Prevent spam: track logged request/node combinations
    // LLM streaming sends many chunks; only log the first occurrence
    const requestKey = `${src}:${node}`;
    const isFirstOccurrence = !trace.loggedRequests.has(requestKey);
    trace.loggedRequests.add(requestKey);

    const toolChunks = msg.tool_call_chunks as
      | Array<{ name?: string; args?: string }>
      | undefined;
    if (toolChunks?.length) {
      if (trace.midLine) {
        process.stderr.write("\n");
        trace.midLine = false;
      }
      for (const tc of toolChunks) {
        if (tc.name)
          logger.info(`[agent-trace] [${src}] tool-call: ${tc.name}`);
        if (tc.args) process.stderr.write(String(tc.args));
      }
      process.stderr.write("\n");
      return;
    }

    const text = messageChunkText(msg);
    if (text) {
      process.stderr.write(text);
      trace.midLine = true;
      return;
    }

    if (trace.midLine) {
      process.stderr.write("\n");
      trace.midLine = false;
    }

    const role = msg.type ?? msg.role ?? "message";
    const name = msg.name;
    if (role === "tool" || String(msg.constructor?.name) === "ToolMessage") {
      const body =
        typeof msg.content === "string"
          ? msg.content
          : stringifyPayloadForTrace(msg.content, 200);
      logger.info(
        `[agent-trace] [${src}] tool-result (${String(name ?? "?")} @${node}): ${trimStr(body, 240)}`,
      );
      return;
    }

    // Only log the first occurrence of each request to prevent spam
    // LLM streaming sends many chunks; subsequent chunks are handled above (text/tool)
    if (isFirstOccurrence) {
      logger.info(`[agent-trace] [${src}] ${String(role)} @${node}`);
    }
    return;
  }

  if (trace.midLine) {
    process.stderr.write("\n");
    trace.midLine = false;
  }
  logger.error(
    { payload: stringifyPayloadForTrace(payload, 280) },
    `[agent-trace] [${src}] ${mode}`,
  );
}

/**
 * Same end state as invoke(), with optional stderr trace of updates + LLM message chunks.
 */
async function runDeepAgentWithStreamTrace(
  agent: DeepAgent,
  input: string,
  configurable: Record<string, unknown>,
): Promise<unknown> {
  const stream = await agent.stream(
    { messages: [{ role: "user", content: input }] },
    {
      configurable,
      recursionLimit: AGENT_RECURSION_LIMIT,
      streamMode: ["values", "updates", "messages"],
      subgraphs: true,
    },
  );

  let latest: unknown;
  const trace = { midLine: false, loggedRequests: new Set<string>() };

  for await (const raw of stream) {
    const parsed = parseLangGraphStreamChunk(raw);
    if (!parsed) continue;
    const { ns, mode, payload } = parsed;
    if (mode === "values") {
      latest = payload;
      continue;
    }
    logAgentTraceChunk(ns, mode, payload, trace);
  }

  if (trace.midLine) {
    process.stderr.write("\n");
  }

  if (latest === undefined) {
    const snap = (await agent.getState({ configurable })) as {
      values?: unknown;
    };
    latest = snap.values;
  }

  return latest;
}

function extractRepoFromInput(
  input: string,
): { owner: string; name: string } | undefined {
  // Extract alphanumeric, hyphens, underscores, dots, and slashes
  const match = input.match(/--repo\s+([a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?)/);
  if (!match) return undefined;

  // Strip any trailing punctuation that might have been caught if it's a valid character but used as sentence punctuation
  let repoStr = match[1].replace(/[.,;!?]+$/, "");

  if (repoStr.includes("/")) {
    const [owner, name] = repoStr.split("/", 2);
    return { owner, name };
  } else {
    const defaultOwner = process.env.GITHUB_DEFAULT_OWNER || "";
    return { owner: defaultOwner, name: repoStr };
  }
}

// Keep track of last specified repository per thread.
// This solves the problem of "configurable" values being lost across turns
// if the user doesn't re-type `--repo foo/bar`.

async function acquireDaytonaSandboxForThreadRepo(args: {
  threadId: string;
  repoOwner: string;
  repoName: string;
  profile: SandboxProfile;
}): Promise<{ backend: SandboxService; workspaceDir: string }> {
  const apiKey = process.env.DAYTONA_API_KEY || "";
  if (!apiKey) {
    throw new Error("DAYTONA_API_KEY is required for sandbox pooling.");
  }

  const acquired = await acquireRepoSandbox({
    apiKey,
    apiUrl: process.env.DAYTONA_API_URL,
    target: process.env.DAYTONA_TARGET,
    profile: args.profile,
    repoOwner: args.repoOwner,
    repoName: args.repoName,
    threadId: args.threadId,
    // Only pass image if explicitly set - otherwise use snapshots
    image: process.env.DAYTONA_IMAGE,
    language: (process.env.DAYTONA_LANGUAGE as any) || undefined,
    cpu: process.env.DAYTONA_CPU
      ? parseInt(process.env.DAYTONA_CPU, 10)
      : undefined,
    memory: process.env.DAYTONA_MEMORY
      ? parseInt(process.env.DAYTONA_MEMORY, 10)
      : undefined,
    disk: process.env.DAYTONA_DISK
      ? parseInt(process.env.DAYTONA_DISK, 10)
      : undefined,
    autoStopInterval: process.env.DAYTONA_AUTOSTOP
      ? parseInt(process.env.DAYTONA_AUTOSTOP, 10)
      : undefined,
    autoArchiveInterval: process.env.DAYTONA_AUTOARCHIVE
      ? parseInt(process.env.DAYTONA_AUTOARCHIVE, 10)
      : undefined,
    autoDeleteInterval: process.env.DAYTONA_AUTODELETE
      ? parseInt(process.env.DAYTONA_AUTODELETE, 10)
      : undefined,
    ephemeral: process.env.DAYTONA_EPHEMERAL === "true",
    networkBlockAll: process.env.DAYTONA_NETWORK_BLOCK_ALL === "true",
    networkAllowList: process.env.DAYTONA_NETWORK_ALLOW_LIST,
    public: process.env.DAYTONA_PUBLIC === "true",
    user: process.env.DAYTONA_USER,
    staleBusyTimeoutMinutes: process.env.DAYTONA_POOL_STALE_BUSY_MINUTES
      ? parseInt(process.env.DAYTONA_POOL_STALE_BUSY_MINUTES, 10)
      : undefined,
  });

  const backend = await createSandboxServiceWithConfig({
    provider: "daytona",
    daytona: {
      apiKey,
      apiUrl: process.env.DAYTONA_API_URL,
      target: process.env.DAYTONA_TARGET,
      sandboxId: acquired.sandboxId,
      preserveOnCleanup: true,
    },
  });

  const workspaceDir = await backend.cloneRepo(
    args.repoOwner,
    args.repoName,
    process.env.GITHUB_TOKEN,
  );

  return { backend, workspaceDir };
}

async function resolveSandboxContext(
  threadId: string,
  parsedRepo: { owner: string; name: string },
  profile: SandboxProfile,
) {
  const cloneStart = Date.now();
  const provider = process.env.SANDBOX_PROVIDER || "opensandbox";
  let backend;
  let workspaceDir;

  if (provider === "daytona") {
    const result = await acquireDaytonaSandboxForThreadRepo({
      threadId,
      repoOwner: parsedRepo.owner,
      repoName: parsedRepo.name,
      profile,
    });
    backend = result.backend;
    workspaceDir = result.workspaceDir;
  } else {
    backend = await createSandboxServiceWithConfig({
      provider: "opensandbox",
      opensandbox: {
        domain: process.env.OPENSANDBOX_DOMAIN,
        apiKey: process.env.OPENSANDBOX_API_KEY || "",
        image: process.env.OPENSANDBOX_IMAGE,
        timeoutSeconds: process.env.OPENSANDBOX_TIMEOUT
          ? parseInt(process.env.OPENSANDBOX_TIMEOUT, 10)
          : undefined,
        cpu: process.env.OPENSANDBOX_CPU,
        memory: process.env.OPENSANDBOX_MEMORY,
      },
    });
    workspaceDir = await backend.cloneRepo(
      parsedRepo.owner,
      parsedRepo.name,
      process.env.GITHUB_TOKEN,
    );
  }

  logger.info(
    `[deepagents] Repo acquire+clone took ${Date.now() - cloneStart}ms`,
  );

  const activeRepo = { ...parsedRepo, workspaceDir, lastAccessed: Date.now() };
  threadManager.setRepo(threadId, activeRepo);
  const { lastAccessed, ...repoForPersistence } = threadManager.getRepo(
    threadId,
  ) || { owner: parsedRepo.owner, name: parsedRepo.name, workspaceDir };

  await persistThreadRepo(threadId, {
    ...repoForPersistence,
    sandbox: {
      sandboxId: backend.id,
      profile,
    },
  });

  threadManager.setSandbox(threadId, {
    backend,
    profile,
    repo: activeRepo,
  } as any);

  setSandboxBackend(threadId, backend);

  // Pre-install dependencies for agent context
  try {
    logger.info(
      "[deepagents] Pre-installing dependencies for agent context...",
    );
    await installDependencies(backend, workspaceDir);
  } catch (depErr) {
    logger.warn(
      { err: depErr },
      "[deepagents] Pre-install dependencies failed (non-fatal)",
    );
  }

  return { activeRepo, backend, workspaceDir };
}

export class DeepAgentWrapper implements AgentHarness {
  constructor() {}

  private async prepareAgent(input: string, threadId: string) {
    if (!hasLoadedPersistedRepos) {
      const persisted = await loadPersistedThreadRepos();
      for (const [id, repo] of persisted.entries()) {
        threadManager.setRepo(id, repo);
      }
      hasLoadedPersistedRepos = true;
    }

    const parsedRepo = extractRepoFromInput(input);
    let activeRepo: RepoContext | undefined = threadManager.getRepo(threadId);
    if (activeRepo) {
    }
    const profile = getSandboxProfileFromEnv();

    const sandboxEntry = threadManager.getSandbox(threadId);
    if (sandboxEntry) {
    }
    const hasBackendForThread = Boolean(sandboxEntry?.backend);

    // Mark thread as accessed in cleanup scheduler
    const scheduler = await import("../utils/thread-cleanup-scheduler").then(
      (m) => m.getThreadCleanupScheduler(),
    );
    if (scheduler) {
      scheduler.markAccessed(threadId);
    }

    // Acquire/clone repo when:
    // 1) user specified a different repo, OR
    // 2) sandbox mode is enabled and this thread has no backend yet (rehydration case)
    if (
      parsedRepo &&
      (!activeRepo ||
        activeRepo.owner !== parsedRepo.owner ||
        activeRepo.name !== parsedRepo.name ||
        (useSandbox && !hasBackendForThread))
    ) {
      // If we already held a sandbox for this thread, release it back to the pool.
      const prior = threadManager.getSandbox(threadId);
      if (prior) {
        try {
          await releaseRepoSandbox({
            apiKey: process.env.DAYTONA_API_KEY || "",
            apiUrl: process.env.DAYTONA_API_URL,
            target: process.env.DAYTONA_TARGET,
            sandboxId: prior.backend.id,
            profile: prior.profile,
            repoOwner: prior.repo.owner,
            repoName: prior.repo.name,
          });
        } catch (err) {
          logger.warn(
            { error: err },
            "[deepagents] Failed to release prior sandbox",
          );
        }
        try {
          await prior.backend.cleanup();
        } catch (err) {
          logger.warn(
            { error: err },
            "[deepagents] Failed to cleanup prior backend",
          );
        }
        threadManager.threadSandboxMap.delete(threadId);
        threadManager.threadAgentMap.delete(threadId);
        clearSandboxBackend(threadId);
        // Clean up tool invocation tracking for this thread
        toolInvocationTracker.clearThread(threadId);
        await removePersistedThreadRepo(threadId);
      }

      if (useSandbox) {
        const context = await resolveSandboxContext(
          threadId,
          parsedRepo,
          profile,
        );
        activeRepo = context.activeRepo;
      } else {
        activeRepo = {
          ...parsedRepo,
          workspaceDir: `/workspace/${parsedRepo.name}`,
          lastAccessed: Date.now(),
        };
        threadManager.setRepo(threadId, activeRepo);
        const { lastAccessed, ...repoForPersistence } = threadManager.getRepo(
          threadId,
        ) || {
          owner: parsedRepo.owner,
          name: parsedRepo.name,
          workspaceDir: activeRepo.workspaceDir,
        };
        await persistThreadRepo(threadId, repoForPersistence);
      }
    }

    const configurable: any = { thread_id: threadId };
    if (activeRepo) {
      configurable.repo = {
        owner: activeRepo.owner,
        name: activeRepo.name,
        workspaceDir: activeRepo.workspaceDir,
      };
    }
    // Stamp the top-level agent identity into the runtime configurable so the
    // hooks middleware (issue #490 acceptance criterion #3) can distinguish
    // top-level vs subagent events. Subagents spawned via the `task` tool
    // inherit this config but are tagged separately by the middleware.
    configurable.agent_id = "bullhorse";
    configurable.agent_type = "deepagents";
    configurable.agent_scope = "top";

    // Pass tools to configurable so tool_search can access them
    const currentTools = useSandbox ? sandboxAllTools : allTools;
    configurable.tools = currentTools;

    // Get or create a DeepAgent instance for this thread.
    let agent = threadManager.getAgent(threadId);
    if (!agent) {
      if (useSandbox) {
        const backend = threadManager.getSandbox(threadId)?.backend;
        if (!backend) {
          throw new Error(
            "Sandbox mode is enabled but no sandbox backend is available. Provide --repo or configure a default sandbox.",
          );
        }
        agent = await createAgentInstance({
          workspaceRoot: activeRepo?.workspaceDir,
          backend,
          threadId,
        });
      } else if (activeRepo?.workspaceDir) {
        agent = await createAgentInstance({
          workspaceRoot: activeRepo.workspaceDir,
          backend: new FilesystemBackend({
            rootDir: activeRepo.workspaceDir,
            virtualMode: false,
          }),
          threadId,
        });
      } else {
        agent = await createAgentInstance({ threadId });
      }

      threadManager.setAgent(threadId, agent);
      logger.info({ threadId }, `[deepagents] Agent initialized for thread`);
    }
    return { agent, configurable, activeRepo };
  }

  async invoke(
    input: string,
    options?: AgentInvokeOptions,
  ): Promise<AgentResponse> {
    const startTime = Date.now();
    const threadId = options?.threadId || "default-session";
    try {
      // Emit session start
      emitStreamEvent(threadId, {
        type: "session_start",
        threadId,
        timestamp: Date.now(),
      });
      // Fire event-driven hooks SessionStart (idempotent per thread_id; no-op
      // when unconfigured). Awaited so SessionStart ordering is guaranteed and
      // a failing handler cannot race the agent turn or surface as an
      // unhandled rejection. fireSessionStart swallows/logs handler errors.
      await fireSessionStart(threadId);

      let { agent, configurable } = await this.prepareAgent(input, threadId);
      const activeRepo = threadManager.getRepo(threadId);
      if (activeRepo) {
      }

      // Mark thread as accessed in cleanup scheduler
      const scheduler = await import("../utils/thread-cleanup-scheduler").then(
        (m) => m.getThreadCleanupScheduler(),
      );
      if (scheduler) {
        scheduler.markAccessed(threadId);
      }

      // Blueprint selection: Choose workflow template based on task keywords
      // This is a lightweight operation that just returns metadata
      // The actual execution is still handled by DeepAgents + middleware
      const { selectOldBlueprint, buildInputWithBlueprint } =
        await import("../blueprints");
      const blueprintSelection = selectOldBlueprint(input);
      logger.info(
        {
          blueprintId: blueprintSelection.blueprint.id,
          blueprintName: blueprintSelection.blueprint.name,
          confidence: blueprintSelection.confidence,
          matchedKeywords: blueprintSelection.matchedKeywords,
        },
        "[deepagents] Blueprint selected based on task analysis",
      );

      // Modify input based on blueprint prompt customization
      let modifiedInput = buildInputWithBlueprint(input, blueprintSelection);
      if (modifiedInput !== input) {
        logger.debug(
          "[deepagents] Input modified by blueprint prompt customization",
        );
      }

      // Check for existing PRs before starting work
      let existingPrContext: {
        exists: boolean;
        prUrl?: string;
        message?: string;
      } = { exists: false };
      if (activeRepo) {
        try {
          const { checkExistingPRForThread } =
            await import("../utils/pr-context");
          const prContext = await checkExistingPRForThread(
            threadId,
            process.env.GITHUB_TOKEN,
          );
          existingPrContext = prContext;

          if (prContext.exists) {
            logger.info(
              {
                threadId,
                prUrl: prContext.prUrl,
                prNumber: prContext.prNumber,
              },
              "[deepagents] Existing PR found for this thread",
            );

            // Add context to the input so the agent knows about the existing PR
            const prNotice = `
[IMPORTANT: Existing Pull Request]
A pull request already exists for this conversation: ${prContext.prUrl}

If the task has already been completed in that PR, please inform the user.
If you need to make additional changes, continue working and they'll be added to the same PR.
`;
            modifiedInput = prNotice + modifiedInput;
          }
        } catch (err) {
          // Non-fatal: log and continue
          logger.warn(
            { err },
            "[deepagents] Failed to check for existing PRs, continuing anyway",
          );
        }
      }

      // Clean repository state before agent run if using sandbox
      // This prevents the agent from being confused by leftover changes from previous runs
      const sandboxEntry = threadManager.getSandbox(threadId);
      if (sandboxEntry) {
      }

      // Mark thread as accessed in cleanup scheduler
      const invokeScheduler =
        await import("../utils/thread-cleanup-scheduler").then((m) =>
          m.getThreadCleanupScheduler(),
        );
      if (invokeScheduler) {
        invokeScheduler.markAccessed(threadId);
      }

      if (sandboxEntry && activeRepo) {
        try {
          const hasUncommitted = await gitHasUncommittedChanges(
            sandboxEntry.backend,
            activeRepo.workspaceDir,
          );
          if (hasUncommitted) {
            logger.info(
              `[deepagents] Found uncommitted changes from previous run, cleaning repository state`,
            );
            await gitCleanRepository(
              sandboxEntry.backend,
              activeRepo.workspaceDir,
            );
            logger.info(`[deepagents] Repository state cleaned successfully`);
          }
          // Always pull latest changes to ensure we're working with the latest code
          logger.info(`[deepagents] Pulling latest changes from remote`);
          await gitPull(sandboxEntry.backend, activeRepo.workspaceDir);
        } catch (err) {
          // Non-fatal: log and continue
          logger.warn(
            { err },
            "[deepagents] Failed to clean repository state, continuing anyway",
          );
        }
      }

      logger.info(
        `[deepagents] Calling DeepAgent invoke (input length: ${input.length} chars)`,
      );

      // Log Langfuse tracing status
      if (isLangfuseEnabled()) {
        logger.info(
          { threadId },
          "[deepagents] Langfuse tracing enabled for this session",
        );
      }

      // Log the input being sent to the agent
      if (process.env.DEBUG_DEEPAGENTS === "true") {
        logger.debug({ input: modifiedInput }, "=== Agent Input ===");
      }

      const agentStart = Date.now();
      let result: any;

      const traceTerminal = shouldTraceAgentToTerminal();

      // Create Langfuse trace for this agent turn (manual instrumentation)
      const langfuseTrace = isLangfuseEnabled()
        ? createTrace("agent-turn", threadId, options?.userId)
        : null;

      let invokeProgressTicker: ReturnType<typeof setInterval> | undefined;
      try {
        if (!traceTerminal) {
          invokeProgressTicker = setInterval(() => {
            const elapsedMs = Date.now() - agentStart;
            logger.info(
              { threadId, elapsedMs, phase: "agent_invoke" },
              "[deepagents] Agent still processing...",
            );
          }, 10_000);
        } else {
          logger.info(
            "[agent-trace] Streaming agent run to stderr (set AGENT_TRACE_STDERR=false to disable).",
          );
        }

        // Retry/fallback is handled by middleware (modelRetryMiddleware, modelFallbackMiddleware)

        // Update trace with input
        if (langfuseTrace) {
          langfuseTrace.update({
            input: maskSensitiveData(modifiedInput),
            metadata: {
              transport: options?.transport || "api",
              blueprintId: blueprintSelection.blueprint.id,
              blueprintName: blueprintSelection.blueprint.name,
              repo: activeRepo
                ? `${activeRepo.owner}/${activeRepo.name}`
                : undefined,
            },
          });
        }

        // Emit LLM start.
        // The agent runs on the EDITOR model (#497); when routing is disabled
        // getRoleModelConfig returns the single MODEL config, so `model` matches
        // today's behavior. `role` is only included for attribution when routing
        // is enabled, leaving the default event shape unchanged.
        //
        // Telemetry model accuracy (#497): when a per-thread /model override is
        // active it is applied to the agent's chat model at setupAgent time, so
        // the resolved model id is the override (or the editor/base model). Emit
        // the ACTUALLY-USED model id here, not a stale config value — otherwise
        // a /model override combined with routing would misattribute usage to
        // the wrong model.
        const editorModelConfig = getRoleModelConfig("editor");
        const modelOverride = getModelOverride(threadId);
        const resolvedEditorModel =
          (modelOverride?.trim() || undefined) ?? editorModelConfig.model;
        const llmStartEvent: LLMStartEvent = {
          type: "llm_start",
          model: resolvedEditorModel || "unknown",
          timestamp: Date.now(),
        };
        if (editorModelConfig.role) {
          llmStartEvent.role = editorModelConfig.role;
        }
        emitStreamEvent(threadId, llmStartEvent);

        // Plan/Act mode (#498): in "plan" mode, instruct the agent to reason
        // and propose a plan WITHOUT editing (read-only). Only this turn's user
        // message is wrapped — conversation history is preserved.
        if (getMode(threadId) === "plan") {
          modifiedInput =
            "You are in PLAN MODE. Do NOT edit files, run shell/write commands, or make any changes. Read the relevant code, reason about the task, and reply with a concise, actionable PLAN (numbered steps, files to touch, risks/open questions). Stop before implementing. The user will run /act to apply changes.\n\n" +
            modifiedInput;
        }

        // Architect planning step (#497): when Architect/Editor routing is
        // enabled, the ARCHITECT model produces a concise plan from the task +
        // repo context and we prepend it to the editor's user message. When
        // routing is disabled, generateArchitectPlan is a no-op (returns "")
        // and modifiedInput is untouched — byte-for-byte today's behavior.
        //
        // Plan mode vs architect (#497): when the user has already engaged PLAN
        // mode (their manual planning request), the agent itself proposes a
        // plan, so the architect's automatic plan would double-plan. Skip the
        // architect step in plan mode. Plan mode = the user's planning;
        // architect = the model's auto-planning; never both.
        if (
          isArchitectEditorRoutingEnabled() && getMode(threadId) !== "plan"
        ) {
          const plan = await generateArchitectPlan(
            modifiedInput,
            activeRepo,
            { threadId },
          );
          if (plan) {
            modifiedInput =
              `[ARCHITECT PLAN]\n${plan}\n[/ARCHITECT PLAN]\n\n` + modifiedInput;
          }
        }

        result = traceTerminal
          ? await runDeepAgentWithStreamTrace(
              agent,
              modifiedInput,
              configurable,
            )
          : await agent.invoke(
              { messages: [{ role: "user", content: modifiedInput }] },
              {
                configurable,
                recursionLimit: AGENT_RECURSION_LIMIT,
              },
            );

        // Calculate tokens (rough estimate)
        const messagesAfter = result.messages || [];
        const totalTokens = JSON.stringify(messagesAfter).length / 4; // Rough estimate

        // Emit LLM end. Tag with the editor role when routing is enabled so the
        // paired llm_end can be attributed to the same role as its llm_start.
        emitStreamEvent(threadId, {
          type: "llm_end",
          totalTokens: Math.round(totalTokens),
          timestamp: Date.now(),
          ...(editorModelConfig.role
            ? { role: editorModelConfig.role }
            : {}),
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error(
          { threadId, elapsedMs: Date.now() - agentStart, message: errorMsg },
          "[deepagents] Invoke failed",
        );

        // Emit error event
        emitStreamEvent(threadId, {
          type: "error",
          message: errorMsg,
          timestamp: Date.now(),
        });

        return {
          reply:
            "The coding model encountered an error. Please retry shortly or switch to a different MODEL/provider.",
          error: errorMsg,
        };
      } finally {
        if (invokeProgressTicker) {
          clearInterval(invokeProgressTicker);
        }
      }

      logger.info(
        `[deepagents] DeepAgent invoke completed in ${Date.now() - agentStart}ms`,
      );

      const messages = result.messages || [];
      const lastMessage = messages[messages.length - 1];
      const text = lastMessage?.content || "";

      // Log all messages with detailed information using logger when DEBUG_DEEPAGENTS is set
      if (process.env.DEBUG_DEEPAGENTS === "true") {
        logger.debug(
          { messages: messages.length },
          "=== Agent Execution Log ===",
        );
        messages.forEach(
          (
            msg: BaseMessage & {
              tool_calls?: ToolCall[];
              role?: string;
              type?: string;
            },
            index: number,
          ) => {
            const msgLog = {
              index: index + 1,
              role: msg.role || msg._getType(),
              type: msg.type || "message",
              tool_calls: (msg.tool_calls || []).map((tc: ToolCall) => ({
                name: tc.name,
                id: tc.id,
                args: tc.args
                  ? JSON.stringify(tc.args).length > 500
                    ? JSON.stringify(tc.args).substring(0, 500) + "..."
                    : JSON.stringify(tc.args)
                  : undefined,
              })),
              content:
                typeof msg.content === "string" ? msg.content : undefined,
              content_items: Array.isArray(msg.content)
                ? msg.content.map((item: any) => {
                    if (item.type === "text")
                      return { type: "text", text: item.text };
                    if (item.type === "tool_use")
                      return {
                        type: "tool_use",
                        name: item.name,
                        id: item.id,
                        input: item.input,
                      };
                    if (item.type === "tool_result") {
                      const contentStr =
                        typeof item.content === "string"
                          ? item.content
                          : JSON.stringify(item.content);
                      return {
                        type: "tool_result",
                        id: item.tool_use_id,
                        is_error: item.is_error,
                        content:
                          contentStr.length > 300
                            ? contentStr.substring(0, 300) + "..."
                            : contentStr,
                      };
                    }
                    return item;
                  })
                : undefined,
            };
            logger.debug(
              { msg: msgLog },
              `[Message ${index + 1}] Role: ${msgLog.role}`,
            );
          },
        );
      }

      // Emit tool call events
      for (const msg of messages) {
        if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
          for (const tc of msg.tool_calls) {
            emitStreamEvent(threadId, {
              type: "tool_call",
              tool: tc.name || "unknown",
              args: tc.args || {},
              timestamp: Date.now(),
            });
          }
        }

        // Emit tool result events
        if ((msg.type === "tool" || msg.role === "tool") && msg.name) {
          const content =
            typeof msg.content === "string"
              ? msg.content
              : JSON.stringify(msg.content);
          emitStreamEvent(threadId, {
            type: "tool_result",
            tool: String(msg.name),
            result: content,
            duration: 0, // We don't have individual tool timing
            timestamp: Date.now(),
          });
        }
      }

      const responseText =
        typeof text === "string" ? text : JSON.stringify(text);

      logger.info(
        { responseLength: responseText, totalMessages: messages.length },
        `[deepagents] Agent response received (${responseText.length} chars, ${messages.length} messages total)`,
      );

      if (process.env.DEBUG_DEEPAGENTS === "true") {
        logger.debug({ responseText }, "=== Final Agent Response ===");
      }

      // Update Langfuse trace with output
      if (langfuseTrace) {
        langfuseTrace.update({
          output: maskSensitiveData(responseText),
          metadata: {
            totalMessages: messages.length,
            responseLength: responseText.length,
            totalDurationMs: Date.now() - startTime,
          },
        });
      }

      logger.info(
        `[deepagents] Total invoke time: ${Date.now() - startTime}ms`,
      );

      // Best-effort memory persistence (non-fatal)
      void writeRepoMemoryAfterAgentTurn({
        threadId,
        userText: input,
        input,
        agentReply: responseText,
        fullTurnOutput: responseText,
        agentError: undefined,
        deterministic: {},
      });

      // Run verification pipeline (deterministic nodes)
      if (activeRepo && useSandbox) {
        try {
          const { runVerificationPipeline } =
            await import("../nodes/deterministic");
          const sandboxEntry = threadManager.getSandbox(threadId);

          if (sandboxEntry?.backend) {
            logger.info(
              "[deepagents] Running verification pipeline (tests, lint, PR)",
            );

            const verificationResults = await runVerificationPipeline({
              sandbox: sandboxEntry.backend,
              repoDir: activeRepo.workspaceDir,
              repoOwner: activeRepo.owner,
              repoName: activeRepo.name,
              threadId,
              messages,
              githubToken: process.env.GITHUB_TOKEN,
              requireTests: true,
              requireLint: true,
            });

            logger.info(
              {
                testsPassed: verificationResults.testsPassed,
                lintPassed: verificationResults.lintPassed,
                prCreated: verificationResults.prCreated,
                prUrl: verificationResults.prUrl,
              },
              "[deepagents] Verification pipeline completed",
            );

            // If verification failed but agent didn't report error, append results
            if (verificationResults.error && !responseText.includes("failed")) {
              logger.warn(
                { error: verificationResults.error },
                "[deepagents] Verification failed, appending to response",
              );
            }
          }
        } catch (verifyErr) {
          logger.error(
            { err: verifyErr },
            "[deepagents] Verification pipeline failed",
          );
        }
      }

      // Run the safety net PR middleware
      if (activeRepo) {
        try {
          const expectedSandbox = useSandbox
            ? threadManager.getSandbox(threadId)?.backend
            : undefined;
          await openPrIfNeeded(
            { messages },
            { configurable },
            expectedSandbox,
            activeRepo.workspaceDir,
          );
        } catch (prErr) {
          logger.error(
            { err: prErr },
            "[deepagents] openPrIfNeeded middleware failed",
          );
        }
      }

      // Flush Langfuse traces (non-blocking)
      // This ensures traces are sent without delaying the response
      if (isLangfuseEnabled()) {
        void flushLangfuse();
      }

      // Emit session end
      emitStreamEvent(threadId, {
        type: "session_end",
        threadId,
        timestamp: Date.now(),
      });

      return {
        reply: responseText,
        messages,
      };
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      const errorStack = e instanceof Error ? e.stack : undefined;
      logger.error(
        { err: e, message: errorMsg, stack: errorStack },
        `[deepagents] Invoke error after ${Date.now() - startTime}ms`,
      );

      // Emit error event
      emitStreamEvent(threadId, {
        type: "error",
        message: errorMsg,
        timestamp: Date.now(),
      });

      // Flush Langfuse traces even on error (non-blocking)
      if (isLangfuseEnabled()) {
        void flushLangfuse();
      }

      return { reply: "", error: errorMsg };
    }
  }

  async run(
    input: string,
    options?: AgentInvokeOptions,
  ): Promise<AgentResponse> {
    return this.invoke(input, options);
  }

  async *stream(
    input: string,
    options?: AgentInvokeOptions,
  ): AsyncGenerator<any, void, unknown> {
    const threadId = options?.threadId || "default-session";
    const { agent, configurable } = await this.prepareAgent(input, threadId);

    const stream = await agent.stream(
      { messages: [{ role: "user", content: input }] },
      { configurable },
    );

    for await (const chunk of stream) {
      yield chunk;
    }
  }

  async getState(threadId: string): Promise<any> {
    const agent = threadManager.getAgent(threadId);
    if (!agent) return null;

    // Mark thread as accessed in cleanup scheduler
    const scheduler = await import("../utils/thread-cleanup-scheduler").then(
      (m) => m.getThreadCleanupScheduler(),
    );
    if (scheduler) {
      scheduler.markAccessed(threadId);
    }

    return agent.getState({ configurable: { thread_id: threadId } });
  }
}

/**
 * Get an AgentHarness instance backed by DeepAgents
 */
export async function getAgentHarness(
  workspaceRoot?: string,
): Promise<AgentHarness> {
  // workspaceRoot is used for non-sandbox local mode; in sandbox mode we acquire per thread+repo.
  void workspaceRoot;
  return new DeepAgentWrapper();
}

export async function initDeepAgentsAtStartup(): Promise<void> {
  if (!hasLoadedPersistedRepos) {
    const persisted = await loadPersistedThreadRepos();
    for (const [id, repo] of persisted.entries()) {
      threadManager.setRepo(id, repo);
    }
    hasLoadedPersistedRepos = true;
  }

  // Snapshot store now lazy-loads on first access (no need to initialize at startup)
  logger.info(
    "[deepagents] Snapshot store configured for lazy-loading (initializes on first access)",
  );

  await getAgentHarness();

  // Initialize thread cleanup scheduler
  const cleanupIntervalMs = Number.parseInt(
    process.env.THREAD_CLEANUP_INTERVAL_MS || "3600000",
    10,
  ); // Default 1 hour
  const cleanupTtlMs = Number.parseInt(
    process.env.THREAD_CLEANUP_TTL_MS || THREAD_TTL_MS.toString(),
    10,
  ); // Use same default as THREAD_TTL_MS

  const scheduler = startThreadCleanupScheduler({
    intervalMs: cleanupIntervalMs,
    ttlMs: cleanupTtlMs,
    enabled: process.env.THREAD_CLEANUP_ENABLED !== "false",
  });

  // Register cleanup function that integrates with ThreadCleanupScheduler
  const cleanupFn: ThreadMapCleanupFn = async (
    _metadata: Map<string, { threadId: string; lastAccessed: Date }>,
    ttlMs: number,
  ): Promise<number> => {
    return await cleanupThreadMaps(ttlMs);
  };

  scheduler.registerCleanupFn(cleanupFn);

  // Wire the per-thread session store's TTL purge into the same tick so the
  // session store (mode/model overrides) is actually TTL-bounded as documented,
  // not just hard-cap bounded. Aligns the purge TTL with the scheduler's TTL.
  const sessionStoreCleanupFn: ThreadMapCleanupFn = async (
    _metadata: Map<string, { threadId: string; lastAccessed: Date }>,
    ttlMs: number,
  ): Promise<number> => {
    try {
      return purgeStaleSessions(Date.now(), ttlMs);
    } catch (err) {
      logger.warn(
        { err },
        "[deepagents] session-store purge failed (non-fatal)",
      );
      return 0;
    }
  };

  scheduler.registerCleanupFn(sessionStoreCleanupFn);

  // Register hooks SessionStart-map eviction with the same scheduler so the
  // idempotency map does not grow unbounded across the process lifetime.
  registerHooksThreadCleanup().catch((err) =>
    logger.warn({ err }, "[deepagents] hooks cleanup registration failed"),
  );

  logger.info(
    {
      intervalMs: cleanupIntervalMs,
      ttlMs: cleanupTtlMs,
    },
    "[deepagents] Thread cleanup scheduler registered",
  );
}

/**
 * Cleanup function to properly shutdown agent and sandbox.
 * Should be called on application shutdown.
 */
export async function cleanupDeepAgents(): Promise<void> {
  logger.info("[deepagents] Cleaning up...");

  // Stop the thread cleanup scheduler
  stopThreadCleanupScheduler();

  // Release sandboxes back to the pool and dispose backends in parallel.
  await Promise.all(
    Array.from(threadManager.threadSandboxMap.entries()).map(
      async ([threadId, entry]) => {
        try {
          await releaseRepoSandbox({
            apiKey: process.env.DAYTONA_API_KEY || "",
            apiUrl: process.env.DAYTONA_API_URL,
            target: process.env.DAYTONA_TARGET,
            sandboxId: entry.backend.id,
            profile: entry.profile,
            repoOwner: entry.repo.owner,
            repoName: entry.repo.name,
          });
        } catch (err) {
          logger.warn(
            { error: err, threadId },
            "[deepagents] Failed to release sandbox",
          );
        }
        try {
          await entry.backend.cleanup();
        } catch (err) {
          logger.warn(
            { error: err, threadId },
            "[deepagents] Failed to cleanup backend",
          );
        }
        clearSandboxBackend(threadId);
        // Clean up tool invocation tracking for this thread
        toolInvocationTracker.clearThread(threadId);
      },
    ),
  );
  threadManager.threadSandboxMap.clear();
  threadManager.threadAgentMap.clear();
  threadManager.threadRepoMap.clear();

  // Shutdown Langfuse to flush any pending traces
  if (isLangfuseEnabled()) {
    logger.info("[deepagents] Flushing Langfuse traces...");
    await shutdownLangfuse();
  }

  logger.info("[deepagents] Cleanup complete");
}

// Exposed for testing purposes
export function resetDeepAgentsStateForTesting(): void {
  // Stop the thread cleanup scheduler to prevent it from interfering with tests
  stopThreadCleanupScheduler();

  hasLoadedPersistedRepos = false;
  threadManager.threadRepoMap.clear();
  threadManager.threadSandboxMap.clear();
  threadManager.threadAgentMap.clear();
}

export function getThreadRepoMapForTesting() {
  return threadRepoMap;
}
