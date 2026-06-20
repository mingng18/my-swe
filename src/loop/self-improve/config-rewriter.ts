// src/loop/self-improve/config-rewriter.ts
import type { AnalysisReport, FailureCluster } from "./analyzer";

export interface ConfigDelta {
  id: string;
  type: "prompt_addendum" | "grader_tighten";
  target: string;
  rationale: string;
  patch: string;
  sourcePattern: string;
}

const TEMPLATES: Record<FailureCluster["pattern"], (c: FailureCluster) => Omit<ConfigDelta, "id" | "sourcePattern">> = {
  import_error: (c) => ({
    type: "prompt_addendum",
    target: "agent-system-prompt",
    rationale: `Import failures occurred ${c.count}x on ${c.step}; the agent is claiming done before imports resolve.`,
    patch:
      "Before declaring a task complete, ensure all new/changed modules import cleanly — run the typecheck and resolve every 'cannot find module' / unresolved import.",
  }),
  type_error: (c) => ({
    type: "prompt_addendum",
    target: "agent-system-prompt",
    rationale: `TypeScript errors occurred ${c.count}x on ${c.step}.`,
    patch: "Resolve all TypeScript errors. Do not silence errors with `any` casts or @ts-ignore.",
  }),
  test_failure: (c) => ({
    type: "grader_tighten",
    target: "verify-gate",
    rationale: `Generic test failures occurred ${c.count}x on ${c.step}.`,
    patch: "Require the full test suite (not only touched files) to pass before the verify gate accepts.",
  }),
};

export function proposeDeltas(report: AnalysisReport): ConfigDelta[] {
  return report.failureClusters.map((c, i) => ({
    id: `delta-${i + 1}-${c.pattern}`,
    sourcePattern: c.pattern,
    ...TEMPLATES[c.pattern](c),
  }));
}
