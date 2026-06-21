// src/loop/self-improve/eval-runner.ts
//
// L4 self-improvement gets a REAL eval runner. The orchestrator's eval gate
// accepts/rejects a proposed ConfigDelta based on whether it improves the
// eval pass-rate vs. baseline. Previously the only available runner was a
// conservative default that returns the *current* pass-rate (always rejects).
//
// This module adapts the existing EvalHarness (which runs a fixed suite of
// SWE-bench-style cases) into the EvalRunner shape consumed by apply.ts:
//
//   EvalRunner = (delta: ConfigDelta) => Promise<number>  // pass-rate in [0,1]
//
// The runner is a thin adapter: it ignores the delta (the harness applies the
// delta's effect via harness config), runs a fixed set of cases through the
// provided runSuite (default: new EvalHarness().runSuite), and reports the
// pass-rate (passed/totalCases, 0 when there are no cases).

import { readFileSync } from "fs";
class EvalHarness { async runSuite(cases: EvalCase[]): Promise<EvalReport> { throw new Error("EvalHarness not implemented"); } }
export interface EvalCase { id: string; repo: string; issueNumber: number; description: string; }
export interface EvalReport { totalCases: number; passed: number; failed: number; avgDurationMs: number; results: any[]; timestamp: string; }
import type { EvalRunner } from "./apply";
import { createLogger } from "../../utils/logger";

const logger = createLogger("loop/eval-runner");

export interface CreateEvalRunnerOpts {
  /**
   * The fixed set of EvalCases the runner evaluates each invocation.
   * Defaults to `[]` (the caller is expected to supply cases when wiring a
   * real runner; an empty case set yields a pass-rate of 0).
   */
  cases?: EvalCase[];
  /**
   * Run a fixed suite of eval cases and produce an aggregate report.
   * Defaults to `new EvalHarness().runSuite`. Injected in tests to avoid
   * running a real (network/LLM/sandbox-backed) eval.
   */
  runSuite?: (cases: EvalCase[]) => Promise<EvalReport>;
}

/**
 * Compute pass-rate from an EvalReport: passed/totalCases, or 0 when there
 * are no cases (avoids NaN/Infinity).
 */
export function passRateFromReport(report: EvalReport): number {
  return report.totalCases > 0 ? report.passed / report.totalCases : 0;
}

/**
 * Create an EvalRunner backed by a suite of EvalCases.
 *
 * The returned runner runs the provided runSuite against a fixed set of cases
 * and returns the resulting pass-rate. The delta argument is accepted for
 * interface conformance with EvalRunner but is intentionally ignored: the
 * EvalHarness reads harness config (which a delta would mutate elsewhere), so
 * the runner observes the effect by re-running the suite rather than by
 * inspecting the delta.
 */
export function createEvalRunner(opts: CreateEvalRunnerOpts = {}): EvalRunner {
  const cases = opts.cases ?? [];
  const runSuite = opts.runSuite ?? new EvalHarness().runSuite.bind(new EvalHarness());
  return async function evalRunner(_delta) {
    const report = await runSuite(cases);
    return passRateFromReport(report);
  };
}

/**
 * Resolve a set of EvalCases from the LOOP_SELF_IMPROVE_EVAL_CASES env value.
 *
 * Accepts either:
 *   - inline JSON (e.g. `[{"id":"c1","repo":"o/r",...}]`), or
 *   - a filesystem path to a `.json` file containing the same shape.
 *
 * Returns `null` when no cases are configured (env unset/empty) so callers can
 * fall back to the conservative default runner. Returns `null` (with a logged
 * warning) when the value is set but unparseable, so a malformed config never
 * silently degrades the self-improve cycle -- the safe default is used instead.
 *
 * `readFile` is injectable for unit tests (defaults to fs.readFileSync).
 */
export function loadEvalCasesFromEnv(
  envValue: string | undefined,
  readFile: (path: string) => string = (p) => readFileSync(p, "utf-8"),
): EvalCase[] | null {
  const raw = envValue?.trim();
  if (!raw) return null;

  // Try inline JSON first.
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as EvalCase[];
  } catch {
    // Not inline JSON -- fall through to file-path interpretation.
  }

  // Treat as a filesystem path.
  try {
    const fileContents = readFile(raw);
    const parsed = JSON.parse(fileContents);
    if (Array.isArray(parsed)) return parsed as EvalCase[];
    logger.warn({ envValue: raw }, "LOOP_SELF_IMPROVE_EVAL_CASES file did not contain a JSON array; ignoring");
    return null;
  } catch (err: any) {
    logger.warn(
      { envValue: raw, err: err?.message ?? String(err) },
      "LOOP_SELF_IMPROVE_EVAL_CASES could not be resolved as inline JSON or a readable file path; ignoring",
    );
    return null;
  }
}
