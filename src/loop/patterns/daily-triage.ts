// src/loop/patterns/daily-triage.ts
import { Octokit } from "octokit";
import type { RepoConfig } from "../../utils/github";
import type { ScheduledPattern, PatternRunSummary } from "../scheduler";
import { createLogger } from "../../utils/logger";

const logger = createLogger("daily-triage");

export interface NewIssue {
  number: number;
  title: string;
  body?: string;
}

export interface DailyTriageOptions {
  name?: string;
  intervalMs?: number;
  threadIdPrefix?: string;
  /** Repo to scan for new issues. Required for the real default fetcher. */
  repoConfig?: RepoConfig;
  /** GitHub token used by the real default fetcher. Required when repoConfig is set. */
  githubToken?: string;
  /** Injectable event source. Default: real GitHub "new issues" fetcher (needs repoConfig+githubToken), else empty stub with a warning. */
  fetchNewIssues?: () => Promise<NewIssue[]>;
  runLoop?: (input: { input: string; threadId: string }) => Promise<{
    outcome: string;
    reply: string;
  }>;
}

/**
 * Build a real GitHub "new issues" fetcher for a repo.
 * Lists open issues created in the last 24h (newest first) and maps each to a
 * NewIssue. Pull requests are excluded (they expose a `pull_request` field).
 * Kept injectable via DailyTriageOptions.fetchNewIssues so tests never hit the network.
 */
function buildGithubIssuesFetcher(
  repoConfig: RepoConfig,
  githubToken: string,
): () => Promise<NewIssue[]> {
  return async () => {
    const octokit = new Octokit({ auth: githubToken });
    const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    const { data } = await octokit.rest.issues.listForRepo({
      owner: repoConfig.owner,
      repo: repoConfig.name,
      state: "open",
      since,
      sort: "created",
      direction: "desc",
      per_page: 50,
    });
    return (data ?? [])
      .filter((issue) => (issue as { pull_request?: unknown }).pull_request === undefined)
      .map((issue) => ({
        number: issue.number,
        title: issue.title,
        body: issue.body ?? undefined,
      }));
  };
}

export function createDailyTriagePattern(opts: DailyTriageOptions): ScheduledPattern {
  const name = opts.name ?? "daily-triage";
  const intervalMs = opts.intervalMs ?? 24 * 60 * 60_000;
  const prefix = opts.threadIdPrefix ?? name;

  const fetchNewIssues =
    opts.fetchNewIssues ??
    (opts.repoConfig && opts.githubToken
      ? buildGithubIssuesFetcher(opts.repoConfig, opts.githubToken)
      : (async () => {
          logger.warn(
            "[daily-triage] no repoConfig+githubToken and no fetchNewIssues injected; returning no new issues",
          );
          return [] as NewIssue[];
        }));

  const runLoop =
    opts.runLoop ??
    (async ({ input, threadId }) => {
      const { getLoopRunner } = await import("../../server");
      const res = await getLoopRunner().run({ input, threadId });
      return { outcome: res.outcome, reply: res.reply };
    });

  return {
    name,
    intervalMs,
    run: async (): Promise<PatternRunSummary> => {
      const at = new Date().toISOString();
      let issuesTriaged = 0;
      try {
        const issues = await fetchNewIssues();
        for (const issue of issues) {
          const input = `Triage issue #${issue.number}: ${issue.title}${
            issue.body ? `\n\n${issue.body}` : ""
          }`;
          await runLoop({ input, threadId: `${prefix}-issue-${issue.number}` });
          issuesTriaged += 1;
        }
        return { name, ok: true, detail: { issuesTriaged }, at };
      } catch (err) {
        return {
          name,
          ok: false,
          detail: { issuesTriaged },
          at,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
