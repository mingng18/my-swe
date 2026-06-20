// src/loop/self-improve/orchestrator.ts
import type { TraceStore } from "../trace-store";
import type { HITLStore } from "../hitl";
import { analyze, type AnalysisReport } from "./analyzer";
import { proposeDeltas, type ConfigDelta } from "./config-rewriter";
import { evaluateDelta, recordDecision, type EvalRunner, type EvalDecision } from "./apply";

export interface SelfImprovementDeps {
  traceStore: TraceStore;
  evalRunner: EvalRunner;
  hitlStore?: HITLStore;
  enabled?: boolean;
}

export interface SelfImprovementResult {
  report: AnalysisReport;
  deltas: ConfigDelta[];
  decisions: EvalDecision[];
}

export async function runSelfImprovementCycle(
  deps: SelfImprovementDeps,
): Promise<SelfImprovementResult> {
  const enabled = deps.enabled ?? process.env.LOOP_SELF_IMPROVE_ENABLED === "true";
  if (!enabled) {
    return { report: analyze([]), deltas: [], decisions: [] };
  }

  const traces = deps.traceStore.queryAll();
  const report = analyze(traces);
  const deltas = proposeDeltas(report);
  const decisions: EvalDecision[] = [];

  for (const delta of deltas) {
    const decision = await evaluateDelta(delta, {
      evalRunner: deps.evalRunner,
      baselinePassRate: report.passRate,
    });
    recordDecision(deps.traceStore, decision, delta);
    decisions.push(decision);
    if (decision.decision === "accept" && deps.hitlStore) {
      deps.hitlStore.create({
        threadId: `self-improve-${delta.id}`,
        traceId: delta.id,
        reason: `Accepted config delta (${delta.sourcePattern}); awaiting approval to apply: ${delta.patch.slice(0, 120)}`,
        pendingAction: "apply_config_delta",
        options: ["approve", "reject", "modify"],
      });
    }
  }

  return { report, deltas, decisions };
}
