import { createLogger } from "../../utils/logger";
import { threadManager, threadRepoMap, THREAD_TTL_MS } from "../thread-manager";
import {
  isLangfuseEnabled,
  shutdownLangfuse,
} from "../../utils/langfuse";
import {
  startThreadCleanupScheduler,
  stopThreadCleanupScheduler,
  type ThreadMapCleanupFn,
} from "../../utils/thread-cleanup-scheduler";
import { getAgentHarness } from "./wrapper";
import { releaseRepoSandbox } from "../../integrations/daytona-pool";
import {
  loadPersistedThreadRepos,
} from "../../utils/thread-metadata-store";
import { clearSandboxBackend } from "../../utils/sandboxState";
import { toolInvocationTracker } from "../../middleware/tool-invocation-limits";

const logger = createLogger("deepagents");

export let hasLoadedPersistedRepos = false;

export function setHasLoadedPersistedRepos(val: boolean) {
  hasLoadedPersistedRepos = val;
}

export async function cleanupThreadMaps(ttlMs: number = 3600000): Promise<number> {
  const before = threadManager.threadAgentMap.size + threadManager.threadSandboxMap.size + threadManager.threadRepoMap.size;
  threadManager.purgeStale();
  const after = threadManager.threadAgentMap.size + threadManager.threadSandboxMap.size + threadManager.threadRepoMap.size;
  return before - after;
}

export async function initDeepAgentsAtStartup(): Promise<void> {
  if (!hasLoadedPersistedRepos) {
    const persisted = await loadPersistedThreadRepos();
    for (const [id, repo] of persisted.entries()) {
      threadManager.setRepo( id,  repo);
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
    Array.from(threadManager.threadSandboxMap.entries()).map(async ([threadId, entry]) => {
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
