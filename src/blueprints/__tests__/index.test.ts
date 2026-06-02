import { describe, it, expect, spyOn, mock, afterEach } from "bun:test";
import { compileBlueprint, loadBlueprints } from "../index";
import { ActionRegistry } from "../actions";
import { BlueprintCompiler } from "../compiler";
import { BlueprintLoader } from "../loader";
import type { Blueprint } from "../types";

describe("index exports", () => {
  afterEach(() => {
    mock.restore();
  });

  describe("compileBlueprint", () => {
    it("should instantiate BlueprintCompiler and compile the blueprint", () => {
      const actionRegistry = new ActionRegistry();
      const blueprint: Blueprint = {
        id: "test",
        name: "Test Blueprint",
        description: "Test description",
        triggerKeywords: [],
        priority: 0,
        initialState: "start",
        states: {
          start: { type: "terminal" },
        },
      };

      const compileSpy = spyOn(BlueprintCompiler.prototype, "compile");

      const graph = compileBlueprint(blueprint, actionRegistry);

      expect(compileSpy).toHaveBeenCalledWith(blueprint);
      expect(graph).toBeDefined();
      expect(typeof graph.invoke).toBe("function");

      compileSpy.mockRestore();
    });
  });

  describe("loadBlueprints", () => {
    it("should instantiate BlueprintLoader and load all blueprints", async () => {
      const loadAllSpy = spyOn(BlueprintLoader.prototype, "loadAll").mockResolvedValue([]);

      const options = { directory: "some-dir" };
      const blueprints = await loadBlueprints(options);

      expect(loadAllSpy).toHaveBeenCalled();
      expect(blueprints).toEqual([]);

      loadAllSpy.mockRestore();
    });
  });
});
