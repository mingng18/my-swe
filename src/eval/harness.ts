/**
 * SWE-bench-lite style evaluation harness.
 *
 * Takes a GitHub issue URL or description, runs the Bullhorse agent on it,
 * checks whether the agent produced a passing PR, and reports pass/fail with metrics.
 */

import { execFile as execFileCb } from "child_process";
import { promisify } from "util";
import { getAgentHarness } from "../harness";
import { createLogger } from "../utils/logger";
import { parseArgsStringToArgv } from "string-argv";
import pLimit from "p-limit";

const execFile = promisify(execFileCb);
const logger = createLogger("eval-harness");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvalCase {
  /** Unique identifier for this evaluation case. */
  id: string;
  /** GitHub repository in `owner/repo` format. */
  repo: string;
  /** GitHub issue number (0 if description-based only). */
  issueNumber: number;
  /** Human-readable task description given to the agent. */
  description: string;
  /** Optional shell commands executed in the cloned repo before running the agent. */
  setupCommands?: string[];
  /** Shell commands executed against the PR branch to verify correctness. */
  verificationCommands?: string[];
  /** Files that are expected to be modified by the agent. */
  expectedFilesChanged?: string[];
}

export interface EvalResult {
  caseId: string;
  passed: boolean;
  prUrl?: string;
  prNumber?: number;
  error?: string;
  durationMs: number;
  tokensUsed?: number;
  retriesUsed?: number;
  verificationOutput?: string;
}

export interface EvalReport {
  totalCases: number;
  passed: number;
  failed: number;
  avgDurationMs: number;
  results: EvalResult[];
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a PR URL into owner, repo, and PR number.
 * Accepts patterns like `https://github.com/owner/repo/pull/123`.
 */
function parsePrUrl(
  prUrl: string,
): { owner: string; repo: string; prNumber: number } | null {
  const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], prNumber: Number(match[3]) };
}

/**
 * Run a list of shell commands sequentially in the given working directory.
 * Returns concatenated stdout/stderr, throws on first non-zero exit.
 */
async function runCommands(commands: string[], cwd: string): Promise<string> {
  const chunks: string[] = [];
  for (const cmd of commands) {
    const { stdout, stderr } = await execFile("sh", ["-c", cmd], {
      cwd,
      timeout: 120_000,
    });
    chunks.push(stdout ?? "");
    if (stderr) chunks.push(stderr);
  }
  return chunks.join("\n");
}

/**
 * Attempt to extract a PR URL from the agent reply text.
 */
function extractPrUrl(reply: string): string | undefined {
  const match = reply.match(
    /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/,
  );
  return match ? match[0] : undefined;
}

// ---------------------------------------------------------------------------
// EvalHarness
// ---------------------------------------------------------------------------

export class EvalHarness {
  /**
   * Run a single evaluation case.
   *
   * 1. (optional) Run setup commands.
   * 2. Invoke the Bullhorse agent with the case description.
   * 3. Check whether a PR was produced and whether it passes verification.
   */
  async runCase(evalCase: EvalCase): Promise<EvalResult> {
    const start = Date.now();
    logger.info({ caseId: evalCase.id }, "Starting eval case");

    try {
      // -- Setup ---------------------------------------------------------------
      if (evalCase.setupCommands?.length) {
        logger.info(
          { caseId: evalCase.id, commands: evalCase.setupCommands },
          "Running setup commands",
        );
        await runCommands(evalCase.setupCommands, process.cwd());
      }

      // -- Invoke agent --------------------------------------------------------
      const harness = await getAgentHarness();
      const threadId = `eval-${evalCase.id}-${Date.now()}`;

      const input = evalCase.issueNumber
        ? `Fix GitHub issue ${evalCase.repo}#${evalCase.issueNumber}: ${evalCase.description}`
        : evalCase.description;

      logger.info(
        { caseId: evalCase.id, threadId, inputLength: input.length },
        "Invoking agent",
      );

      const response = await harness.invoke(input, {
        threadId,
        transport: "http",
      });

      if (response.error) {
        logger.warn(
          { caseId: evalCase.id, error: response.error },
          "Agent returned error",
        );
        return {
          caseId: evalCase.id,
          passed: false,
          error: response.error,
          durationMs: Date.now() - start,
        };
      }

      // -- Extract PR URL ------------------------------------------------------
      const prUrl = extractPrUrl(response.reply ?? "");

      if (!prUrl) {
        logger.warn(
          { caseId: evalCase.id, reply: response.reply?.slice(0, 500) },
          "No PR URL found in agent reply",
        );
        return {
          caseId: evalCase.id,
          passed: false,
          error: "Agent did not produce a PR URL",
          durationMs: Date.now() - start,
        };
      }

      const parsed = parsePrUrl(prUrl);
      const prNumber = parsed?.prNumber;

      // -- Verify PR -----------------------------------------------------------
      let passed = false;
      let verificationOutput: string | undefined;

      if (evalCase.verificationCommands?.length) {
        const checkResult = await this.checkPrPasses(
          prUrl,
          evalCase.verificationCommands,
        );
        passed = checkResult.passed;
        verificationOutput = checkResult.output;
      } else {
        // No verification commands -- presence of PR counts as pass.
        passed = true;
      }

      const durationMs = Date.now() - start;
      logger.info(
        { caseId: evalCase.id, passed, prUrl, durationMs },
        "Eval case finished",
      );

      return {
        caseId: evalCase.id,
        passed,
        prUrl,
        prNumber,
        durationMs,
        verificationOutput,
      };
    } catch (err: any) {
      const durationMs = Date.now() - start;
      logger.error(
        { caseId: evalCase.id, err: err.message, durationMs },
        "Eval case failed with exception",
      );
      return {
        caseId: evalCase.id,
        passed: false,
        error: err.message ?? String(err),
        durationMs,
      };
    }
  }

  /**
   * Run all cases sequentially and produce an aggregate report.
   */
  async runSuite(cases: EvalCase[]): Promise<EvalReport> {
    logger.info({ totalCases: cases.length }, "Starting eval suite");

    const limit = pLimit(5); // Run up to 5 cases concurrently
    const results: EvalResult[] = [];

    const casePromises = cases.map((c, i) =>
      limit(async () => {
        logger.info(
          { caseId: c.id, progress: `${i + 1}/${cases.length}` },
          "Running case",
        );

        const result = await this.runCase(c);

        logger.info(
          {
            caseId: c.id,
            passed: result.passed,
            durationMs: result.durationMs,
            progress: `${i + 1}/${cases.length}`,
          },
          "Case complete",
        );

        return result;
      }),
    );

    const rawResults = await Promise.all(casePromises);
    results.push(...rawResults);

    const passed = results.filter((r) => r.passed).length;
    const failed = results.length - passed;
    const avgDurationMs =
      results.length > 0
        ? Math.round(
            results.reduce((sum, r) => sum + r.durationMs, 0) / results.length,
          )
        : 0;

    const report: EvalReport = {
      totalCases: cases.length,
      passed,
      failed,
      avgDurationMs,
      results,
      timestamp: new Date().toISOString(),
    };

    logger.info(
      {
        totalCases: report.totalCases,
        passed: report.passed,
        failed: report.failed,
        avgDurationMs: report.avgDurationMs,
      },
      "Eval suite finished",
    );

    return report;
  }

  /**
   * Clone the PR branch into a temporary directory and run verification commands.
   *
   * Returns `{ passed, output }`.
   */
  async checkPrPasses(
    prUrl: string,
    verifyCommands: string[],
  ): Promise<{ passed: boolean; output: string }> {
    const parsed = parsePrUrl(prUrl);
    if (!parsed) {
      return {
        passed: false,
        output: `Could not parse PR URL: ${prUrl}`,
      };
    }

    const { owner, repo, prNumber } = parsed;
    const branch = `pr-${prNumber}-${Date.now()}`;
    const tmpDir = `/tmp/eval-${branch}`;

    try {
      // Clone the PR head reference
      logger.info({ prUrl, tmpDir }, "Cloning PR branch for verification");

      await execFile(
        "gh",
        [
          "pr",
          "checkout",
          String(prNumber),
          "--repo",
          `${owner}/${repo}`,
          "--clone",
        ],
        { cwd: "/tmp", timeout: 120_000 },
      ).catch(async () => {
        // Fallback: manual clone + fetch
        await execFile(
          "git",
          ["clone", `https://github.com/${owner}/${repo}.git`, tmpDir],
          { timeout: 120_000 },
        );

        await execFile(
          "git",
          ["fetch", "origin", `pull/${prNumber}/head:${branch}`],
          { cwd: tmpDir, timeout: 60_000 },
        );

        await execFile("git", ["checkout", branch], {
          cwd: tmpDir,
          timeout: 30_000,
        });
      });

      // Run verification commands
      logger.info(
        { prUrl, commands: verifyCommands },
        "Running verification commands",
      );

      const output = await runCommands(verifyCommands, tmpDir);

      logger.info({ prUrl, passed: true }, "Verification passed");
      return { passed: true, output };
    } catch (err: any) {
      const output =
        err.stdout ?? "" + (err.stderr ?? "") + (err.message ?? "");
      logger.warn({ prUrl, error: err.message }, "Verification failed");
      return { passed: false, output };
    } finally {
      // Clean up temp directory
      try {
        await execFile("rm", ["-rf", tmpDir], { timeout: 10_000 });
      } catch {
        // Best-effort cleanup
      }
    }
  }
}
