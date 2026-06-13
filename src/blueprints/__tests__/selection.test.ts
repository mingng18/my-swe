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

  it("should throw error if default blueprint is not found", () => {
    const invalidBlueprints: Blueprint[] = [
      { id: "bug-fix", name: "Bug Fix", description: "Fix bugs", triggerKeywords: ["fix", "bug"], priority: 100, initialState: "start", states: { start: { type: "terminal" } } },
    ];
    expect(() => selectBlueprint("random task", invalidBlueprints)).toThrow("No default blueprint found");
  });

  it("should return correct blueprint when calling getBlueprintById", () => {
    const b = getBlueprintById("bug-fix", blueprints);
    expect(b).toBeDefined();
    expect(b?.id).toBe("bug-fix");
  });

  it("should return undefined when calling getBlueprintById with invalid id", () => {
    const b = getBlueprintById("non-existent", blueprints);
    expect(b).toBeUndefined();
  });

  it("should list blueprints using listBlueprints", () => {
    const b = listBlueprints(blueprints);
    expect(b).toEqual(blueprints);
    expect(b).not.toBe(blueprints); // it should return a new array
  });
});
