import { Daytona } from "@daytonaio/sdk";
import { createLogger } from "../utils/logger";

const logger = createLogger("daytona-pool");

export type SandboxProfile = "typescript" | "javascript" | "python" | "java" | "polyglot";

export type PoolStatus = "idle" | "busy";

export const BULLHORSE_LABELS = {
  managed: "bullhorse.managed",
  profile: "bullhorse.profile",
  repo: "bullhorse.repo",
  status: "bullhorse.status",
  threadId: "bullhorse.thread_id",
} as const;

export interface AcquireSandboxParams {
  apiKey: string;
  apiUrl?: string;
  target?: string;

  profile: SandboxProfile;
  repoOwner: string;
  repoName: string;
  threadId: string;

  // Sandbox creation defaults (used when we have to create a new one)
  image?: string;
  language?: "python" | "javascript" | "typescript";
  cpu?: number;
  memory?: number;
  disk?: number;
  envVars?: Record<string, string>;
  autoStopInterval?: number;
  autoArchiveInterval?: number;
  autoDeleteInterval?: number;
  ephemeral?: boolean;
  networkBlockAll?: boolean;
  networkAllowList?: string;
  public?: boolean;
  user?: string;
  volumes?: Array<{ volumeId: string; mountPath: string; subpath?: string }>;
  /**
   * Optional timeout in minutes to auto-demote stale busy sandboxes to idle.
   * If omitted or <= 0, stale busy auto-demotion is disabled.
   */
  staleBusyTimeoutMinutes?: number;
}

export interface AcquiredSandbox {
  sandboxId: string;
  createdNew: boolean;
}

function repoKey(owner: string, name: string): string {
  return `${owner}/${name}`;
}

function buildLabels(args: {
  profile: SandboxProfile;
  repo: string;
  status: PoolStatus;
  threadId?: string;
}): Record<string, string> {
  return {
    [BULLHORSE_LABELS.managed]: "true",
    [BULLHORSE_LABELS.profile]: args.profile,
    [BULLHORSE_LABELS.repo]: args.repo,
    [BULLHORSE_LABELS.status]: args.status,
    ...(args.threadId ? { [BULLHORSE_LABELS.threadId]: args.threadId } : {}),
  };
}

function getSandboxTimestampMs(sandbox: any): number | undefined {
  const ts =
    sandbox?.updatedAt ||
    sandbox?.updated_at ||
    sandbox?.createdAt ||
    sandbox?.created_at;
  if (!ts || typeof ts !== "string") return undefined;
  const parsed = Date.parse(ts);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export async function countIdleRepoSandboxes(args: {
  apiKey: string;
  apiUrl?: string;
  target?: string;
  profile: SandboxProfile;
  repoOwner: string;
  repoName: string;
  // defaults to a single page worth of results; intended for small pools
  pageSize?: number;
}): Promise<number> {
  const daytona = new Daytona({
    apiKey: args.apiKey,
    apiUrl: args.apiUrl,
    target: args.target,
  });

  const repo = repoKey(args.repoOwner, args.repoName);
  const labelsFilter = buildLabels({
    profile: args.profile,
    repo,
    status: "idle",
  });

  const pageSize = args.pageSize ?? 50;
  try {
    const listed = await daytona.list(labelsFilter, 1, pageSize);
    if (typeof (listed as any).total === "number") {
      return (listed as any).total as number;
    }
    return listed.items.length;
  } finally {
    try {
      await daytona[Symbol.asyncDispose]();
    } catch (err) {
      logger.warn(
        { error: err },
        "[daytona-pool] Failed to dispose client",
      );
    }
  }
}

/**
 * Acquire a sandbox for a given repo. If an idle one exists (already cloned),
 * reuse it; otherwise create a new sandbox and mark it busy.
 */
export async function acquireRepoSandbox(
  params: AcquireSandboxParams,
): Promise<AcquiredSandbox> {
  const daytona = new Daytona({
    apiKey: params.apiKey,
    apiUrl: params.apiUrl,
    target: params.target,
  });

  const repo = repoKey(params.repoOwner, params.repoName);

  try {
    // 1) Prefer reusing an in-flight sandbox already owned by the same thread.
    // This avoids unnecessary churn when a thread makes consecutive requests.
    const busySameThreadFilter = buildLabels({
      profile: params.profile,
      repo,
      status: "busy",
      threadId: params.threadId,
    });
    const busySameThreadList = await daytona.list(busySameThreadFilter, 1, 50);
    const busySameThread = busySameThreadList.items?.[0];
    if (busySameThread) {
      logger.info(
        { sandboxId: busySameThread.id, repo, profile: params.profile, threadId: params.threadId },
        "[daytona-pool] Reusing busy sandbox for same thread",
      );

      if (busySameThread.state !== "started") {
        await busySameThread.start(120);
      }

      return { sandboxId: busySameThread.id, createdNew: false };
    }

    // 2) Reclaim stopped busy sandboxes (safe fallback), and optionally
    // auto-demote stale busy sandboxes before checking idle pool.
    const busyFilter = buildLabels({
      profile: params.profile,
      repo,
      status: "busy",
    });
    const busyList = await daytona.list(busyFilter, 1, 50);
    const staleBusyTimeoutMinutes = params.staleBusyTimeoutMinutes ?? 0;
    const cutoffMs =
      staleBusyTimeoutMinutes > 0
        ? Date.now() - staleBusyTimeoutMinutes * 60_000
        : undefined;

    for (const sb of busyList.items ?? []) {
      if (sb.labels?.[BULLHORSE_LABELS.threadId] === params.threadId) continue;

      const state = (sb.state || "").toLowerCase();
      const isStopped = state === "stopped" || state === "stopping";

      const tsMs = getSandboxTimestampMs(sb);
      const isStaleBusy =
        cutoffMs !== undefined && tsMs !== undefined && tsMs <= cutoffMs;

      // Always reclaim stopped busy sandboxes.
      // Also reclaim stale busy sandboxes when configured.
      if (!isStopped && !isStaleBusy) continue;

      try {
        await sb.setLabels(
          buildLabels({
            profile: params.profile,
            repo,
            status: "idle",
          }),
        );
        logger.info(
          {
            sandboxId: sb.id,
            repo,
            profile: params.profile,
            state: sb.state,
            reclaimedBy: isStopped ? "stopped_busy_fallback" : "stale_busy_timeout",
            staleBusyTimeoutMinutes: staleBusyTimeoutMinutes > 0 ? staleBusyTimeoutMinutes : undefined,
          },
          "[daytona-pool] Reclaimed busy sandbox to idle",
        );
      } catch (err) {
        logger.warn(
          { error: err, sandboxId: sb.id },
          "[daytona-pool] Failed to reclaim busy sandbox",
        );
      }
    }

    // 3) Fallback to shared idle pool.
    const labelsFilter = buildLabels({
      profile: params.profile,
      repo,
      status: "idle",
    });

    const listed = await daytona.list(labelsFilter, 1, 50);
    const candidate = listed.items?.[0];

    if (candidate) {
      logger.info(
        { sandboxId: candidate.id, repo, profile: params.profile },
        "[daytona-pool] Reusing idle sandbox",
      );

      // Ensure it is started and then lock it (busy).
      if (candidate.state !== "started") {
        await candidate.start(120);
      }

      await candidate.setLabels(
        buildLabels({
          profile: params.profile,
          repo,
          status: "busy",
          threadId: params.threadId,
        }),
      );

      return { sandboxId: candidate.id, createdNew: false };
    }

    // None available: create a new sandbox labeled busy.
    const image = params.image ?? "debian:12.9";
    const resources =
      params.cpu || params.memory || params.disk
        ? { cpu: params.cpu, memory: params.memory, disk: params.disk }
        : undefined;

    const createParams: Record<string, unknown> = {
      image,
      language: params.language,
      labels: buildLabels({
        profile: params.profile,
        repo,
        status: "busy",
        threadId: params.threadId,
      }),
      envVars: params.envVars,
      resources,
      autoStopInterval: params.autoStopInterval,
      autoArchiveInterval: params.autoArchiveInterval,
      autoDeleteInterval: params.autoDeleteInterval,
      ephemeral: params.ephemeral,
      networkBlockAll: params.networkBlockAll,
      networkAllowList: params.networkAllowList,
      public: params.public,
      user: params.user,
      volumes: params.volumes,
    };

    for (const [k, v] of Object.entries(createParams)) {
      if (v === undefined) delete createParams[k];
    }

    const sandbox = await daytona.create(createParams as any);
    logger.info(
      { sandboxId: sandbox.id, repo, profile: params.profile },
      "[daytona-pool] Created new sandbox",
    );

    return { sandboxId: sandbox.id, createdNew: true };
  } finally {
    try {
      await daytona[Symbol.asyncDispose]();
    } catch (err) {
      logger.warn({ error: err }, "[daytona-pool] Failed to dispose client");
    }
  }
}

/**
 * Create a brand-new sandbox (does not try to reuse idle sandboxes).
 * Useful for prewarming pools.
 */
export async function createRepoSandbox(params: AcquireSandboxParams): Promise<string> {
  const daytona = new Daytona({
    apiKey: params.apiKey,
    apiUrl: params.apiUrl,
    target: params.target,
  });

  const repo = repoKey(params.repoOwner, params.repoName);

  try {
    const image = params.image ?? "debian:12.9";
    const resources =
      params.cpu || params.memory || params.disk
        ? { cpu: params.cpu, memory: params.memory, disk: params.disk }
        : undefined;

    const createParams: Record<string, unknown> = {
      image,
      language: params.language,
      labels: buildLabels({
        profile: params.profile,
        repo,
        status: "busy",
        threadId: params.threadId,
      }),
      envVars: params.envVars,
      resources,
      autoStopInterval: params.autoStopInterval,
      autoArchiveInterval: params.autoArchiveInterval,
      autoDeleteInterval: params.autoDeleteInterval,
      ephemeral: params.ephemeral,
      networkBlockAll: params.networkBlockAll,
      networkAllowList: params.networkAllowList,
      public: params.public,
      user: params.user,
      volumes: params.volumes,
    };

    for (const [k, v] of Object.entries(createParams)) {
      if (v === undefined) delete createParams[k];
    }

    const sandbox = await daytona.create(createParams as any);
    return sandbox.id;
  } finally {
    try {
      await daytona[Symbol.asyncDispose]();
    } catch (err) {
      logger.warn(
        { error: err },
        "[daytona-pool] Failed to dispose client",
      );
    }
  }
}

/**
 * Release a sandbox back to the pool by marking it idle.
 */
export async function releaseRepoSandbox(args: {
  apiKey: string;
  apiUrl?: string;
  target?: string;
  sandboxId: string;
  profile: SandboxProfile;
  repoOwner: string;
  repoName: string;
}): Promise<void> {
  const daytona = new Daytona({
    apiKey: args.apiKey,
    apiUrl: args.apiUrl,
    target: args.target,
  });

  const repo = repoKey(args.repoOwner, args.repoName);

  try {
    const sandbox = await daytona.get(args.sandboxId);
    await sandbox.setLabels(
      buildLabels({
        profile: args.profile,
        repo,
        status: "idle",
      }),
    );
  } finally {
    try {
      await daytona[Symbol.asyncDispose]();
    } catch (err) {
      logger.warn({ error: err }, "[daytona-pool] Failed to dispose client");
    }
  }
}

