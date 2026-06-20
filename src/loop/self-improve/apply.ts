// src/loop/self-improve/apply.ts
import type { ConfigDelta } from "./config-rewriter";
import type { TraceStore } from "../trace-store";
import { deriveGoal } from "../goal";

export type EvalRunner = (delta: ConfigDelta) => Promise<number>;

export interface EvalDecision {
  deltaId: string;
  decision: "accept" | "reject";
  before: number;
  after: number;
  reason: string;
}

export async function evaluateDelta(
  delta: ConfigDelta,
  opts: { evalRunner: EvalRunner; baselinePassRate: number },
): Promise<EvalDecision> {
  const after = await opts.evalRunner(delta);
  const before = opts.baselinePassRate;
  const decision: EvalDecision["decision"] = after > before ? "accept" : "reject";
  const reason =
    decision === "accept"
      ? `Improved pass-rate ${before} -> ${after}`
      : `Did not improve (${before} -> ${after}); rejecting to avoid regression.`;
  return { deltaId: delta.id, decision, before, after, reason };
}

/** Record a self-improve decision as a synthetic trace so it is observable to future cycles. */
export function recordDecision(
  traceStore: TraceStore,
  decision: EvalDecision,
  delta: ConfigDelta,
): void {
  const rec = traceStore.open(`self-improve-${decision.deltaId}`, deriveGoal("self-improvement"));
  traceStore.appendIteration(rec.traceId, {
    index: 0,
    agentOutput: `${decision.decision}: ${delta.patch}`,
    verification: [{ step: "eval", passed: decision.decision === "accept", output: decision.reason }],
    decision: decision.decision === "accept" ? "pass" : "escalate",
  });
  traceStore.finalize(rec.traceId, decision.decision === "accept" ? "passed" : "escalated");
}
