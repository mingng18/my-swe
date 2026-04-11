// src/blueprints/__tests__/selection.test.ts
import { describe, it, expect } from "bun:test";
import { selectBlueprint, getBlueprintById, listBlueprints } from "../selection";
import type { Blueprint } from "../types";

describe("Blueprint Selection", () => {
  const blueprints: Blueprint[] = [
    { id: "bug-fix", name: "Bug Fix", description: "Fix bugs", triggerKeywords: ["fix", "bug"], priority: 100, initialState: "start", states: { start: { type: "terminal" } } },
    { id: "default", name: "Default", description: "Default", triggerKeywords: [], priority: 0, initialState: "start", states: { start: { type: "terminal" } } },
  ];

  it("should select blueprint by keyword match", () => {
    const selection = selectBlueprint("fix the bug", blueprints);
    expect(selection.blueprint.id).toBe("bug-fix");
    expect(selection.matchedKeywords).toContain("fix");
  });

  it("should return default when no match", () => {
    const selection = selectBlueprint("random task", blueprints);
    expect(selection.blueprint.id).toBe("default");
    expect(selection.confidence).toBe(0);
  });
});
