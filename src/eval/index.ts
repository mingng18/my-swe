/**
 * Evaluation harness barrel export.
 *
 * Re-exports all public types and the EvalHarness class so consumers can:
 *
 * ```ts
 * import { EvalHarness, type EvalCase, type EvalResult, type EvalReport } from "./eval";
 * ```
 */

export {
  EvalHarness,
  type EvalCase,
  type EvalResult,
  type EvalReport,
} from "./harness";

export { SAMPLE_EVAL_CASES } from "./examples";
