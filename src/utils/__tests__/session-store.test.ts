import { describe, it, expect, beforeEach } from "bun:test";
import {
  getMode,
  setMode,
  getModelOverride,
  setModelOverride,
  clearSession,
  getSessionSize,
  purgeStaleSessions,
} from "../session-store";

describe("session-store (per-thread mode + model)", () => {
  beforeEach(() => {
    // Isolate tests: clear the threads each test touches.
    clearSession("t-1");
    clearSession("t-2");
    clearSession("t-plan");
    clearSession("t-model");
  });

  it("defaults to 'act' mode and no model override", () => {
    expect(getMode("t-1")).toBe("act");
    expect(getModelOverride("t-1")).toBeUndefined();
  });

  it("sets and reads mode per thread", () => {
    setMode("t-plan", "plan");
    expect(getMode("t-plan")).toBe("plan");
    // Other threads are unaffected.
    expect(getMode("t-1")).toBe("act");
    setMode("t-plan", "act");
    expect(getMode("t-plan")).toBe("act");
  });

  it("sets and clears model override per thread", () => {
    setModelOverride("t-model", "gpt-4o-mini");
    expect(getModelOverride("t-model")).toBe("gpt-4o-mini");
    setModelOverride("t-model", undefined);
    expect(getModelOverride("t-model")).toBeUndefined();
  });

  it("clearSession removes the thread's state", () => {
    setMode("t-2", "plan");
    setModelOverride("t-2", "x");
    clearSession("t-2");
    expect(getMode("t-2")).toBe("act");
    expect(getModelOverride("t-2")).toBeUndefined();
  });

  it("purgeStaleSessions evicts stale entries", () => {
    setMode("fresh", "plan");
    const t0 = Date.now();
    // Cutoff 1s in the future with a 1ms ttl: "fresh" (set ~now) is now stale.
    const removed = purgeStaleSessions(t0 + 1000, 1);
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(getMode("fresh")).toBe("act"); // evicted -> default
    clearSession("fresh");
  });

  it("tracks session size", () => {
    const before = getSessionSize();
    setMode("t-size", "plan");
    expect(getSessionSize()).toBe(before + 1);
    clearSession("t-size");
    expect(getSessionSize()).toBe(before);
  });
});
