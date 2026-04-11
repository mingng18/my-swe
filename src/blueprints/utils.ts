// src/blueprints/utils.ts
import { BlueprintLoader } from "./loader";
import { selectBlueprint } from "./selection";
import { BlueprintCompiler } from "./compiler";
import { actionRegistry } from "./actions";
import type { Blueprint, BlueprintSelection } from "./types";

export async function loadAndSelectBlueprints(
  task: string,
  options?: ConstructorParameters<typeof BlueprintLoader>[0],
): Promise<{ blueprints: Blueprint[]; selection: BlueprintSelection }> {
  const loader = new BlueprintLoader(options);
  const blueprints = await loader.loadAll();
  const selection = selectBlueprint(task, blueprints);
  return { blueprints, selection };
}

/**
 * Compile a blueprint for execution.
 * Note: The returned graph should be invoked using the LangGraph API.
 */
export async function executeWithBlueprint(
  task: string,
  options?: ConstructorParameters<typeof BlueprintLoader>[0],
) {
  const { selection } = await loadAndSelectBlueprints(task, options);
  const compiler = new BlueprintCompiler(actionRegistry);
  const graph = compiler.compile(selection.blueprint);
  return graph;
}
