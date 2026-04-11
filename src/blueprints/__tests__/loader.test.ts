// src/blueprints/__tests__/loader.test.ts
import { describe, it, expect } from "bun:test";
import { BlueprintLoader, BlueprintValidationError } from "../loader";

describe("BlueprintLoader", () => {
  describe("parse", () => {
    it("should parse valid blueprint YAML", () => {
      const yaml = `
id: test-blueprint
name: Test Blueprint
description: A test blueprint
triggerKeywords: [test]
priority: 100
initialState: start
states:
  start:
    type: terminal
`;
      const loader = new BlueprintLoader({ validate: false });
      const blueprint = loader.parse(yaml);
      expect(blueprint.id).toBe("test-blueprint");
    });

    it("should throw on missing required fields", () => {
      const yaml = "name: Test";
      const loader = new BlueprintLoader({ validate: true });
      expect(() => loader.parse(yaml)).toThrow(BlueprintValidationError);
    });
  });

  describe("loadAll", () => {
    it("should return empty array when directory does not exist", async () => {
      const loader = new BlueprintLoader({ blueprintsDir: "/nonexistent", validate: false });
      const blueprints = await loader.loadAll();
      expect(blueprints).toEqual([]);
    });
  });
});
