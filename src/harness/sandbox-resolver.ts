// src/harness/sandbox-resolver.ts
/**
 * Sandbox resolution utilities.
 *
 * Extracted from deepagents.ts so that sandbox acquisition logic can be
 * reused independently (e.g. by the blueprint verification pipeline).
 */

import { createLogger } from "../utils/logger";
import {
  type SandboxProfile,
  getSandboxProfileFromEnv,
  acquireRepoSandbox,
  releaseRepoSandbox,
} from "../integrations/daytona-pool";
import {
  SandboxService,
  createSandboxServiceWithConfig,
} from "../integrations/sandbox-service";
import { installDependencies } from "../nodes/deterministic/DependencyInstallerNode";
import { persistThreadRepo } from "../utils/thread-metadata-store";

const logger = createLogger("sandbox-resolver");

// ---------------------------------------------------------------------------
// extractRepoFromInput
// ---------------------------------------------------------------------------

/**
 * Parse a `--repo owner/name` or `--repo name` from the user's input string.
 *
 * When only a bare name is provided, the owner is resolved from
 * `GITHUB_DEFAULT_OWNER`.
 */
export function extractRepoFromInput(
  input: string,
): { owner: string; name: string } | undefined {
  const match = input.match(/--repo\s+([a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?)/);
  if (!match) return undefined;

  let repoStr = match[1].replace(/[.,;!?]+$/, "");

  if (repoStr.includes("/")) {
    const [owner, name] = repoStr.split("/", 2);
    return { owner, name };
  } else {
    const defaultOwner = process.env.GITHUB_DEFAULT_OWNER || "";
    return { owner: defaultOwner, name: repoStr };
  }
}

// ---------------------------------------------------------------------------
// acquireDaytonaSandboxForThreadRepo
// ---------------------------------------------------------------------------

/**
 * Acquire a Daytona sandbox for a given thread + repo combination.
 *
 * Returns the sandbox backend and the workspace directory (clone path).
 */
export async function acquireDaytonaSandboxForThreadRepo(args: {
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
    image: process.env.DAYTONA_IMAGE,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

// ---------------------------------------------------------------------------
// resolveSandboxContext
// ---------------------------------------------------------------------------

/**
 * High-level helper that resolves a full sandbox context for a thread+repo.
 *
 * Handles both Daytona and OpenSandbox providers, clones the repo, persists
 * the thread/repo mapping, and pre-installs dependencies.
 */
export async function resolveSandboxContext(
  threadId: string,
  parsedRepo: { owner: string; name: string },
  profile: SandboxProfile,
  threadManager: {
    getRepo(threadId: string): { owner: string; name: string; workspaceDir: string; lastAccessed: number } | undefined;
    setRepo(threadId: string, repo: { owner: string; name: string; workspaceDir: string; lastAccessed: number }): void;
    setSandbox(threadId: string, entry: unknown): void;
    getSandbox(threadId: string): { backend: SandboxService; profile: SandboxProfile; repo: { owner: string; name: string; workspaceDir: string } } | undefined;
  },
  setSandboxBackend: (threadId: string, backend: SandboxService) => void,
): Promise<{
  activeRepo: { owner: string; name: string; workspaceDir: string; lastAccessed: number };
  backend: SandboxService;
  workspaceDir: string;
}> {
  const cloneStart = Date.now();
  const provider = process.env.SANDBOX_PROVIDER || "opensandbox";
  let backend: SandboxService;
  let workspaceDir: string;

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
    `[sandbox-resolver] Repo acquire+clone took ${Date.now() - cloneStart}ms`,
  );

  const activeRepo = {
    ...parsedRepo,
    workspaceDir,
    lastAccessed: Date.now(),
  };
  threadManager.setRepo(threadId, activeRepo);

  const existingRepo = threadManager.getRepo(threadId);
  const { lastAccessed: _la, ...repoForPersistence } = existingRepo || {
    owner: parsedRepo.owner,
    name: parsedRepo.name,
    workspaceDir,
  };
  void _la;

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
  });

  setSandboxBackend(threadId, backend);

  // Pre-install dependencies for agent context
  try {
    logger.info(
      "[sandbox-resolver] Pre-installing dependencies for agent context...",
    );
    await installDependencies(backend, workspaceDir);
  } catch (depErr) {
    logger.warn(
      { err: depErr },
      "[sandbox-resolver] Pre-install dependencies failed (non-fatal)",
    );
  }

  return { activeRepo, backend, workspaceDir };
}
