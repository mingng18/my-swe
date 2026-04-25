// src/blueprints/compiler.ts
import { StateGraph } from "@langchain/langgraph";
import type {
  Blueprint,
  BlueprintState,
  State,
  AgentState,
  DeterministicState,
} from "./types";
import { ActionRegistry } from "./actions";
import { BlueprintStateAnnotation } from "./state";

// Re-export for convenience
export type { ActionRegistry } from "./actions";

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

  compile(blueprint: Blueprint) {
    // Use Annotation.Root() for modern LangGraph StateGraph API
    const graph = new StateGraph(BlueprintStateAnnotation);

    // Add all nodes with their possible destinations
    // ⚡ Bolt: Replace Object.entries with for...in to avoid intermediate array allocations
    for (const stateId in blueprint.states) {
      if (!Object.prototype.hasOwnProperty.call(blueprint.states, stateId)) continue;
      const state = blueprint.states[stateId as keyof typeof blueprint.states];
      const ends = this.getNodeEnds(state);
      if (ends.length > 0) {
        graph.addNode(stateId, this.createNode(state, blueprint), { ends });
      } else {
        graph.addNode(stateId, this.createNode(state, blueprint));
      }
    }

    this.addEdges(graph, blueprint);
    graph.setEntryPoint(blueprint.initialState as any);

    return graph.compile();
  }

  private getNodeEnds(state: State): string[] {
    if (state.type === "agent") {
      return state.next;
    } else if (state.type === "deterministic" && state.on) {
      return [...(state.on.pass || []), ...(state.on.fail || [])];
    }
    return [];
  }

  private createNode(state: State, blueprint: Blueprint) {
    return async (graphState: typeof BlueprintStateAnnotation.State) => {
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
    graphState: typeof BlueprintStateAnnotation.State,
  ): Promise<typeof BlueprintStateAnnotation.State> {
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
    graphState: typeof BlueprintStateAnnotation.State,
  ): Promise<typeof BlueprintStateAnnotation.State> {
    const action = this.actionRegistry.get(state.action);
    if (!action)
      throw new BlueprintCompilerError(
        "unknown",
        `Action not found: ${state.action}`,
      );
    const result = await action.execute(graphState);
    return { ...graphState, lastResult: result };
  }

  private addEdges(graph: any, blueprint: Blueprint): void {
    // ⚡ Bolt: Replace Object.entries with for...in to avoid intermediate array allocations
    for (const stateId in blueprint.states) {
      if (!Object.prototype.hasOwnProperty.call(blueprint.states, stateId)) continue;
      const state = blueprint.states[stateId as keyof typeof blueprint.states];
      if (state.type === "terminal") continue;

      if (state.type === "agent") {
        for (const next of state.next) {
          graph.addEdge(stateId, next);
        }
      } else if (state.type === "deterministic") {
        if (state.on) {
          // Use conditional edges if 'on' is specified
          graph.addConditionalEdges(
            stateId,
            (s: typeof BlueprintStateAnnotation.State) =>
              s.lastResult?.success ? "pass" : "fail",
            {
              pass: state.on.pass || ["__end__"],
              fail: state.on.fail || ["__end__"],
            },
          );
        } else if (state.next) {
          // Use simple edges if 'next' is specified
          for (const next of state.next) {
            graph.addEdge(stateId, next);
          }
        }
        // If neither 'on' nor 'next' is specified, the state transitions to __end__
      }
    }
  }
}
