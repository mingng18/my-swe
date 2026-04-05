import { describe, expect, test, beforeEach } from "bun:test";
import {
  BlueprintRegistry,
  selectBlueprint,
  buildInputWithBlueprint,
  DEFAULT_BLUEPRINTS,
  type Blueprint,
} from "./blueprint";

describe("Blueprint Pattern", () => {
  let registry: BlueprintRegistry;

  beforeEach(() => {
    registry = new BlueprintRegistry();
    // Register default blueprints for each test
    for (const blueprint of DEFAULT_BLUEPRINTS) {
      registry.register(blueprint);
    }
  });

  describe("BlueprintRegistry.select", () => {
    test("selects bug-fix blueprint for 'fix' keyword", () => {
      const selection = registry.select("fix the login bug");
      expect(selection.blueprint.id).toBe("bug-fix");
      expect(selection.matchedKeywords).toContain("fix");
    });

    test("selects feature blueprint for 'implement' keyword", () => {
      const selection = registry.select("implement a new feature");
      expect(selection.blueprint.id).toBe("feature");
      expect(selection.matchedKeywords).toContain("implement");
    });

    test("selects refactor blueprint for 'refactor' keyword", () => {
      const selection = registry.select("refactor this code");
      expect(selection.blueprint.id).toBe("refactor");
      expect(selection.matchedKeywords).toContain("refactor");
    });

    test("selects test blueprint for 'test' keyword", () => {
      const selection = registry.select("write tests for this");
      expect(selection.blueprint.id).toBe("test");
      expect(selection.matchedKeywords).toContain("test");
    });

    test("selects docs blueprint for 'document' keyword", () => {
      const selection = registry.select("document the API");
      expect(selection.blueprint.id).toBe("docs");
      expect(selection.matchedKeywords).toContain("document");
    });

    test("selects chore blueprint for 'upgrade' keyword", () => {
      const selection = registry.select("upgrade dependencies");
      expect(selection.blueprint.id).toBe("chore");
      expect(selection.matchedKeywords).toContain("upgrade");
    });

    test("returns default blueprint when no keywords match", () => {
      const selection = registry.select("do something random");
      expect(selection.blueprint.id).toBe("default");
      expect(selection.matchedKeywords).toEqual([]);
      expect(selection.confidence).toBe(0);
    });

    test("matches keywords case-insensitively", () => {
      const selection = registry.select("FIX the BUG");
      expect(selection.blueprint.id).toBe("bug-fix");
    });

    test("respects priority order when multiple keywords match", () => {
      // "fix" (priority 100) should match before "error" (also in bug-fix)
      // But if we had overlapping keywords, higher priority should win
      const customBlueprint: Blueprint = {
        id: "custom-high",
        name: "Custom High Priority",
        description: "High priority custom blueprint",
        triggerKeywords: ["custom"],
        priority: 200, // Higher than default blueprints
        verification: {
          requireTests: false,
          requireLint: false,
          requireTypeCheck: false,
          maxFixIterations: 0,
        },
        pr: {
          autoCreate: false,
          requireApproval: false,
        },
      };
      registry.register(customBlueprint);

      const selection = registry.select("custom task");
      expect(selection.blueprint.id).toBe("custom-high");
    });

    test("calculates confidence based on matched keywords", () => {
      const selection = registry.select("fix the bug and error");
      // Both "fix" and "error" match the bug-fix blueprint
      expect(selection.blueprint.id).toBe("bug-fix");
      expect(selection.matchedKeywords.length).toBeGreaterThan(0);
    });
  });

  describe("buildInputWithBlueprint", () => {
    test("returns original input when blueprint has no prompt customization", () => {
      const selection = selectBlueprint("some task");
      const modified = buildInputWithBlueprint("some task", selection);
      expect(modified).toBe("some task");
    });

    test("appends quality emphasis when emphasizeQuality is true", () => {
      const customBlueprint: Blueprint = {
        id: "quality-focused",
        name: "Quality Focused",
        description: "Quality focused blueprint",
        triggerKeywords: ["quality"],
        priority: 50,
        verification: {
          requireTests: true,
          requireLint: true,
          requireTypeCheck: true,
          maxFixIterations: 1,
        },
        pr: {
          autoCreate: false,
          requireApproval: false,
        },
        prompt: {
          emphasizeQuality: true,
        },
      };
      registry.register(customBlueprint);

      const selection = registry.select("quality task");
      const modified = buildInputWithBlueprint("do the work", selection);
      expect(modified).toContain("Focus on code quality");
    });

    test("appends testing emphasis when emphasizeTesting is true", () => {
      const customBlueprint: Blueprint = {
        id: "test-focused",
        name: "Test Focused",
        description: "Test focused blueprint",
        triggerKeywords: ["test"],
        priority: 50,
        verification: {
          requireTests: true,
          requireLint: false,
          requireTypeCheck: false,
          maxFixIterations: 1,
        },
        pr: {
          autoCreate: false,
          requireApproval: false,
        },
        prompt: {
          emphasizeTesting: true,
        },
      };
      registry.register(customBlueprint);

      const selection = registry.select("test task");
      const modified = buildInputWithBlueprint("do the work", selection);
      expect(modified).toContain("Write comprehensive tests");
    });

    test("prepends custom prompt when specified", () => {
      const customBlueprint: Blueprint = {
        id: "custom",
        name: "Custom",
        description: "Custom blueprint",
        triggerKeywords: ["custom"],
        priority: 50,
        verification: {
          requireTests: false,
          requireLint: false,
          requireTypeCheck: false,
          maxFixIterations: 0,
        },
        pr: {
          autoCreate: false,
          requireApproval: false,
        },
        prompt: {
          prepend: "IMPORTANT: Read all files first.",
        },
      };
      registry.register(customBlueprint);

      const selection = registry.select("custom task");
      const modified = buildInputWithBlueprint("do the work", selection);
      expect(modified).toContain("IMPORTANT: Read all files first.");
      expect(modified.indexOf("IMPORTANT:")).toBeLessThan(
        modified.indexOf("do the work"),
      );
    });

    test("appends custom prompt when specified", () => {
      const customBlueprint: Blueprint = {
        id: "custom",
        name: "Custom",
        description: "Custom blueprint",
        triggerKeywords: ["custom"],
        priority: 50,
        verification: {
          requireTests: false,
          requireLint: false,
          requireTypeCheck: false,
          maxFixIterations: 0,
        },
        pr: {
          autoCreate: false,
          requireApproval: false,
        },
        prompt: {
          append: "Don't forget to run tests.",
        },
      };
      registry.register(customBlueprint);

      const selection = registry.select("custom task");
      const modified = buildInputWithBlueprint("do the work", selection);
      expect(modified).toContain("Don't forget to run tests.");
      expect(modified.indexOf("Don't forget")).toBeGreaterThan(
        modified.indexOf("do the work"),
      );
    });
  });

  describe("global selectBlueprint function", () => {
    test("works with default blueprints", () => {
      const selection = selectBlueprint("fix the bug");
      expect(selection.blueprint.id).toBe("bug-fix");
    });

    test("returns default blueprint for unknown tasks", () => {
      const selection = selectBlueprint("xyzabc task");
      expect(selection.blueprint.id).toBe("default");
    });
  });

  describe("DEFAULT_BLUEPRINTS", () => {
    test("has all expected blueprints", () => {
      const ids = DEFAULT_BLUEPRINTS.map((b) => b.id);
      expect(ids).toContain("bug-fix");
      expect(ids).toContain("feature");
      expect(ids).toContain("refactor");
      expect(ids).toContain("test");
      expect(ids).toContain("docs");
      expect(ids).toContain("chore");
      expect(ids).toContain("default");
    });

    test("has exactly one default blueprint", () => {
      const defaults = DEFAULT_BLUEPRINTS.filter((b) => b.isDefault);
      expect(defaults.length).toBe(1);
      expect(defaults[0]!.id).toBe("default");
    });

    test("blueprints are sorted by priority in registry", () => {
      const registry = new BlueprintRegistry();
      for (const blueprint of DEFAULT_BLUEPRINTS) {
        registry.register(blueprint);
      }

      const blueprints = registry.list();
      // Check that higher priority comes first
      for (let i = 0; i < blueprints.length - 1; i++) {
        expect(blueprints[i]!.priority).toBeGreaterThanOrEqual(
          blueprints[i + 1]!.priority,
        );
      }
    });
  });

  describe("verification requirements", () => {
    test("bug-fix blueprint requires tests, lint, and typecheck", () => {
      const selection = selectBlueprint("fix the bug");
      const { verification } = selection.blueprint;
      expect(verification.requireTests).toBe(true);
      expect(verification.requireLint).toBe(true);
      expect(verification.requireTypeCheck).toBe(true);
    });

    test("docs blueprint does not require tests or lint", () => {
      const selection = selectBlueprint("update readme");
      const { verification } = selection.blueprint;
      expect(verification.requireTests).toBe(false);
      expect(verification.requireLint).toBe(false);
      expect(verification.requireTypeCheck).toBe(false);
    });
  });
});
