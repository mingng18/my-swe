// src/loop/patterns/ci-sweeper.ts
import { Octokit } from "octokit";
import type { RepoConfig } from "../../utils/github";
import type { ScheduledPattern, PatternRunSummary } from "../scheduler";
import { createLogger } from "../../utils/logger";

const logger = createLogger("ci-sweeper");

export interface FailedCIRun {
  id: string;
  description: string;
  repo?: string;
}

export interface CiSweeperOptions {
  name?: string;
  intervalMs?: number;
  threadIdPrefix?: string;
  maxIterations?: number;
  /** Repo to scan for failed workflow runs. Required for the real default fetcher. */
  repoConfig?: RepoConfig;
  /** GitHub token used by the real default fetcher. Required when repoConfig is set. */
  githubToken?: string;
  /** Injectable event source. Default: real GitHub Actions fetcher (needs repoConfig+githubToken), else empty stub with a warning. */
  fetchFailedRuns?: () => Promise<FailedCIRun[]>;
  /** Injectable loop invocation. Default: getLoopRunner().run. */
  runLoop?: (input: { input: string; threadId: string }) => Promise<{
    outcome: string;
    reply: string;
  }>;
}

/**
 * Build a real GitHub Actions failed-runs fetcher for a repo.
 * Lists the most recent FAILED workflow runs and maps each to a FailedCIRun.
 * Kept injectable via CiSweeperOptions.fetchFailedRuns so tests never hit the network.
 */
function buildGithubActionsFetcher(
  repoConfig: RepoConfig,
  githubToken: string,
): () => Promise<FailedCIRun[]> {
  return async () => {
    const octokit = new Octokit({ auth: githubToken });
    const { data } = await octokit.rest.actions.listWorkflowRunsForRepo({
      owner: repoConfig.owner,
      repo: repoConfig.name,
      status: "completed",
      conclusion: "failure",
      per_page: 50,
    });
    const repo = `${repoConfig.owner}/${repoConfig.name}`;
    return (data.workflow_runs ?? []).map((run) => ({
      id: String(run.id),
      description: run.display_title ?? run.name ?? `run ${run.id}`,
      repo,
    }));
  };
}

export function createCiSweeperPattern(
  opts: CiSweeperOptions,
): ScheduledPattern {
  const name = opts.name ?? "ci-sweeper";
  const intervalMs = opts.intervalMs ?? 10 * 60_000;
  const prefix = opts.threadIdPrefix ?? name;

  const fetchFailedRuns =
    opts.fetchFailedRuns ??
    (opts.repoConfig && opts.githubToken
      ? buildGithubActionsFetcher(opts.repoConfig, opts.githubToken)
      : async () => {
          logger.warn(
            "[ci-sweeper] no repoConfig+githubToken and no fetchFailedRuns injected; returning no failed runs",
          );
          return [] as FailedCIRun[];
        });

  const runLoop =
    opts.runLoop ??
    (async ({ input, threadId }: { input: string; threadId: string }) => {
      const { getLoopRunner } = await import("../../server");
      const res = await getLoopRunner().run({ input, threadId });
      return { outcome: res.outcome, reply: res.reply };
    });

  return {
    name,
    intervalMs,
    run: async (): Promise<PatternRunSummary> => {
      const at = new Date().toISOString();
      let runsHandled = 0;
      try {
        const runs = await fetchFailedRuns();
        await Promise.all(
          runs.map(async (r) => {
            const input = `CI run "${r.id}" failed: ${r.description}. Diagnose the failure and fix it.`;
            await runLoop({ input, threadId: `${prefix}-${r.id}` });
            runsHandled += 1;
          }),
        );
        return {
          name,
          ok: true,
          detail: { runsScanned: runs.length, runsHandled },
          at,
        };
      } catch (err) {
        return {
          name,
          ok: false,
          detail: { runsScanned: 0, runsHandled },
          at,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
