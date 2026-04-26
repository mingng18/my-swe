import { LRUCache } from "lru-cache";
import type { DeepAgent } from "deepagents";
import type { SandboxService } from "../integrations/sandbox-service";
import type { SandboxProfile } from "../integrations/daytona-pool";
import { releaseRepoSandbox } from "../integrations/daytona-pool";
import { clearSandboxBackend } from "../utils/sandboxState";
import { toolInvocationTracker } from "../middleware/tool-invocation-limits";
import { removePersistedThreadRepo } from "../utils/thread-metadata-store";
import { createLogger } from "../utils/logger";

const logger = createLogger("thread-manager");

export interface RepoContext {
  owner: string;
  name: string;
  workspaceDir: string;
}

export interface ThreadSandboxEntry {
  backend: SandboxService;
  profile: SandboxProfile;
  repo: RepoContext;
}

const THREAD_TTL_MS = Number.parseInt(process.env.THREAD_TTL_MS || "3600000", 10);

export class ThreadManager {
  public threadAgentMap: LRUCache<string, DeepAgent>;
  public threadSandboxMap: LRUCache<string, ThreadSandboxEntry>;
  public threadRepoMap: LRUCache<string, RepoContext>;

  constructor(ttlMs: number = THREAD_TTL_MS) {
    this.threadAgentMap = new LRUCache<string, DeepAgent>({
      max: 100,
      ttl: ttlMs,
      dispose: (agent, threadId) => {
        logger.debug({ threadId }, "[thread-manager] Disposing agent entry");
      }
    });

    this.threadSandboxMap = new LRUCache<string, ThreadSandboxEntry>({
      max: 50,
      ttl: ttlMs,
      dispose: (entry, threadId) => {
        logger.debug({ threadId }, "[thread-manager] Disposing sandbox entry");
        
        // Background release of resources
        Promise.all([
          releaseRepoSandbox({
            apiKey: process.env.DAYTONA_API_KEY || "",
            apiUrl: process.env.DAYTONA_API_URL,
            target: process.env.DAYTONA_TARGET,
            sandboxId: entry.backend.id,
            profile: entry.profile,
            repoOwner: entry.repo.owner,
            repoName: entry.repo.name,
          }).catch(err => logger.warn({ error: err, threadId }, "[thread-manager] Failed to release old sandbox")),
          entry.backend.cleanup().catch(err => logger.warn({ error: err, threadId }, "[thread-manager] Failed to cleanup old backend"))
        ]).finally(() => {
          clearSandboxBackend(threadId);
          toolInvocationTracker.clearThread(threadId);
        });
      }
    });

    this.threadRepoMap = new LRUCache<string, RepoContext>({
      max: 500,
      ttl: ttlMs,
      dispose: (repo, threadId) => {
        logger.debug({ threadId }, "[thread-manager] Disposing repo entry");
        removePersistedThreadRepo(threadId).catch(err => 
          logger.warn({ error: err, threadId }, "[thread-manager] Failed to remove persisted thread repo")
        );
      }
    });
  }

  // Helper methods to match previous map-like functionality
  
  getAgent(threadId: string): DeepAgent | undefined {
    return this.threadAgentMap.get(threadId);
  }
  
  setAgent(threadId: string, agent: DeepAgent): void {
    this.threadAgentMap.set(threadId, agent);
  }
  
  getSandbox(threadId: string): ThreadSandboxEntry | undefined {
    return this.threadSandboxMap.get(threadId);
  }
  
  setSandbox(threadId: string, entry: ThreadSandboxEntry): void {
    this.threadSandboxMap.set(threadId, entry);
  }
  
  getRepo(threadId: string): RepoContext | undefined {
    return this.threadRepoMap.get(threadId);
  }
  
  setRepo(threadId: string, repo: RepoContext): void {
    this.threadRepoMap.set(threadId, repo);
  }

  clearAll(): void {
    this.threadAgentMap.clear();
    this.threadSandboxMap.clear();
    this.threadRepoMap.clear();
  }

  // Force TTL check
  purgeStale(): void {
    this.threadAgentMap.purgeStale();
    this.threadSandboxMap.purgeStale();
    this.threadRepoMap.purgeStale();
  }
}

export const threadManager = new ThreadManager();

// Backward compatibility export
export const threadRepoMap = threadManager.threadRepoMap;
