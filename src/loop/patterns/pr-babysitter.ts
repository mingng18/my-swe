// src/loop/patterns/pr-babysitter.ts
import { PRReviewCycle, type PRReviewResult } from "../../harness/pr-review-cycle";
import type { RepoConfig } from "../../utils/github";
import type { SandboxService } from "../../integrations/sandbox-service";
import type { ScheduledPattern, PatternRunSummary } from "../scheduler";
import { Octokit } from "octokit";

export interface PrBabysitterOptions {
  name?: string;
  intervalMs?: number;
  repoConfig: RepoConfig;
  githubToken: string;
  threadIdPrefix?: string;
  repoDir: string;
  sandbox?: SandboxService | null;
  /** Injectable: list open PR numbers. Default: Octokit. */
  listOpenPRs?: () => Promise<number[]>;
  /** Injectable: build a review-cycle-like object per PR. Default: real PRReviewCycle. */
  reviewCycleFactory?: (prNumber: number) => {
    fetchUnresolvedComments: (prNumber: number) => Promise<unknown[]>;
    runCycle: (prNumber: number, maxRounds?: number) => Promise<PRReviewResult>;
  };
}

export function createPrBabysitterPattern(
  opts: PrBabysitterOptions,
): ScheduledPattern {
  const name = opts.name ?? "pr-babysitter";
  const intervalMs = opts.intervalMs ?? 15 * 60_000;

  const listOpenPRs =
    opts.listOpenPRs ??
    (async () => {
      const octokit = new Octokit({ auth: opts.githubToken });
      const prs = await octokit.paginate(octokit.rest.pulls.list, {
        owner: opts.repoConfig.owner,
        repo: opts.repoConfig.name,
        state: "open",
        per_page: 100,
      });
      return prs.map((p) => (p as { number: number }).number);
    });

  const makeCycle =
    opts.reviewCycleFactory ??
    ((prNumber: number) => {
      void prNumber;
      const cycle = new PRReviewCycle(
        opts.repoConfig,
        opts.githubToken,
        `${opts.threadIdPrefix ?? "pr-babysitter"}-${Date.now()}`,
        opts.repoDir,
        opts.sandbox ?? null,
      );
      return {
        fetchUnresolvedComments: (n: number) => cycle.fetchUnresolvedComments(n),
        runCycle: (n: number, maxRounds?: number) =>
          cycle.runCycle(n, maxRounds),
      };
    });

  return {
    name,
    intervalMs,
    run: async (): Promise<PatternRunSummary> => {
      const at = new Date().toISOString();
      const results: PRReviewResult[] = [];
      try {
        const prs = await listOpenPRs();
        for (const prNumber of prs) {
          const cycle = makeCycle(prNumber);
          const unresolved = await cycle.fetchUnresolvedComments(prNumber);
          if (unresolved.length === 0) continue; // nothing to babysit
          results.push(await cycle.runCycle(prNumber, 2));
        }
        return {
          name,
          ok: true,
          detail: { prsScanned: prs.length, prsAddressed: results.length, results },
          at,
        };
      } catch (err) {
        return {
          name,
          ok: false,
          detail: { results },
          at,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
