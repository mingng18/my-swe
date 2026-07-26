import { describe, it, expect, spyOn } from "bun:test";
import { applyRestorationAfterCompaction } from "../decision";
import * as restoration from "../restoration";
import type { BaseMessage } from "@langchain/core/messages";

describe("applyRestorationAfterCompaction", () => {
  it("returns restored files and messages when restoration is successful", () => {
    const applySpy = spyOn(restoration, "applyRestoration").mockReturnValue({
      messages: [{ type: "system", content: "restored plan" } as any],
      restoredFiles: ["test.txt"],
      restoredPlan: true,
    });

    const result = applyRestorationAfterCompaction([], { restoration: { enabled: true } });
    expect(result.restoredFiles).toEqual(["test.txt"]);
    expect(result.messages.length).toBe(1);
    expect(applySpy).toHaveBeenCalledWith([], { enabled: true });
  });

  it("handles no restoration configured, falling back to enabled true", () => {
    const applySpy = spyOn(restoration, "applyRestoration").mockReturnValue({
      messages: [],
      restoredFiles: [],
      restoredPlan: false,
    });

    const result = applyRestorationAfterCompaction([], {});
    expect(result.restoredFiles).toEqual([]);
    expect(result.messages.length).toBe(0);
    expect(applySpy).toHaveBeenCalledWith([], { enabled: true });
  });

  it("handles partial restoration with only plan restored", () => {
    const applySpy = spyOn(restoration, "applyRestoration").mockReturnValue({
      messages: [{ type: "system", content: "restored plan" } as any],
      restoredFiles: [],
      restoredPlan: true,
    });

    const result = applyRestorationAfterCompaction([], { restoration: { enabled: true } });
    expect(result.restoredFiles).toEqual([]);
    expect(result.messages.length).toBe(1);
    expect(applySpy).toHaveBeenCalledWith([], { enabled: true });
  });

  it("handles restoration explicitly disabled in config", () => {
    const applySpy = spyOn(restoration, "applyRestoration").mockReturnValue({
      messages: [],
      restoredFiles: [],
      restoredPlan: false,
    });

    const result = applyRestorationAfterCompaction([], { restoration: { enabled: false } });
    expect(result.restoredFiles).toEqual([]);
    expect(result.messages.length).toBe(0);
    expect(applySpy).toHaveBeenCalledWith([], { enabled: false });
  });
});
