import { createLogger } from "../../utils/logger";
import { threadManager } from "../thread-manager";
import {
  acquireRepoSandbox,
  type SandboxProfile,
} from "../../integrations/daytona-pool";
import {
  SandboxService,
  createSandboxServiceWithConfig,
} from "../../integrations/sandbox-service";
import { persistThreadRepo } from "../../utils/thread-metadata-store";
import { setSandboxBackend } from "../../utils/sandboxState";
import { installDependencies } from "../../nodes/deterministic/DependencyInstallerNode";

const logger = createLogger("deepagents");

export function extractRepoFromInput(
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


export function getSandboxProfileFromEnv(): SandboxProfile {
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

export async function resolveSandboxContext(
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

  logger.info(`[deepagents] Repo acquire+clone took ${Date.now() - cloneStart}ms`);

  const activeRepo = { ...parsedRepo, workspaceDir, lastAccessed: Date.now() };
  threadManager.setRepo(threadId, activeRepo);
  const { lastAccessed, ...repoForPersistence } = threadManager.getRepo(threadId) || { owner: parsedRepo.owner, name: parsedRepo.name, workspaceDir };

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
    logger.info("[deepagents] Pre-installing dependencies for agent context...");
    await installDependencies(backend, workspaceDir);
  } catch (depErr) {
    logger.warn({ err: depErr }, "[deepagents] Pre-install dependencies failed (non-fatal)");
  }

  return { activeRepo, backend, workspaceDir };
}
