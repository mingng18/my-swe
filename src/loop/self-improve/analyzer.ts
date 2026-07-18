// src/loop/self-improve/analyzer.ts
import type { TraceRecord } from "../trace-store";

export interface FailureCluster {
  pattern: "import_error" | "type_error" | "test_failure";
  step: string;
  count: number;
  sampleTraceIds: string[];
}

export interface AnalysisReport {
  totalRuns: number;
  passed: number;
  escalated: number;
  passRate: number;
  failureClusters: FailureCluster[];
}

function classify(output: string): FailureCluster["pattern"] {
  if (/cannot find module|import|resolve/i.test(output)) return "import_error";
  if (/error ts|type error|typecheck/i.test(output)) return "type_error";
  return "test_failure";
}

export function analyze(traces: TraceRecord[]): AnalysisReport {
  const totalRuns = traces.length;

  // ⚡ Bolt: Replaced multiple .filter().length passes with a single O(N) loop
  let passed = 0;
  let escalated = 0;

  const clusters = new Map<string, FailureCluster>();
  for (const t of traces) {
    if (t.outcome === "passed") passed++;
    else if (t.outcome === "escalated") escalated++;
    for (const iter of t.iterations) {
      for (const v of iter.verification) {
        if (v.passed) continue;
        const pattern = classify(v.output);
        const key = `${pattern}:${v.step}`;
        const existing = clusters.get(key);
        if (existing) {
          existing.count += 1;
          if (existing.sampleTraceIds.length < 3) existing.sampleTraceIds.push(t.traceId);
        } else {
          clusters.set(key, { pattern, step: v.step, count: 1, sampleTraceIds: [t.traceId] });
        }
      }
    }
  }

  return {
    totalRuns,
    passed,
    escalated,
    passRate: totalRuns === 0 ? 0 : passed / totalRuns,
    failureClusters: Array.from(clusters.values()).sort((a, b) => b.count - a.count),
  };
}
