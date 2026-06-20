// src/loop/__tests__/hitl.test.ts
import { test, expect } from "bun:test";
import { createHITLStore } from "../hitl";

test("create/get/resolve lifecycle", () => {
  const s = createHITLStore();
  const req = s.create({
    threadId: "t1",
    traceId: "tr1",
    reason: "verification failed",
    pendingAction: "create_pr",
    options: ["approve", "reject", "modify"],
  });
  expect(req.requestId).toBeTruthy();
  expect(s.get(req.requestId)?.threadId).toBe("t1");
  const resolved = s.resolve(req.requestId, "approve");
  expect(resolved?.requestId).toBe(req.requestId);
});

test("getByThread returns only unresolved requests", () => {
  const s = createHITLStore();
  const a = s.create({ threadId: "t", traceId: "x", reason: "r", pendingAction: "create_pr", options: ["approve"] });
  s.create({ threadId: "t", traceId: "y", reason: "r2", pendingAction: "create_pr", options: ["approve"] });
  expect(s.getByThread("t")?.traceId).toBe("x");
  s.resolve(a.requestId, "reject");
  // 'a' resolved; the other is still open
  expect(s.getByThread("t")?.traceId).toBe("y");
});
