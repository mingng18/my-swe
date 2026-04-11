// src/blueprints/compiler.ts
import { StateGraph } from "@langchain/langgraph";
import type {
  Blueprint,
  BlueprintState,
  State,
  AgentState,
  DeterministicState,
} from "./types";
import {
  ActionRegistry,
  type ActionRegistry as ActionRegistryType,
} from "./actions";

// Re-export for convenience
export type { ActionRegistryType as ActionRegistry };
export { ActionRegistry } from "./actions";

export class BlueprintCompilerError extends Error {
  constructor(
    public blueprintId: string,
    public reason: string,
  ) {
    super(`Failed to compile blueprint '${blueprintId}': ${reason}`);
    this.name = "BlueprintCompilerError";
  }
}

export class BlueprintCompiler {
  constructor(private actionRegistry: ActionRegistry) {}

  compile(blueprint: Blueprint): StateGraph<BlueprintState> {
    const channels = {
      input: { value: (x?: string) => x ?? "", default: () => "" },
      currentState: {
        value: (x?: string) => x ?? "",
        default: () => blueprint.initialState,
      },
      lastResult: { value: (x?: any) => x, default: () => undefined },
      error: { value: (x?: string) => x ?? "", default: () => "" },
    };
    const graph = new StateGraph({ channels });

    // First pass: add all nodes with their potential destinations
    for (const [stateId, state] of Object.entries(blueprint.states)) {
      const ends = this.getNodeEnds(state, blueprint);
      if (ends.length > 0) {
        graph.addNode(stateId, this.createNode(state, blueprint), { ends });
      } else {
        graph.addNode(stateId, this.createNode(state, blueprint));
      }
    }

    this.addEdges(graph, blueprint);
    graph.setEntryPoint(blueprint.initialState);
    return graph.compile();
  }

  private getNodeEnds(state: State, blueprint: Blueprint): string[] {
    if (state.type === "agent") {
      return state.next;
    } else if (state.type === "deterministic" && state.on) {
      return [...(state.on.pass || []), ...(state.on.fail || [])];
    }
    return [];
  }

  private createNode(state: State, blueprint: Blueprint) {
    return async (graphState: BlueprintState) => {
      switch (state.type) {
        case "agent":
          return this.executeAgentNode(state, graphState);
        case "deterministic":
          return this.executeDeterministicNode(state, graphState);
        case "terminal":
          return { ...graphState, currentState: "__end__" };
        default:
          throw new BlueprintCompilerError(
            blueprint.id,
            `Unknown state type: ${(state as any).type}`,
          );
      }
    };
  }

  private async executeAgentNode(
    state: AgentState,
    graphState: BlueprintState,
  ): Promise<BlueprintState> {
    return {
      ...graphState,
      currentState: state.next[0] || "__end__",
      lastResult: {
        success: true,
        output: `Agent '${state.config.name || "unnamed"}' executed`,
      },
    };
  }

  private async executeDeterministicNode(
    state: DeterministicState,
    graphState: BlueprintState,
  ): Promise<BlueprintState> {
    const action = this.actionRegistry.get(state.action);
    if (!action)
      throw new BlueprintCompilerError(
        "unknown",
        `Action not found: ${state.action}`,
      );
    const result = await action.execute(graphState);
    return { ...graphState, lastResult: result };
  }

  private addEdges(
    graph: StateGraph<BlueprintState>,
    blueprint: Blueprint,
  ): void {
    for (const [stateId, state] of Object.entries(blueprint.states)) {
      if (state.type === "terminal") continue;
      if (state.type === "agent") {
        for (const next of state.next) graph.addEdge(stateId, next);
      } else if (state.type === "deterministic") {
        if (state.on) {
          graph.addConditionalEdges(
            stateId,
            (s: BlueprintState) => (s.lastResult?.success ? "pass" : "fail"),
            {
              pass: state.on.pass || ["__end__"],
              fail: state.on.fail || ["__end__"],
            },
          );
        } else {
          for (const next of state.next) graph.addEdge(stateId, next);
        }
      }
    }
  }
}
