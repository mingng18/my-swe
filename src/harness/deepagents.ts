import { createLogger } from "../utils/logger";
import { loadLlmConfig } from "../utils/config";
import { createDeepAgent, FilesystemBackend, type DeepAgent } from "deepagents";
import { MemorySaver } from "@langchain/langgraph";
import type {
  AgentHarness,
  AgentInvokeOptions,
  AgentResponse,
} from "./agentHarness";
import { constructSystemPrompt } from "../prompt";
import { allTools, sandboxAllTools } from "../tools";
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
const RETRY_ATTEMPTS = Number.parseInt(process.env.LLM_RETRY_ATTEMPTS || "3", 10);
const RETRY_BASE_MS = Number.parseInt(process.env.LLM_RETRY_BASE_MS || "750", 10);
let hasLoadedPersistedRepos = false;

async function createAgentInstance(args: {
  workspaceRoot?: string;
  backend?: SandboxService | FilesystemBackend;
  llmOverride?: {
    openaiBaseUrl: string;
    openaiApiKey: string;
    model: string;
  };
}): Promise<DeepAgent> {
  const { model, openaiApiKey, openaiBaseUrl } = args.llmOverride || loadLlmConfig();

  // Prefix with 'openai:' to force LangChain's initChatModel to use the OpenAI provider
  // This solves "Unable to infer model provider" for models like GLM-4.7
  const modelStr = model.includes(":") ? model : `openai:${model}`;

  const config: any = {
    model: modelStr,
    apiKey: openaiApiKey,
    apiBaseUrl: openaiBaseUrl,
    systemPrompt: constructSystemPrompt(args.workspaceRoot || process.cwd()),
    checkpointer: new MemorySaver(),
    tools: useSandbox ? sandboxAllTools : allTools,
  };

  if (args.backend) {
    config.backend = args.backend;
  }

  const agent = await createDeepAgent(config);
  return agent;
}

function isRateLimitError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes("429") ||
    message.toLowerCase().includes("rate limit") ||
    message.includes("MODEL_RATE_LIMIT")
  );
}

function isTransientInvokeError(err: unknown): boolean {
  if (isRateLimitError(err)) return true;
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("temporar") ||
    message.includes("econnreset") ||
    message.includes("503") ||
    message.includes("502")
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
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

// Keep track of the last specified repository per thread.
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

      logger.info(
        `[deepagents] Calling DeepAgent invoke (input length: ${input.length} chars)`,
      );
      const agentStart = Date.now();
      let result: any;
      let lastError: unknown;
      let usedFallback = false;
      const { fallback } = loadLlmConfig();

      for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
        let invokeProgressTicker: ReturnType<typeof setInterval> | undefined;
        try {
          invokeProgressTicker = setInterval(() => {
            const elapsedMs = Date.now() - agentStart;
            logger.info(
              { threadId, elapsedMs, phase: "agent_invoke", attempt },
              "[deepagents] Invoke still running",
            );
          }, 10_000);

          result = await agent.invoke(
            { messages: [{ role: "user", content: input }] },
            { configurable },
          );
          break;
        } catch (err) {
          lastError = err;
          const shouldRetry = attempt < RETRY_ATTEMPTS && isTransientInvokeError(err);
          logger.warn(
            { threadId, attempt, shouldRetry, message: err instanceof Error ? err.message : String(err) },
            "[deepagents] Invoke attempt failed",
          );
          if (shouldRetry) {
            const backoffMs = RETRY_BASE_MS * 2 ** (attempt - 1);
            await sleep(backoffMs);
            continue;
          }

          if (!usedFallback && fallback && isRateLimitError(err)) {
            usedFallback = true;
            logger.warn(
              { threadId, attempt },
              "[deepagents] Switching to fallback model/provider after rate limit",
            );
            const backendForNewAgent = useSandbox
              ? threadSandboxMap.get(threadId)?.backend
              : activeRepo?.workspaceDir
                ? new FilesystemBackend({
                    rootDir: activeRepo.workspaceDir,
                    virtualMode: false,
                  })
                : undefined;
            agent = await createAgentInstance({
              workspaceRoot: activeRepo?.workspaceDir,
              backend: backendForNewAgent,
              llmOverride: fallback,
            });
            threadAgentMap.set(threadId, agent);
            attempt--;
            continue;
          }
          break;
        } finally {
          if (invokeProgressTicker) {
            clearInterval(invokeProgressTicker);
          }
        }
      }

      if (!result) {
        const finalMessage =
          (lastError instanceof Error ? lastError.message : String(lastError)) ||
          "Unknown DeepAgents invoke failure";
        const degradedReply =
          "The coding model is temporarily unavailable after retries. " +
          "Please retry shortly or switch to a different MODEL/provider.";
        logger.error(
          { threadId, elapsedMs: Date.now() - agentStart, message: finalMessage },
          "[deepagents] Invoke failed after retries",
        );
        return { reply: degradedReply, error: finalMessage };
      }

      logger.info(
        `[deepagents] DeepAgent invoke completed in ${Date.now() - agentStart}ms`,
      );

      const messages = result.messages || [];
      const lastMessage = messages[messages.length - 1];
      const text = lastMessage?.content || "";

      logger.info(
        `[deepagents] Total invoke time: ${Date.now() - startTime}ms`,
      );

      return {
        reply: typeof text === "string" ? text : JSON.stringify(text),
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
 * Cleanup function to properly shutdown the agent and sandbox.
 * Should be called on application shutdown.
 */
export async function cleanupDeepAgents(): Promise<void> {
  logger.info("[deepagents] Cleaning up...");

  // Release sandboxes back to the pool and dispose backends.
  for (const [threadId, entry] of threadSandboxMap.entries()) {
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
      logger.warn({ error: err, threadId }, "[deepagents] Failed to release sandbox");
    }
    try {
      await entry.backend.cleanup();
    } catch (err) {
      logger.warn({ error: err, threadId }, "[deepagents] Failed to cleanup backend");
    }
    clearSandboxBackend(threadId);
  }
  threadSandboxMap.clear();
  threadAgentMap.clear();
  threadRepoMap.clear();
  logger.info("[deepagents] Cleanup complete");
}
