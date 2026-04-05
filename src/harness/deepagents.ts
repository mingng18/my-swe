import { createLogger } from "../utils/logger";
import { loadLlmConfig, loadModelConfig } from "../utils/config";
import { createChatModel } from "../utils/model-factory";
import { createDeepAgent, FilesystemBackend, type DeepAgent } from "deepagents";
import { MemorySaver } from "@langchain/langgraph";
import {
  modelRetryMiddleware,
  modelFallbackMiddleware,
  toolRetryMiddleware,
  modelCallLimitMiddleware,
  contextEditingMiddleware,
  ClearToolUsesEdit,
} from "langchain";
import { createLoopDetectionMiddleware } from "../middleware/loop-detection";
import { createEnsureNoEmptyMsgMiddleware } from "../middleware/ensure-no-empty-msg";
import { toolInvocationTracker } from "../middleware/tool-invocation-limits";
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

const logger = createLogger("deepagents");

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

const threadAgentMap = new Map<string, DeepAgent>();
const threadSandboxMap = new Map<
  string,
  {
    backend: SandboxService;
    profile: SandboxProfile;
    repo: { owner: string; name: string; workspaceDir: string };
  }
>();

// Check if sandbox mode is enabled via environment variable
const useSandbox = process.env.USE_SANDBOX === "true";
const AGENT_RECURSION_LIMIT = Number.parseInt(
  process.env.AGENT_RECURSION_LIMIT || "500",
  10,
);
let hasLoadedPersistedRepos = false;

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
    // Context management: clear old tool results
    contextEditingMiddleware({
      edits: [
        new ClearToolUsesEdit({
          trigger: { tokens: 100000 },
          keep: { messages: 5 },
        }),
      ],
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

  const config: any = {
    model: chatModel,
    systemPrompt: constructSystemPrompt(args.workspaceRoot || process.cwd()),
    checkpointer: new MemorySaver(),
    tools: useSandbox ? sandboxAllTools : allTools,
    middleware,
  };

  if (args.backend) {
    config.backend = args.backend;
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
    return ` → ${toolCalls.map((t) => t.name ?? "?").join(", ")}`;
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
  { owner: string; name: string; workspaceDir: string }
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
    image: process.env.DAYTONA_IMAGE || "debian:12.9",
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
        threadRepoMap.set(id, repo);
      }
      hasLoadedPersistedRepos = true;
    }

    const parsedRepo = extractRepoFromInput(input);
    let activeRepo = threadRepoMap.get(threadId);
    const profile = getSandboxProfileFromEnv();

    const hasBackendForThread = Boolean(
      threadSandboxMap.get(threadId)?.backend,
    );

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

          activeRepo = { ...parsedRepo, workspaceDir };
          threadRepoMap.set(threadId, activeRepo);
          await persistThreadRepo(threadId, {
            ...activeRepo,
            sandbox: {
              sandboxId: backend.id,
              profile,
            },
          });

          threadSandboxMap.set(threadId, {
            backend,
            profile,
            repo: activeRepo,
          });
          setSandboxBackend(threadId, backend);
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

          activeRepo = { ...parsedRepo, workspaceDir };
          threadRepoMap.set(threadId, activeRepo);
          await persistThreadRepo(threadId, {
            ...activeRepo,
            sandbox: {
              sandboxId: backend.id,
              profile,
            },
          });

          threadSandboxMap.set(threadId, {
            backend,
            profile,
            repo: activeRepo,
          });
          setSandboxBackend(threadId, backend);
        }
      } else {
        activeRepo = {
          ...parsedRepo,
          workspaceDir: `/workspace/${parsedRepo.name}`,
        };
        threadRepoMap.set(threadId, activeRepo);
        await persistThreadRepo(threadId, activeRepo);
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

    // Get or create a DeepAgent instance for this thread.
    let agent = threadAgentMap.get(threadId);
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

      threadAgentMap.set(threadId, agent);
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

      // Clean repository state before agent run if using sandbox
      // This prevents the agent from being confused by leftover changes from previous runs
      const sandboxEntry = threadSandboxMap.get(threadId);
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

      // Log the input being sent to the agent
      console.log("");
      console.log("=== Agent Input ===");
      console.log(input);
      console.log("=== End Agent Input ===");
      console.log("");

      const agentStart = Date.now();
      let result: any;

      const traceTerminal = shouldTraceAgentToTerminal();

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
        result = traceTerminal
          ? await runDeepAgentWithStreamTrace(agent, input, configurable)
          : await agent.invoke(
              { messages: [{ role: "user", content: input }] },
              { configurable, recursionLimit: AGENT_RECURSION_LIMIT },
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

      // Log all messages with detailed information
      console.log("");
      console.log("=".repeat(80));
      console.log("=== Agent Execution Log ===");
      console.log("=".repeat(80));
      console.log("");

      messages.forEach((msg: any, index: number) => {
        console.log(`[Message ${index + 1}]`);
        console.log(`Role: ${msg.role}`);
        console.log(`Type: ${msg.type || "message"}`);

        if (msg.type === "tool" || msg.tool_calls) {
          console.log("  📦 Tool Calls:");
          const toolCalls = msg.tool_calls || [];
          toolCalls.forEach((tc: any) => {
            console.log(`     • ${tc.name} (ID: ${tc.id})`);
            if (tc.args) {
              const argsStr = JSON.stringify(tc.args, null, 2);
              const truncatedArgs =
                argsStr.length > 500
                  ? argsStr.substring(0, 500) + "..."
                  : argsStr;
              console.log(`       Arguments: ${truncatedArgs}`);
            }
          });
        }

        if (msg.content) {
          console.log("Content:");
          if (typeof msg.content === "string") {
            console.log(`  💭 ${msg.content}`);
          } else if (Array.isArray(msg.content)) {
            msg.content.forEach((item: any) => {
              if (item.type === "text") {
                console.log(`  💭 ${item.text}`);
              } else if (item.type === "tool_use") {
                console.log(`  🛠️  Calling tool: ${item.name}`);
                console.log(`     ID: ${item.id}`);
                console.log(
                  `     Input: ${JSON.stringify(item.input, null, 2)}`,
                );
              } else if (item.type === "tool_result") {
                console.log(`  ✅ Tool result: ${item.tool_use_id}`);
                if (item.is_error) {
                  console.log(`     ❌ Error: ${item.content}`);
                } else {
                  const contentStr =
                    typeof item.content === "string"
                      ? item.content
                      : JSON.stringify(item.content);
                  const truncated =
                    contentStr.length > 300
                      ? contentStr.substring(0, 300) + "..."
                      : contentStr;
                  console.log(`     📄 Result: ${truncated}`);
                }
              }
            });
          }
        }

        console.log("");
        console.log("-".repeat(80));
        console.log("");
      });

      const responseText =
        typeof text === "string" ? text : JSON.stringify(text);

      logger.info(
        { responseLength: responseText, totalMessages: messages.length },
        `[deepagents] Agent response received (${responseText.length} chars, ${messages.length} messages total)`,
      );

      console.log("=".repeat(80));
      console.log("=== Final Agent Response ===");
      console.log("=".repeat(80));
      console.log(responseText);
      console.log("=".repeat(80));
      console.log("");

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
    const agent = threadAgentMap.get(threadId);
    if (!agent) return null;
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
      threadRepoMap.set(id, repo);
    }
    hasLoadedPersistedRepos = true;
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
  logger.info("[deepagents] Cleanup complete");
}
