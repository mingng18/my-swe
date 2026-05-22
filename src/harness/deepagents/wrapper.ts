import { loadModelConfig } from "../../utils/config";
import { createLogger } from "../../utils/logger";
import { threadManager, type RepoContext } from "../thread-manager";
import { isLangfuseEnabled, createTrace, maskSensitiveData, flushLangfuse } from "../../utils/langfuse";
import type { AgentHarness, AgentInvokeOptions, AgentResponse } from "../agentHarness";
import { allTools, sandboxAllTools } from "../../tools";
import { writeRepoMemoryAfterAgentTurn } from "../../memory/supabaseRepoMemory";
import { openPrIfNeeded } from "../../middleware/open-pr";
import { gitHasUncommittedChanges, gitCleanRepository, gitPull } from "../../utils/github";
import { releaseRepoSandbox } from "../../integrations/daytona-pool";
import { loadPersistedThreadRepos, persistThreadRepo, removePersistedThreadRepo } from "../../utils/thread-metadata-store";
import { clearSandboxBackend } from "../../utils/sandboxState";
import { type BaseMessage, type ToolCall } from "@langchain/core/messages";

// Import from sibling modules
import { emitStreamEvent } from "./events";
import { shouldTraceAgentToTerminal, runDeepAgentWithStreamTrace } from "./trace";
import { extractRepoFromInput, getSandboxProfileFromEnv, resolveSandboxContext } from "./sandbox";
import { createAgentInstance } from "./factory";
import { hasLoadedPersistedRepos, setHasLoadedPersistedRepos } from "./lifecycle";
import { FilesystemBackend } from "deepagents";
import { toolInvocationTracker } from "../../middleware/tool-invocation-limits";
import { getThreadCleanupScheduler } from "../../utils/thread-cleanup-scheduler";

const logger = createLogger("deepagents");
const useSandbox = process.env.USE_SANDBOX === "true";
const AGENT_RECURSION_LIMIT = Number.parseInt(process.env.AGENT_RECURSION_LIMIT || "1000", 10);

export class DeepAgentWrapper implements AgentHarness {
  constructor() {}

  private async prepareAgent(input: string, threadId: string) {
    if (!hasLoadedPersistedRepos) {
      const persisted = await loadPersistedThreadRepos();
      for (const [id, repo] of persisted.entries()) {
        threadManager.setRepo( id,  repo);
      }
      setHasLoadedPersistedRepos(true);
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
    const scheduler = await import("../../utils/thread-cleanup-scheduler").then(m => m.getThreadCleanupScheduler());
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
        const context = await resolveSandboxContext(threadId, parsedRepo, profile);
        activeRepo = context.activeRepo;
      } else {
        activeRepo = {
          ...parsedRepo,
          workspaceDir: `/workspace/${parsedRepo.name}`,
          lastAccessed: Date.now(),
        };
        threadManager.setRepo( threadId,  activeRepo);
        const { lastAccessed, ...repoForPersistence } = threadManager.getRepo(
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

      threadManager.setAgent( threadId,  agent);
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

      let { agent, configurable } = await this.prepareAgent(input, threadId);
      const activeRepo = threadManager.getRepo(threadId);
      if (activeRepo) {

      }

      // Mark thread as accessed in cleanup scheduler
      const scheduler = await import("../../utils/thread-cleanup-scheduler").then(m => m.getThreadCleanupScheduler());
      if (scheduler) {
        scheduler.markAccessed(threadId);
      }

      // Blueprint selection: Choose workflow template based on task keywords
      // This is a lightweight operation that just returns metadata
      // The actual execution is still handled by DeepAgents + middleware
      const { selectOldBlueprint, buildInputWithBlueprint } =
        await import("../../blueprints");
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
            await import("../../utils/pr-context");
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
      const invokeScheduler = await import("../../utils/thread-cleanup-scheduler").then(m => m.getThreadCleanupScheduler());
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
              repo: activeRepo ? `${activeRepo.owner}/${activeRepo.name}` : undefined,
            },
          });
        }

        // Emit LLM start
        const modelConfig = loadModelConfig();
        const model = modelConfig.model || "unknown";
        emitStreamEvent(threadId, {
          type: "llm_start",
          model,
          timestamp: Date.now(),
        });

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

        // Emit LLM end
        emitStreamEvent(threadId, {
          type: "llm_end",
          totalTokens: Math.round(totalTokens),
          timestamp: Date.now(),
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
            await import("../../nodes/deterministic");
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
    const scheduler = await import("../../utils/thread-cleanup-scheduler").then(m => m.getThreadCleanupScheduler());
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
