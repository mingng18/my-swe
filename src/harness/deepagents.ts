import { createLogger } from "../utils/logger";
import { loadLlmConfig, loadModelConfig } from "../utils/config";
import { createChatModel } from "../utils/model-factory";
import { createDeepAgent, FilesystemBackend, type DeepAgent } from "deepagents";
import {
  isLangfuseEnabled,
  flushLangfuse,
  shutdownLangfuse,
  createTrace,
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
import { toolInvocationTracker } from "../middleware/tool-invocation-limits";
import { createSkillCompactionProtectionMiddleware } from "../middleware/skill-compaction-protection";
import { createCompactionMiddleware } from "../middleware/compact-middleware";
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

const logger = createLogger("deepagents");

// ============================================================================
// Thread Cleanup Configuration
// ============================================================================

/**
 * Time in milliseconds after which thread map entries are cleaned up.
 * Default: 1 hour (3600000 ms)
 * Can be overridden via THREAD_TTL_MS environment variable.
 */
const THREAD_TTL_MS = Number.parseInt(
  process.env.THREAD_TTL_MS || "3600000",
  10,
);

/**
 * Create middleware that tracks and limits tool invocations per thread.
 *
 * This middleware intercepts tool calls before execution to:
 * 1. Track each tool invocation for analytics and debugging
 * 2. Enforce per-tool invocation limits to prevent runaway loops
 * 3. Detect and block duplicate calls within a debounce window
 * 4. Provide actionable error messages to guide the agent
 *
 * When a tool call is blocked, an error message is injected that guides
 * the agent toward alternative approaches.
 */
function createToolInvocationLimitsMiddleware() {
  return createMiddleware({
    name: "toolInvocationLimitsMiddleware",

    wrapModelCall: async (request: any, handler: any) => {
      const messages = request.messages as Array<Record<string, unknown>>;
      const configurable = request.configurable as
        | Record<string, unknown>
        | undefined;
      const threadId = (configurable?.thread_id as string) || "default-session";

      // Extract tool calls from the last AI message
      const lastMsg =
        messages.length > 0 ? messages[messages.length - 1] : undefined;
      const toolCalls = lastMsg?.tool_calls as
        | Array<{ name?: string; args?: Record<string, unknown>; id?: string }>
        | undefined;

      if (!toolCalls || toolCalls.length === 0) {
        // No tool calls in this request, proceed normally
        return handler(request);
      }

      // Check each tool call against invocation limits
      const blockedToolCalls: Array<{
        index: number;
        name: string;
        blockReason: string;
      }> = [];

      for (let i = 0; i < toolCalls.length; i++) {
        const tc = toolCalls[i];
        const toolName = tc.name || "unknown";
        const args = (tc.args || {}) as Record<string, unknown>;

        // Check if this tool call should be blocked
        const blockCheck = toolInvocationTracker.shouldBlockToolCall(
          threadId,
          toolName,
          args,
        );

        if (blockCheck.block) {
          blockedToolCalls.push({
            index: i,
            name: toolName,
            blockReason: blockCheck.reason || "Tool invocation limit exceeded",
          });

          logger.warn(
            {
              threadId,
              toolName,
              args,
              count: blockCheck.count,
              reason: blockCheck.reason,
            },
            "[tool-invocation-limits] Tool call blocked",
          );
        } else {
          // Track the tool call for future limit checking
          toolInvocationTracker.trackToolCall(threadId, toolName, args);

          logger.debug(
            {
              threadId,
              toolName,
              args,
              count: blockCheck.count,
            },
            "[tool-invocation-limits] Tool call tracked",
          );
        }
      }

      // If any tool calls were blocked, inject error messages
      if (blockedToolCalls.length > 0) {
        const blockMessages = blockedToolCalls.map(
          (blocked) => `[BLOCKED] ${blocked.name}: ${blocked.blockReason}`,
        );

        const errorMessage = {
          role: "user" as const,
          content: `The following tool calls were blocked due to invocation limits:\n\n${blockMessages.map((msg) => `- ${msg}`).join("\n")}\n\nPlease try a different approach or tool.`,
        };

        logger.warn(
          {
            threadId,
            blockedCount: blockedToolCalls.length,
            blockedTools: blockedToolCalls.map((b) => ({
              name: b.name,
              reason: b.blockReason,
            })),
          },
          "[tool-invocation-limits] Injecting block error message to agent",
        );

        // Return early with error message, preventing tool execution
        return handler({
          ...request,
          messages: [...messages, errorMessage],
        });
      }

      // No tool calls were blocked, proceed normally
      return handler(request);
    },
  });
}

const threadAgentMap = new Map<
  string,
  { agent: DeepAgent; lastAccessed: number }
>();
const threadSandboxMap = new Map<
  string,
  {
    backend: SandboxService;
    profile: SandboxProfile;
    repo: { owner: string; name: string; workspaceDir: string };
    lastAccessed: number;
  }
>();

// Export for use in other modules (e.g., PR context checking)
export { threadRepoMap };

// Check if sandbox mode is enabled via environment variable
const useSandbox = process.env.USE_SANDBOX === "true";
const AGENT_RECURSION_LIMIT = Number.parseInt(
  process.env.AGENT_RECURSION_LIMIT || "500",
  10,
);
let hasLoadedPersistedRepos = false;

// Helper functions for managing lastAccessed timestamps
function updateThreadAgentAccess(
  map: Map<string, { agent: DeepAgent; lastAccessed: number }>,
  threadId: string,
): void {
  const entry = map.get(threadId);
  if (entry) {
    entry.lastAccessed = Date.now();
  }
}

function setThreadAgent(
  map: Map<string, { agent: DeepAgent; lastAccessed: number }>,
  threadId: string,
  agent: DeepAgent,
): void {
  map.set(threadId, { agent, lastAccessed: Date.now() });
}

function updateThreadSandboxAccess(
  map: Map<
    string,
    {
      backend: SandboxService;
      profile: SandboxProfile;
      repo: { owner: string; name: string; workspaceDir: string };
      lastAccessed: number;
    }
  >,
  threadId: string,
): void {
  const entry = map.get(threadId);
  if (entry) {
    entry.lastAccessed = Date.now();
  }
}

function setThreadSandbox(
  map: Map<
    string,
    {
      backend: SandboxService;
      profile: SandboxProfile;
      repo: { owner: string; name: string; workspaceDir: string };
      lastAccessed: number;
    }
  >,
  threadId: string,
  value: {
    backend: SandboxService;
    profile: SandboxProfile;
    repo: { owner: string; name: string; workspaceDir: string; lastAccessed?: number };
  },
): void {
  const { lastAccessed: _, ...repoWithoutLastAccessed } = value.repo;
  map.set(threadId, {
    ...value,
    repo: repoWithoutLastAccessed,
    lastAccessed: Date.now(),
  });
}

function updateThreadRepoAccess(
  map: Map<
    string,
    { owner: string; name: string; workspaceDir: string; lastAccessed: number }
  >,
  threadId: string,
): void {
  const entry = map.get(threadId);
  if (entry) {
    entry.lastAccessed = Date.now();
  }
}

function setThreadRepo(
  map: Map<
    string,
    { owner: string; name: string; workspaceDir: string; lastAccessed: number }
  >,
  threadId: string,
  repo: { owner: string; name: string; workspaceDir: string },
): void {
  map.set(threadId, { ...repo, lastAccessed: Date.now() });
}

// ============================================================================
// Thread Cleanup Functions
// ============================================================================

/**
 * Remove agent entries from threadAgentMap that are older than THREAD_TTL_MS.
 * This prevents unbounded memory growth from abandoned threads.
 */
function cleanupOldEntriesFromThreadAgentMap(): void {
  const now = Date.now();
  const threadsToDelete: string[] = [];

  for (const [threadId, entry] of threadAgentMap.entries()) {
    const age = now - entry.lastAccessed;
    if (age > THREAD_TTL_MS) {
      threadsToDelete.push(threadId);
    }
  }

  for (const threadId of threadsToDelete) {
    threadAgentMap.delete(threadId);
    logger.debug(
      { threadId },
      "[deepagents] Cleaned up old agent entry",
    );
  }

  if (threadsToDelete.length > 0) {
    logger.info(
      { count: threadsToDelete.length },
      "[deepagents] Cleaned up old agent entries",
    );
  }
}

/**
 * Remove sandbox entries from threadSandboxMap that are older than THREAD_TTL_MS.
 * Properly releases sandboxes back to the pool and disposes backends.
 */
async function cleanupOldEntriesFromThreadSandboxMap(): Promise<void> {
  const now = Date.now();
  const threadsToDelete: Array<{
    threadId: string;
    entry: {
      backend: SandboxService;
      profile: SandboxProfile;
      repo: { owner: string; name: string; workspaceDir: string };
      lastAccessed: number;
    };
  }> = [];

  for (const [threadId, entry] of threadSandboxMap.entries()) {
    const age = now - entry.lastAccessed;
    if (age > THREAD_TTL_MS) {
      threadsToDelete.push({ threadId, entry });
    }
  }

  // Release sandboxes back to the pool and dispose backends in parallel
  await Promise.all(
    threadsToDelete.map(async ({ threadId, entry }) => {
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
          "[deepagents] Failed to release old sandbox",
        );
      }
      try {
        await entry.backend.cleanup();
      } catch (err) {
        logger.warn(
          { error: err, threadId },
          "[deepagents] Failed to cleanup old backend",
        );
      }
      clearSandboxBackend(threadId);
      // Clean up tool invocation tracking for this thread
      toolInvocationTracker.clearThread(threadId);
      // Remove from map
      threadSandboxMap.delete(threadId);
      logger.debug(
        { threadId, ageMs: now - entry.lastAccessed },
        "[deepagents] Cleaned up old sandbox entry",
      );
    }),
  );

  if (threadsToDelete.length > 0) {
    logger.info(
      { count: threadsToDelete.length },
      "[deepagents] Cleaned up old sandbox entries",
    );
  }
}

/**
 * Remove repo entries from threadRepoMap that are older than THREAD_TTL_MS.
 * Also removes persisted thread metadata for cleaned entries.
 */
async function cleanupOldEntriesFromThreadRepoMap(): Promise<void> {
  const now = Date.now();
  const threadsToDelete: string[] = [];

  for (const [threadId, entry] of threadRepoMap.entries()) {
    const age = now - entry.lastAccessed;
    if (age > THREAD_TTL_MS) {
      threadsToDelete.push(threadId);
    }
  }

  for (const threadId of threadsToDelete) {
    // Remove persisted thread metadata
    try {
      await removePersistedThreadRepo(threadId);
    } catch (err) {
      logger.warn(
        { error: err, threadId },
        "[deepagents] Failed to remove persisted thread repo",
      );
    }
    // Remove from map
    threadRepoMap.delete(threadId);
    logger.debug(
      { threadId },
      "[deepagents] Cleaned up old repo entry",
    );
  }

  if (threadsToDelete.length > 0) {
    logger.info(
      { count: threadsToDelete.length },
      "[deepagents] Cleaned up old repo entries",
    );
  }
}

/**
 * Master cleanup function that removes old entries from all thread maps.
 * This should be called periodically or before accessing thread maps.
 *
 * This function:
 * 1. Removes old agent entries from threadAgentMap
 * 2. Releases old sandboxes from threadSandboxMap
 * 3. Removes old repo entries from threadRepoMap
 *
 * The cleanup is time-based (TTL) and prevents unbounded memory growth
 * from abandoned threads.
 */
export async function cleanupThreadMaps(): Promise<void> {
  const startTime = Date.now();

  // Clean up agent entries (synchronous)
  cleanupOldEntriesFromThreadAgentMap();

  // Clean up sandbox entries (asynchronous - releases resources)
  await cleanupOldEntriesFromThreadSandboxMap();

  // Clean up repo entries (asynchronous - removes persisted metadata)
  await cleanupOldEntriesFromThreadRepoMap();

  const duration = Date.now() - startTime;
  if (duration > 100) {
    logger.debug(
      { durationMs: duration },
      "[deepagents] Thread maps cleanup completed",
    );
  }
}

async function createAgentInstance(args: {
  workspaceRoot?: string;
  backend?: SandboxService | FilesystemBackend;
}): Promise<DeepAgent> {
  const modelConfig = loadModelConfig();
  const chatModel = await createChatModel(modelConfig);
  const { fallback } = loadLlmConfig();

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
        // Use environment variables or defaults
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
    // Custom: track and limit tool invocations to prevent runaway loops
    createToolInvocationLimitsMiddleware(),
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
        "[deepagents] Failed to create fallback model, skipping",
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

  const config: any = {
    model: chatModel,
    systemPrompt: constructSystemPrompt(args.workspaceRoot || process.cwd()),
    checkpointer: new MemorySaver(),
    tools,
    middleware,
  };

  if (args.backend) {
    config.backend = args.backend;
  }

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

  const agent = createDeepAgent(config);
  return agent;
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
    return toolCalls.reduce(
      (acc, t, i) => acc + (i === 0 ? "" : ", ") + (t.name ?? "?"),
      " → ",
    );
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
  console.error(
    `[agent-trace] [${src}] ${mode} ${stringifyPayloadForTrace(payload, 280)}`,
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
const threadRepoMap = new Map<
  string,
  { owner: string; name: string; workspaceDir: string; lastAccessed: number }
>();

function getSandboxProfileFromEnv(): SandboxProfile {
  const p = (process.env.SANDBOX_PROFILE || "typescript").trim().toLowerCase();
  if (
    p === "typescript" ||
    p === "javascript" ||
    p === "python" ||
    p === "java" ||
    p === "polyglot"
  ) {
    return p;
  }
  return "typescript";
}

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

export class DeepAgentWrapper implements AgentHarness {
  constructor() {}

  private async prepareAgent(input: string, threadId: string) {
    if (!hasLoadedPersistedRepos) {
      const persisted = await loadPersistedThreadRepos();
      for (const [id, repo] of persisted.entries()) {
        setThreadRepo(threadRepoMap, id, repo);
      }
      hasLoadedPersistedRepos = true;
    }

    const parsedRepo = extractRepoFromInput(input);
    let activeRepo:
      | { owner: string; name: string; workspaceDir: string; lastAccessed: number }
      | undefined = threadRepoMap.get(threadId);
    if (activeRepo) {
      updateThreadRepoAccess(threadRepoMap, threadId);
    }
    const profile = getSandboxProfileFromEnv();

    const sandboxEntry = threadSandboxMap.get(threadId);
    if (sandboxEntry) {
      updateThreadSandboxAccess(threadSandboxMap, threadId);
    }
    const hasBackendForThread = Boolean(sandboxEntry?.backend);

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
      const prior = threadSandboxMap.get(threadId);
      if (prior) {
        updateThreadSandboxAccess(threadSandboxMap, threadId);
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
        threadSandboxMap.delete(threadId);
        threadAgentMap.delete(threadId);
        clearSandboxBackend(threadId);
        // Clean up tool invocation tracking for this thread
        toolInvocationTracker.clearThread(threadId);
        await removePersistedThreadRepo(threadId);
      }

      if (useSandbox) {
        const provider = process.env.SANDBOX_PROVIDER || "opensandbox";
        const cloneStart = Date.now();

        if (provider === "daytona") {
          const { backend, workspaceDir } =
            await acquireDaytonaSandboxForThreadRepo({
              threadId,
              repoOwner: parsedRepo.owner,
              repoName: parsedRepo.name,
              profile,
            });
          logger.info(
            `[deepagents] Repo acquire+clone took ${Date.now() - cloneStart}ms`,
          );

          activeRepo = { ...parsedRepo, workspaceDir, lastAccessed: Date.now() };
          setThreadRepo(threadRepoMap, threadId, activeRepo);
          const { lastAccessed, ...repoForPersistence } = threadRepoMap.get(
            threadId,
          ) || { owner: parsedRepo.owner, name: parsedRepo.name, workspaceDir };
          await persistThreadRepo(threadId, {
            ...repoForPersistence,
            sandbox: {
              sandboxId: backend.id,
              profile,
            },
          });

          setThreadSandbox(threadSandboxMap, threadId, {
            backend,
            profile,
            repo: activeRepo,
          });
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
        } else {
          const backend = await createSandboxServiceWithConfig({
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
          const workspaceDir = await backend.cloneRepo(
            parsedRepo.owner,
            parsedRepo.name,
            process.env.GITHUB_TOKEN,
          );

          logger.info(
            `[deepagents] OpenSandbox repo acquire+clone took ${Date.now() - cloneStart}ms`,
          );

          activeRepo = { ...parsedRepo, workspaceDir, lastAccessed: Date.now() };
          setThreadRepo(threadRepoMap, threadId, activeRepo);
          const { lastAccessed, ...repoForPersistence } = threadRepoMap.get(
            threadId,
          ) || { owner: parsedRepo.owner, name: parsedRepo.name, workspaceDir };
          await persistThreadRepo(threadId, {
            ...repoForPersistence,
            sandbox: {
              sandboxId: backend.id,
              profile,
            },
          });

          setThreadSandbox(threadSandboxMap, threadId, {
            backend,
            profile,
            repo: activeRepo,
          });
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
        }
      } else {
        activeRepo = {
          ...parsedRepo,
          workspaceDir: `/workspace/${parsedRepo.name}`,
          lastAccessed: Date.now(),
        };
        setThreadRepo(threadRepoMap, threadId, activeRepo);
        const { lastAccessed, ...repoForPersistence } = threadRepoMap.get(
          threadId,
        ) || { owner: parsedRepo.owner, name: parsedRepo.name, workspaceDir: activeRepo.workspaceDir };
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

    // Pass tools to configurable so tool_search can access them
    const currentTools = useSandbox ? sandboxAllTools : allTools;
    configurable.tools = currentTools;

    // Get or create a DeepAgent instance for this thread.
    let agentEntry = threadAgentMap.get(threadId);
    if (agentEntry) {
      updateThreadAgentAccess(threadAgentMap, threadId);
    }
    let agent = agentEntry?.agent;
    if (!agent) {
      if (useSandbox) {
        const backend = threadSandboxMap.get(threadId)?.backend;
        if (!backend) {
          throw new Error(
            "Sandbox mode is enabled but no sandbox backend is available. Provide --repo or configure a default sandbox.",
          );
        }
        agent = await createAgentInstance({
          workspaceRoot: activeRepo?.workspaceDir,
          backend,
        });
      } else if (activeRepo?.workspaceDir) {
        agent = await createAgentInstance({
          workspaceRoot: activeRepo.workspaceDir,
          backend: new FilesystemBackend({
            rootDir: activeRepo.workspaceDir,
            virtualMode: false,
          }),
        });
      } else {
        agent = await createAgentInstance({});
      }

      setThreadAgent(threadAgentMap, threadId, agent);
      logger.info({ threadId }, `[deepagents] Agent initialized for thread`);
    }
    return { agent, configurable, activeRepo };
  }

  async invoke(
    input: string,
    options?: AgentInvokeOptions,
  ): Promise<AgentResponse> {
    const startTime = Date.now();
    try {
      const threadId = options?.threadId || "default-session";
      let { agent, configurable } = await this.prepareAgent(input, threadId);
      const activeRepo = threadRepoMap.get(threadId);
      if (activeRepo) {
        updateThreadRepoAccess(threadRepoMap, threadId);
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
      const sandboxEntry = threadSandboxMap.get(threadId);
      if (sandboxEntry) {
        updateThreadSandboxAccess(threadSandboxMap, threadId);
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
        ? createTrace("agent-turn", threadId)
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
          langfuseTrace.update({ input: modifiedInput });
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
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error(
          { threadId, elapsedMs: Date.now() - agentStart, message: errorMsg },
          "[deepagents] Invoke failed",
        );
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
          output: responseText,
          metadata: {
            totalMessages: messages.length,
            responseLength: responseText.length,
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
          const sandboxEntry = threadSandboxMap.get(threadId);

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
            ? threadSandboxMap.get(threadId)?.backend
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
    const agentEntry = threadAgentMap.get(threadId);
    if (!agentEntry) return null;
    updateThreadAgentAccess(threadAgentMap, threadId);
    return agentEntry.agent.getState({ configurable: { thread_id: threadId } });
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
      setThreadRepo(threadRepoMap, id, repo);
    }
    hasLoadedPersistedRepos = true;
  }

  // Initialize snapshot store for fast sandbox initialization
  const { initializeSnapshotStore } = await import("../sandbox");
  try {
    await initializeSnapshotStore();
    logger.info("[deepagents] Snapshot store initialized");
  } catch (err) {
    logger.warn(
      { error: err },
      "[deepagents] Failed to initialize snapshot store",
    );
  }

  await getAgentHarness();
}

/**
 * Cleanup function to properly shutdown agent and sandbox.
 * Should be called on application shutdown.
 */
export async function cleanupDeepAgents(): Promise<void> {
  logger.info("[deepagents] Cleaning up...");

  // Release sandboxes back to the pool and dispose backends in parallel.
  await Promise.all(
    Array.from(threadSandboxMap.entries()).map(async ([threadId, entry]) => {
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
    }),
  );
  threadSandboxMap.clear();
  threadAgentMap.clear();
  threadRepoMap.clear();

  // Shutdown Langfuse to flush any pending traces
  if (isLangfuseEnabled()) {
    logger.info("[deepagents] Flushing Langfuse traces...");
    await shutdownLangfuse();
  }

  logger.info("[deepagents] Cleanup complete");
}

// Exposed for testing purposes
export function resetDeepAgentsStateForTesting(): void {
  hasLoadedPersistedRepos = false;
  threadRepoMap.clear();
  threadSandboxMap.clear();
  threadAgentMap.clear();
}

export function getThreadRepoMapForTesting() {
  return threadRepoMap;
}
