// src/blueprints/__tests__/integration.test.ts

import { describe, it, expect } from "bun:test";
import { BlueprintLoader } from "../loader";
import { selectBlueprint } from "../selection";
import { BlueprintCompiler } from "../compiler";
import { actionRegistry } from "../actions";

describe("Blueprint Integration", () => {
  it("should load, select, and compile a blueprint", async () => {
    const loader = new BlueprintLoader({ validate: true });
    const blueprints = await loader.loadAll();
    expect(blueprints.length).toBeGreaterThan(0);

    const selection = selectBlueprint("fix the login bug", blueprints);
    expect(selection.blueprint.id).toBe("bug-fix");

    const compiler = new BlueprintCompiler(actionRegistry);
    const graph = compiler.compile(selection.blueprint);
    expect(graph).toBeDefined();
  });

  it("should select correct blueprint by keyword", async () => {
    const loader = new BlueprintLoader();
    const blueprints = await loader.loadAll();

    expect(selectBlueprint("fix the bug", blueprints).blueprint.id).toBe("bug-fix");
    expect(selectBlueprint("add a new feature", blueprints).blueprint.id).toBe("feature");
    expect(selectBlueprint("refactor this code", blueprints).blueprint.id).toBe("refactor");
  });

  it("should return default blueprint for unknown task", async () => {
    const loader = new BlueprintLoader();
    const blueprints = await loader.loadAll();

    const selection = selectBlueprint("do something unrelated", blueprints);
    expect(selection.blueprint.id).toBe("default");
    expect(selection.confidence).toBe(0);
  });
});
