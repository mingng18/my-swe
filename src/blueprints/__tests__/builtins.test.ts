import { describe, it, expect } from "bun:test";
import {
  BUILTIN_BLUEPRINTS,
  BLUEPRINT_MAX_ITERATIONS,
} from "../builtins";
import type { Blueprint } from "../types";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BUILTIN_BLUEPRINTS", () => {
  it("exports exactly 7 blueprints", () => {
    expect(BUILTIN_BLUEPRINTS).toHaveLength(7);
  });

  const expectedIds = [
    "bug-fix",
    "feature",
    "refactor",
    "test",
    "docs",
    "chore",
    "default",
  ];

  it.each(expectedIds)("contains blueprint with id '%s'", (id) => {
    const bp = BUILTIN_BLUEPRINTS.find((b) => b.id === id);
    expect(bp).toBeDefined();
    expect(bp!.id).toBe(id);
  });

  it("blueprints are sorted by priority descending", () => {
    const priorities = BUILTIN_BLUEPRINTS.map((b) => b.priority);
    for (let i = 1; i < priorities.length; i++) {
      expect(priorities[i - 1]).toBeGreaterThanOrEqual(priorities[i]);
    }
  });
});

describe("BLUEPRINT_MAX_ITERATIONS", () => {
  const expectedIds = [
    "bug-fix",
    "feature",
    "refactor",
    "test",
    "docs",
    "chore",
    "default",
  ];

  it("has entries for all blueprint IDs", () => {
    for (const id of expectedIds) {
      expect(BLUEPRINT_MAX_ITERATIONS).toHaveProperty(id);
    }
  });

  it("maps values match expected retries", () => {
    expect(BLUEPRINT_MAX_ITERATIONS["bug-fix"]).toBe(2);
    expect(BLUEPRINT_MAX_ITERATIONS["feature"]).toBe(3);
    expect(BLUEPRINT_MAX_ITERATIONS["refactor"]).toBe(2);
    expect(BLUEPRINT_MAX_ITERATIONS["test"]).toBe(1);
    expect(BLUEPRINT_MAX_ITERATIONS["docs"]).toBe(0);
    expect(BLUEPRINT_MAX_ITERATIONS["chore"]).toBe(1);
    expect(BLUEPRINT_MAX_ITERATIONS["default"]).toBe(0);
  });
});

describe("Blueprint required fields", () => {
  const requiredFields: (keyof Blueprint)[] = [
    "id",
    "name",
    "states",
    "initialState",
  ];

  it.each(BUILTIN_BLUEPRINTS.map((b) => [b.id, b] as const))(
    "blueprint '%s' has all required fields",
    (id, bp) => {
      for (const field of requiredFields) {
        expect(bp).toHaveProperty(field);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((bp as any)[field]).toBeDefined();
      }
    },
  );

  it.each(BUILTIN_BLUEPRINTS.map((b) => [b.id, b] as const))(
    "blueprint '%s' has at least one state",
    (id, bp) => {
      const stateKeys = Object.keys(bp.states);
      expect(stateKeys.length).toBeGreaterThan(0);
    },
  );

  it.each(BUILTIN_BLUEPRINTS.map((b) => [b.id, b] as const))(
    "blueprint '%s' initialState references a valid state",
    (id, bp) => {
      expect(bp.states).toHaveProperty(bp.initialState);
    },
  );

  it.each(BUILTIN_BLUEPRINTS.map((b) => [b.id, b] as const))(
    "blueprint '%s' has a non-empty name",
    (id, bp) => {
      expect(bp.name.length).toBeGreaterThan(0);
    },
  );
});
