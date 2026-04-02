import { createLogger } from "./utils/logger";
import { createSandboxServiceWithConfig } from "./integrations/sandbox-service";
import {
  countIdleRepoSandboxes,
  createRepoSandbox,
  releaseRepoSandbox,
  type SandboxProfile,
} from "./integrations/daytona-pool";

const logger = createLogger("prewarm");

type PrewarmRepoSpec = {
  owner: string;
  name: string;
  count?: number;
  profile?: SandboxProfile;
};

function parseReposJson(): PrewarmRepoSpec[] {
  const raw = process.env.PREWARM_REPOS_JSON?.trim();
  if (raw) {
    const parsed = JSON.parse(raw) as PrewarmRepoSpec[];
    return parsed;
  }

  const single = process.env.PREWARM_REPO?.trim();
  if (!single) return [];

  const [owner, name] = single.split("/", 2);
  if (!owner || !name) {
    throw new Error(
      "Invalid PREWARM_REPO. Expected 'owner/name' (e.g. facebook/react).",
    );
  }

  const count = process.env.PREWARM_COUNT ? Number(process.env.PREWARM_COUNT) : 1;
  return [
    {
      owner,
      name,
      count: Number.isFinite(count) ? count : 1,
      profile: (process.env.SANDBOX_PROFILE?.trim() as SandboxProfile) || undefined,
    },
  ];
}

function normalizeProfile(profile?: string): SandboxProfile {
  const p = (profile || "").trim().toLowerCase();
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

async function main(): Promise<void> {
  const apiKey = process.env.DAYTONA_API_KEY || "";
  if (!apiKey) {
    throw new Error("DAYTONA_API_KEY is required for prewarm.");
  }

  const repos = parseReposJson();
  if (repos.length === 0) {
    logger.info(
      "No repos to prewarm. Set PREWARM_REPOS_JSON or PREWARM_REPO=owner/name.",
    );
    return;
  }

  const githubToken = process.env.GITHUB_TOKEN;

  const defaultProfile = normalizeProfile(process.env.SANDBOX_PROFILE);
  const defaultCount = process.env.PREWARM_COUNT
    ? Number(process.env.PREWARM_COUNT)
    : 0;

  for (const repo of repos) {
    const owner = repo.owner;
    const name = repo.name;
    const profile = normalizeProfile(repo.profile ?? defaultProfile);
    const desiredCount = repo.count ?? (Number.isFinite(defaultCount) ? defaultCount : 0);

    logger.info(
      { owner, name, profile, desiredCount },
      "[prewarm] Checking idle sandboxes",
    );

    const idleCount = await countIdleRepoSandboxes({
      apiKey,
      apiUrl: process.env.DAYTONA_API_URL,
      target: process.env.DAYTONA_TARGET,
      profile,
      repoOwner: owner,
      repoName: name,
    });

    if (idleCount >= desiredCount) {
      logger.info(
        { owner, name, profile, idleCount, desiredCount },
        "[prewarm] Already warm enough, skipping",
      );
      continue;
    }

    const delta = desiredCount - idleCount;
    logger.info(
      { owner, name, profile, idleCount, desiredCount, delta },
      "[prewarm] Creating additional sandboxes",
    );

    const promises = [];
    for (let i = 0; i < delta; i++) {
      promises.push((async () => {
      const threadId = `prewarm-${owner}-${name}-${Date.now()}-${i}`;

      const sandboxId = await createRepoSandbox({
        apiKey,
        apiUrl: process.env.DAYTONA_API_URL,
        target: process.env.DAYTONA_TARGET,
        profile,
        repoOwner: owner,
        repoName: name,
        threadId,
        image: process.env.DAYTONA_IMAGE || "debian:12.9",
        language: (process.env.DAYTONA_LANGUAGE as any) || undefined,
        cpu: process.env.DAYTONA_CPU
          ? parseInt(process.env.DAYTONA_CPU, 10)
          : undefined,
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
        // envVars/volumes are intentionally not set here; keep prewarm conservative.
      });

      const backend = await createSandboxServiceWithConfig({
        provider: "daytona",
        daytona: {
          apiKey,
          apiUrl: process.env.DAYTONA_API_URL,
          target: process.env.DAYTONA_TARGET,
          sandboxId,
          preserveOnCleanup: true,
        },
      });

      try {
        logger.info(
          { sandboxId, owner, name },
          "[prewarm] Cloning repo in sandbox",
        );
        await backend.cloneRepo(owner, name, githubToken);
      } finally {
        // Dispose client but do not delete sandbox (preserveOnCleanup=true).
        await backend.cleanup();
      }

      await releaseRepoSandbox({
        apiKey,
        apiUrl: process.env.DAYTONA_API_URL,
        target: process.env.DAYTONA_TARGET,
        sandboxId,
        profile,
        repoOwner: owner,
        repoName: name,
      });
    })());
    }
    await Promise.all(promises);
  }

  logger.info("[prewarm] Done");
}

main().catch((err) => {
  logger.error({ error: err }, "[prewarm] Failed");
  process.exit(1);
});

