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
  summarizationMiddleware,
  contextEditingMiddleware,
  ClearToolUsesEdit,
  todoListMiddleware,
} from "langchain";
import { createLoopDetectionMiddleware } from "../middleware/loop-detection";
import { createEnsureNoEmptyMsgMiddleware } from "../middleware/ensure-no-empty-msg";
import type {
  AgentHarness,
  AgentInvokeOptions,
  AgentResponse,
} from "./agentHarness";
import { constructSystemPrompt } from "../prompt";
import { allTools, sandboxAllTools } from "../tools";
import { writeRepoMemoryAfterAgentTurn } from "../memory/supabaseRepoMemory";
import { openPrIfNeeded } from "../middleware/open-pr";
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
const AGENT_RECURSION_LIMIT = Number.parseInt(process.env.AGENT_RECURSION_LIMIT || "150", 10);
let hasLoadedPersistedRepos = false;

async function createAgentInstance(args: {
  workspaceRoot?: string;
  backend?: SandboxService | FilesystemBackend;
}): Promise<DeepAgent> {
  const modelConfig = loadModelConfig();
  const chatModel = await createChatModel(modelConfig);
  const { fallback } = loadLlmConfig();

  const middleware: any[] = [
    // Planning: gives agent a write_todos tool for task tracking
    todoListMiddleware(),
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
    // Context management: summarize older messages
    summarizationMiddleware({
      model: chatModel,
      maxTokensBeforeSummary: 80000,
      messagesToKeep: 30,
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
      logger.warn({ err }, "[deepagents] Failed to create fallback model, skipping");
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

  const agent = await createDeepAgent(config);
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
  trace: { midLine: boolean },
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
      console.error(`[agent-trace] [${src}] step: ${parts.join(", ")}`);
    } else {
      console.error(
        `[agent-trace] [${src}] updates ${stringifyPayloadForTrace(payload, 400)}`,
      );
    }
    return;
  }

  if (mode === "messages") {
    const tuple = payload as [Record<string, unknown>?, { langgraph_node?: string }?];
    const msg = tuple?.[0];
    const meta = tuple?.[1];
    if (!msg || typeof msg !== "object") return;
    const node = meta?.langgraph_node ?? "?";

    const toolChunks = msg.tool_call_chunks as
      | Array<{ name?: string; args?: string }>
      | undefined;
    if (toolChunks?.length) {
      if (trace.midLine) {
        process.stderr.write("\n");
        trace.midLine = false;
      }
      for (const tc of toolChunks) {
        if (tc.name) console.error(`[agent-trace] [${src}] tool-call: ${tc.name}`);
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
      const body = typeof msg.content === "string" ? msg.content : stringifyPayloadForTrace(msg.content, 200);
      console.error(
        `[agent-trace] [${src}] tool-result (${String(name ?? "?")} @${node}): ${trimStr(body, 240)}`,
      );
      return;
    }

    console.error(`[agent-trace] [${src}] ${String(role)} @${node}`);
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
  const trace = { midLine: false };

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
    cpu: process.env.DAYTONA_CPU ? parseInt(process.env.DAYTONA_CPU, 10) : undefined,
    memory: process.env.DAYTONA_MEMORY
      ? parseInt(process.env.DAYTONA_MEMORY, 10)
      : undefined,
    disk: process.env.DAYTONA_DISK ? parseInt(process.env.DAYTONA_DISK, 10) : undefined,
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

  async invoke(
    input: string,
    options?: AgentInvokeOptions,
  ): Promise<AgentResponse> {
    const startTime = Date.now();
    try {
      if (!hasLoadedPersistedRepos) {
        const persisted = await loadPersistedThreadRepos();
        for (const [id, repo] of persisted.entries()) {
          threadRepoMap.set(id, repo);
        }
        hasLoadedPersistedRepos = true;
      }

      const threadId = options?.threadId || "default-session";
      const parsedRepo = extractRepoFromInput(input);
      let activeRepo = threadRepoMap.get(threadId);
      const profile = getSandboxProfileFromEnv();

      const hasBackendForThread = Boolean(threadSandboxMap.get(threadId)?.backend);

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
          await removePersistedThreadRepo(threadId);
        }

        if (useSandbox) {
          const provider = process.env.SANDBOX_PROVIDER || "opensandbox";
          const cloneStart = Date.now();

          if (provider === "daytona") {
            const { backend, workspaceDir } = await acquireDaytonaSandboxForThreadRepo({
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
        logger.info(
          { threadId },
          `[deepagents] Agent initialized for thread`,
        );
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
          console.error(
            "\n[agent-trace] Streaming agent run to stderr (set AGENT_TRACE_STDERR=false to disable).\n",
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
          reply: "The coding model encountered an error. Please retry shortly or switch to a different MODEL/provider.",
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
              const truncatedArgs = argsStr.length > 500 ? argsStr.substring(0, 500) + "..." : argsStr;
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
                console.log(`     Input: ${JSON.stringify(item.input, null, 2)}`);
              } else if (item.type === "tool_result") {
                console.log(`  ✅ Tool result: ${item.tool_use_id}`);
                if (item.is_error) {
                  console.log(`     ❌ Error: ${item.content}`);
                } else {
                  const contentStr = typeof item.content === "string" ? item.content : JSON.stringify(item.content);
                  const truncated = contentStr.length > 300 ? contentStr.substring(0, 300) + "..." : contentStr;
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

      const responseText = typeof text === "string" ? text : JSON.stringify(text);

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
          const expectedSandbox = useSandbox ? threadSandboxMap.get(threadId)?.backend : undefined;
          await openPrIfNeeded(
            { messages },
            { configurable },
            expectedSandbox,
            activeRepo.workspaceDir
          );
        } catch (prErr) {
          logger.error({ err: prErr }, "[deepagents] openPrIfNeeded middleware failed");
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
    // TODO: implement pooled sandbox acquisition for streaming.
    // For now, fall back to non-streaming behavior to avoid mixed backends.
    const result = await this.invoke(input, options);
    yield { messages: [{ role: "assistant", content: result.reply }] };
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
    }),
  );
  threadSandboxMap.clear();
  threadAgentMap.clear();
  threadRepoMap.clear();
  logger.info("[deepagents] Cleanup complete");
}
