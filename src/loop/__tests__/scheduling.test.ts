import { describe, it, expect } from "bun:test";
import { registerScheduledPatterns } from "../scheduling";

describe("LoopScheduling", () => {
  it("returns a scheduler with no patterns when disabled", () => {
    process.env.LOOP_SCHEDULING_ENABLED = "false";
    const s = registerScheduledPatterns();
    expect(s.list().length).toBe(0);
  });
});
