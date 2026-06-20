// src/blueprints/compiler.ts
import { StateGraph } from "@langchain/langgraph";
import type {
  Blueprint,
  BlueprintState,
  State,
  AgentState,
  AgentConfig,
  DeterministicState,
} from "./types";
import { ActionRegistry } from "./actions";
import {
  BlueprintStateAnnotation,
  type VerificationResult,
} from "./state";
import { createLogger } from "../utils/logger";

const logger = createLogger("blueprint-compiler");

// Re-export for convenience
export type { ActionRegistry } from "./actions";

/**
 * Callback interface for executing an agent (LLM) node.
 *
 * The real implementation delegates to a DeepAgent instance;
 * tests can supply a mock.
 */
export interface AgentExecutor {
  execute(
    input: string,
    config: AgentConfig,
  ): Promise<{ output: string; messages: unknown[] }>;
}

export class BlueprintCompilerError extends Error {
  constructor(
    public blueprintId: string,
    public reason: string,
  ) {
    super(`Failed to compile blueprint '${blueprintId}': ${reason}`);
    this.name = "BlueprintCompilerError";
  }
}

/** Type alias for brevity */
type GraphState = typeof BlueprintStateAnnotation.State;

export class BlueprintCompiler {
  constructor(
    private actionRegistry: ActionRegistry,
    private agentExecutor?: AgentExecutor,
  ) {}

  /**
   * Compile a blueprint into a runnable LangGraph graph.
   *
   * Uses the existing state-machine definition (states, initialState, edges).
   */
  compile(blueprint: Blueprint) {
    const graph = new StateGraph(BlueprintStateAnnotation);

    // Add all nodes with their possible destinations
    for (const stateId in blueprint.states) {
      if (!Object.prototype.hasOwnProperty.call(blueprint.states, stateId))
        continue;
      const state = blueprint.states[stateId as keyof typeof blueprint.states];
      const ends = this.getNodeEnds(state);
      if (ends.length > 0) {
        graph.addNode(stateId, this.createNode(state, blueprint), { ends });
      } else {
        graph.addNode(stateId, this.createNode(state, blueprint));
      }
    }

    this.addEdges(graph, blueprint);
    graph.setEntryPoint(blueprint.initialState as never);

    return graph.compile();
  }

  // -----------------------------------------------------------------------
  // Feedback-loop graph
  // -----------------------------------------------------------------------

  /**
   * Build a compiled graph that implements the verification feedback loop:
   *
   *   agent -> verify -> check_results -[pass]-> create_pr -> END
   *                              |
   *                            [fail] -> agent (with error context, up to maxIterations)
   *                              |
   *                     [max reached] -> escalate -> END
   *
   * @param maxRetries  Maximum number of times the agent is retried (default 2).
   */
  compileWithFeedbackLoop(maxRetries: number = 2) {
    const agentExec = this.agentExecutor;
    const actionReg = this.actionRegistry;

    if (!agentExec) {
      throw new BlueprintCompilerError(
        "feedback-loop",
        "AgentExecutor is required for compileWithFeedbackLoop",
      );
    }

    const graph = new StateGraph(BlueprintStateAnnotation);

    // --- agent node ---
    graph.addNode(
      "agent",
      async (state: GraphState): Promise<Partial<GraphState>> => {
        const iteration = (state.iteration ?? 0) + 1;
        let input = state.input;
        const priorFailed = (state.verificationResults ?? []).filter(
          (r) => !r.passed,
        );
        if (priorFailed.length > 0) {
          const fb = priorFailed
            .map((r) => `- ${r.step}: ${r.output}`)
            .join("\n");
          input =
            `Previous attempt failed verification:\n${fb}\n\nPlease fix the failing checks and retry. Original task:\n${state.input}`;
        }
        try {
          const defaultConfig: AgentConfig = { models: [], tools: [] };
          const result = await agentExec.execute(input, defaultConfig);
          return {
            iteration,
            agentMessages: [
              ...(state.agentMessages ?? []),
              ...(result.messages ?? []),
            ],
            lastResult: { success: true, output: result.output },
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error({ err }, "[compiler] Agent node failed");
          return {
            iteration,
            error: msg,
            lastResult: { success: false, error: msg },
          };
        }
      },
    );

    // --- verify node ---
    graph.addNode(
      "verify",
      async (state: GraphState): Promise<Partial<GraphState>> => {
        const profile = state.goal?.verifyProfile ?? "tests+lint";
        const checks = ["run_tests"];
        if (profile.includes("lint")) checks.push("run_linters");
        if (profile.includes("typecheck")) checks.push("run_typecheck");

        // NOTE: do NOT accumulate — return only this iteration's results.
        const results: VerificationResult[] = [];
        for (const name of checks) {
          const action = actionReg.get(name);
          if (!action) continue;
          try {
            const r = await action.execute(state as BlueprintState);
            results.push({
              step: name,
              passed: r.success,
              output: r.output ?? r.error ?? "",
            });
          } catch (err) {
            results.push({
              step: name,
              passed: false,
              output: err instanceof Error ? err.message : String(err),
            });
          }
        }
        return { verificationResults: results };
      },
    );

    // --- check_results node (conditional router) ---
    graph.addNode(
      "check_results",
      async (state: GraphState): Promise<Partial<GraphState>> => {
        // No-op: routing is handled by conditional edges
        return {};
      },
    );

    // --- create_pr node ---
    graph.addNode(
      "create_pr",
      async (state: GraphState): Promise<Partial<GraphState>> => {
        const prAction = actionReg.get("create_pr");
        if (prAction) {
          try {
            const r = await prAction.execute(state as BlueprintState);
            return {
              loopOutcome: "passed",
              lastResult: r,
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              loopOutcome: "passed",
              lastResult: { success: false, error: msg },
              error: msg,
            };
          }
        }
        return {
          loopOutcome: "passed",
          lastResult: { success: false, error: "create_pr action not registered" },
        };
      },
    );

    // --- escalate node (terminal) ---
    graph.addNode(
      "escalate",
      async (state: GraphState): Promise<Partial<GraphState>> => {
        const failedSteps = (state.verificationResults ?? [])
          .filter((r) => !r.passed)
          .map((r) => r.step)
          .join(", ");
        logger.warn(
          { iteration: state.iteration, maxIterations: maxRetries, failedSteps },
          "[compiler] Escalating: max iterations reached",
        );
        return {
          loopOutcome: "escalated",
          error: `Escalated after ${state.iteration ?? maxRetries} iterations. Failed steps: ${failedSteps}`,
          lastResult: {
            success: false,
            error: `Max retries (${maxRetries}) exceeded. Failed: ${failedSteps}`,
          },
        };
      },
    );

    // --- edges ---
    // Note: LangGraph's generics produce false-positive type errors for dynamic
    // node names.  Cast through `any` to match the pattern used in compile().
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = graph as any;
    g.setEntryPoint("agent");
    g.addEdge("agent", "verify");
    g.addEdge("verify", "check_results");
    g.addEdge("create_pr", "__end__");
    g.addEdge("escalate", "__end__");

    // Conditional routing from check_results
    g.addConditionalEdges(
      "check_results",
      (state: GraphState): string => {
        const results = state.verificationResults ?? [];
        const allPassed = results.every((r) => r.passed);

        if (allPassed) {
          return "create_pr";
        }

        const iteration = state.iteration ?? 0;
        if (iteration < maxRetries) {
          return "agent";
        }

        return "escalate";
      },
      {
        create_pr: "create_pr",
        agent: "agent",
        escalate: "escalate",
      },
    );

    // When routing back to agent, inject error context
    // We achieve this by wrapping the agent node to check iteration changes
    // The state reducer for iteration will be managed by a wrapper

    return graph.compile();
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private getNodeEnds(state: State): string[] {
    if (state.type === "agent") {
      return state.next;
    } else if (state.type === "deterministic" && state.on) {
      return [...(state.on.pass || []), ...(state.on.fail || [])];
    }
    return [];
  }

  private createNode(state: State, blueprint: Blueprint) {
    return async (graphState: GraphState): Promise<Partial<GraphState>> => {
      switch (state.type) {
        case "agent":
          return this.executeAgentNode(state, graphState);
        case "deterministic":
          return this.executeDeterministicNode(state, graphState);
        case "terminal":
          return { currentState: "__end__" };
        default:
          throw new BlueprintCompilerError(
            blueprint.id,
            `Unknown state type: ${(state as { type: string }).type}`,
          );
      }
    };
  }

  private async executeAgentNode(
    state: AgentState,
    graphState: GraphState,
  ): Promise<Partial<GraphState>> {
    if (!this.agentExecutor) {
      // Fallback: return stub result (legacy behavior)
      return {
        currentState: state.next[0] || "__end__",
        lastResult: {
          success: true,
          output: `Agent '${state.config.name || "unnamed"}' executed (stub)`,
        },
      };
    }

    try {
      const result = await this.agentExecutor.execute(
        graphState.input,
        state.config,
      );
      return {
        currentState: state.next[0] || "__end__",
        lastResult: { success: true, output: result.output },
        agentMessages: [
          ...(graphState.agentMessages ?? []),
          ...(result.messages ?? []),
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        currentState: state.next[0] || "__end__",
        error: msg,
        lastResult: { success: false, error: msg },
      };
    }
  }

  private async executeDeterministicNode(
    state: DeterministicState,
    graphState: GraphState,
  ): Promise<Partial<GraphState>> {
    const action = this.actionRegistry.get(state.action);
    if (!action) {
      throw new BlueprintCompilerError(
        "unknown",
        `Action not found: ${state.action}`,
      );
    }
    const result = await action.execute(graphState as BlueprintState);
    return { lastResult: result };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private addEdges(graph: any, blueprint: Blueprint): void {
    for (const stateId in blueprint.states) {
      if (!Object.prototype.hasOwnProperty.call(blueprint.states, stateId))
        continue;
      const state = blueprint.states[stateId as keyof typeof blueprint.states];
      if (state.type === "terminal") continue;

      if (state.type === "agent") {
        for (const next of state.next) {
          graph.addEdge(stateId, next);
        }
      } else if (state.type === "deterministic") {
        if (state.on) {
          graph.addConditionalEdges(
            stateId,
            (s: GraphState) =>
              s.lastResult?.success ? "pass" : "fail",
            {
              pass: state.on.pass || ["__end__"],
              fail: state.on.fail || ["__end__"],
            },
          );
        } else if (state.next) {
          for (const next of state.next) {
            graph.addEdge(stateId, next);
          }
        }
      }
    }
  }
}
