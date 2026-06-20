// src/loop/self-improve/__tests__/apply.test.ts
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { evaluateDelta } from "../apply";
import { createTraceStore } from "../../trace-store";
import type { ConfigDelta } from "../config-rewriter";

const delta: ConfigDelta = {
  id: "d1", type: "prompt_addendum", target: "p",
  rationale: "r", patch: "p", sourcePattern: "import_error",
};

test("accepts a delta that strictly improves pass rate", async () => {
  const decision = await evaluateDelta(delta, {
    evalRunner: async () => 0.8,
    baselinePassRate: 0.5,
  });
  expect(decision.decision).toBe("accept");
  expect(decision.after).toBe(0.8);
});

test("rejects a delta that does not improve (regression or flat)", async () => {
  const flat = await evaluateDelta(delta, { evalRunner: async () => 0.5, baselinePassRate: 0.5 });
  expect(flat.decision).toBe("reject");
  const regress = await evaluateDelta(delta, { evalRunner: async () => 0.3, baselinePassRate: 0.5 });
  expect(regress.decision).toBe("reject");
});
