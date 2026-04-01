import { createLogger } from "./utils/logger";
import { END, START, StateGraph } from "@langchain/langgraph";
import { coderNode } from "./nodes/coder";
import { linterNode } from "./nodes/linter";
import { testsNode } from "./nodes/tests";
import { formatNode } from "./nodes/format";
import { validateNode } from "./nodes/validate";
import { plannerNode } from "./nodes/planner";
import { fixerNode } from "./nodes/fixer";
import { CodeagentState } from "./utils/state";
import { writeRepoMemoryAfterAgentTurn } from "./memory/supabaseRepoMemory";

const logger = createLogger("server");

// Maximum iterations before giving up (prevents infinite loops)
const MAX_ITERATIONS = 5;

/**
 * Extended mode includes planner and fixer nodes.
 * Controlled by EXTENDED_MODE environment variable.
 */
const EXTENDED_MODE = process.env.EXTENDED_MODE === "true";

/**
 * Route after format node.
 * Returns "coder" if formatting failed, otherwise "linter".
 */
function routeAfterFormat(state: typeof CodeagentState.State): string {
  const iterations = state.iterations || 0;
  if (iterations >= MAX_ITERATIONS) {
    logger.info("[codeagent][graph] Max iterations reached, ending");
    return END;
  }
  // Check if format failed
  if (state.formatResults && !state.formatResults.success) {
    logger.info("[codeagent][graph] Format failed, routing to coder");
    return "coder";
  }
  return "linter";
}

/**
 * Route after linter node.
 * Returns "coder" if linting failed, otherwise "validate".
 */
function routeAfterLinter(state: typeof CodeagentState.State): string {
  const iterations = state.iterations || 0;
  if (iterations >= MAX_ITERATIONS) {
    logger.info("[codeagent][graph] Max iterations reached, ending");
    return END;
  }
  // Check if linter failed via structured status field
  if (state.linterResults && !state.linterResults.success) {
    logger.info("[codeagent][graph] Linter failed, routing to coder");
    return "coder";
  }
  return "validate";
}

/**
 * Route after validate node.
 * Returns "coder" if validation failed, otherwise "tests".
 */
function routeAfterValidate(state: typeof CodeagentState.State): string {
  const iterations = state.iterations || 0;
  if (iterations >= MAX_ITERATIONS) {
    logger.info("[codeagent][graph] Max iterations reached, ending");
    return END;
  }
  // Check if validation failed
  if (state.validationResults && !state.validationResults.passed) {
    logger.info("[codeagent][graph] Validation failed, routing to coder");
    return "coder";
  }
  return "tests";
}

/**
 * Route after tests node.
 * Returns "coder" if tests failed, otherwise END.
 */
function routeAfterTests(state: typeof CodeagentState.State): string {
  const iterations = state.iterations || 0;
  if (iterations >= MAX_ITERATIONS) {
    logger.info("[codeagent][graph] Max iterations reached, ending");
    return END;
  }
  // Check if tests failed
  if (state.testResults && !state.testResults.passed) {
    logger.info("[codeagent][graph] Tests failed, routing to coder");
    return "coder";
  }
  return END;
}

/**
 * Increment iteration counter when routing back to coder.
 */
function incrementIterations(
  state: typeof CodeagentState.State,
): Partial<typeof CodeagentState.State> {
  return {
    iterations: (state.iterations || 0) + 1,
    input: `Fix the following errors:\n${state.error || ""}\n${state.testResults?.output || ""}\n${state.formatResults?.output || ""}\n${state.linterResults?.output || ""}`,
    error: "",
    // Clear previous results
    testResults: undefined,
    formatResults: undefined,
    linterResults: undefined,
    validationResults: undefined,
  };
}

/**
 * CodeAgent blueprint: agentic nodes (reasoning) + deterministic nodes (verify).
 *
 * Standard pipeline flow with failure handling:
 * START → coder (agentic) → format → [if fail → coder] → linter → [if fail → coder] →
 *   validate → [if fail → coder] → tests → [if fail → coder] → END
 *
 * Extended pipeline flow (when EXTENDED_MODE=true):
 * START → planner (agentic) → coder (agentic) → format → [if fail → coder] → linter → [if fail → coder] →
 *   validate → [if fail → coder] → tests → [if fail → coder] → fixer (agentic) → END
 *
 * @see https://www.mindstudio.ai/blog/stripe-minions-blueprint-architecture-deterministic-agentic-nodes
 */
function buildCodeagentGraph() {
  const g = new StateGraph(CodeagentState);

  if (EXTENDED_MODE) {
    // Extended mode with planner and fixer
    g.addNode("planner", plannerNode)
      .addNode("coder", coderNode)
      .addNode("format", formatNode)
      .addNode("linter", linterNode)
      .addNode("validate", validateNode)
      .addNode("tests", testsNode)
      .addNode("fixer", fixerNode)
      .addNode("increment_iterations", incrementIterations as any)
      .addEdge(START, "planner")
      .addEdge("planner", "coder")
      .addEdge("coder", "format")
      .addConditionalEdges("format", routeAfterFormat as any, {
        coder: "increment_iterations",
        linter: "linter",
        [END]: END,
      })
      .addEdge("increment_iterations", "coder")
      .addConditionalEdges("linter", routeAfterLinter as any, {
        coder: "increment_iterations",
        validate: "validate",
        [END]: END,
      })
      .addConditionalEdges("validate", routeAfterValidate as any, {
        coder: "increment_iterations",
        tests: "tests",
        [END]: END,
      })
      .addConditionalEdges("tests", routeAfterTests as any, {
        coder: "increment_iterations",
        fixer: "fixer",
        [END]: END,
      })
      .addEdge("fixer", END);

    logger.info(
      "[codeagent][graph] Built extended graph with planner, fixer, and failure routing",
    );
  } else {
    // Standard mode with failure routing
    g.addNode("coder", coderNode)
      .addNode("format", formatNode)
      .addNode("linter", linterNode)
      .addNode("validate", validateNode)
      .addNode("tests", testsNode)
      .addNode("increment_iterations", incrementIterations as any)
      .addEdge(START, "coder")
      .addEdge("coder", "format")
      .addConditionalEdges("format", routeAfterFormat as any, {
        coder: "increment_iterations",
        linter: "linter",
        [END]: END,
      })
      .addEdge("increment_iterations", "coder")
      .addConditionalEdges("linter", routeAfterLinter as any, {
        coder: "increment_iterations",
        validate: "validate",
        [END]: END,
      })
      .addConditionalEdges("validate", routeAfterValidate as any, {
        coder: "increment_iterations",
        tests: "tests",
        [END]: END,
      })
      .addConditionalEdges("tests", routeAfterTests as any, {
        coder: "increment_iterations",
        [END]: END,
      });

    logger.info("[codeagent][graph] Built standard graph with failure routing");
  }

  return g.compile();
}

let cachedGraph: ReturnType<typeof buildCodeagentGraph> | undefined;

function getGraph() {
  if (!cachedGraph) cachedGraph = buildCodeagentGraph();
  return cachedGraph;
}

/** Run the LangGraph pipeline with all deterministic checkpoints. */
export async function runCodeagentTurn(userText: string): Promise<string> {
  const startedAt = Date.now();
  const graph = getGraph();

  const threadId = "default-session";
  const result = await graph.invoke({
    input: userText,
    reply: "",
    error: "",
    messages: [],
    threadId: "default-session",
    configurable: { thread_id: threadId },
    iterations: 0,
  });

  // Build response from all deterministic results
  const parts: string[] = [];

  if (EXTENDED_MODE && result.plan) {
    parts.push(`**Plan:**\n${result.plan}`);
    parts.push("---");
  }

  if (result.reply) {
    parts.push(`**Agent Reply:**\n${result.reply}`);
  }

  if (result.formatResults) {
    parts.push(
      `\n**Format:** ${result.formatResults.success ? "✓" : "✗"}${result.formatResults.filesChanged ? ` (${result.formatResults.filesChanged} files)` : ""}`,
    );
  }

  if (result.error) {
    // Linter errors
    parts.push(`\n**Linter:** ${result.error}`);
  }
  if (result.linterResults && !result.error) {
    parts.push(
      `\n**Linter:** ${result.linterResults.success ? "✓" : "✗"} (exit ${result.linterResults.exitCode ?? "?"})`,
    );
  }

  if (result.validationResults) {
    const checks = result.validationResults.checks;
    const checkStatus = Object.entries(checks)
      .map(([name, passed]) => `${passed ? "✓" : "✗"} ${name}`)
      .join(", ");
    parts.push(`\n**Validation:** ${checkStatus}`);
  }

  if (result.testResults) {
    parts.push(
      `\n**Tests:** ${result.testResults.passed ? "✓" : "✗"} ${result.testResults.summary || ""}`,
    );
  }

  if (EXTENDED_MODE && result.fixAttempt) {
    parts.push("\n---");
    parts.push(`**Fix Attempt:**\n${result.fixAttempt}`);
  }

  if ((result.iterations || 0) > 0) {
    parts.push(`\n**Iterations:** ${result.iterations}`);
  }

  logger.info(
    { elapsedMs: Date.now() - startedAt, iterations: result.iterations || 0 },
    "[codeagent][graph] turn complete",
  );

  const out = parts.join("\n") || "(empty reply)";
  const max = 8190; // Increased limit for multi-node output
  if (out.length > max) {
    const trimmed = `${out.slice(0, max)}…`;
    void writeRepoMemoryAfterAgentTurn({
      threadId,
      userText,
      input: userText,
      agentReply: result.reply,
      fullTurnOutput: trimmed,
      agentError: result.error || undefined,
      plan: result.plan || undefined,
      fixAttempt: result.fixAttempt || undefined,
      iterations: result.iterations,
      deterministic: {
        formatResults: result.formatResults,
        linterResults: result.linterResults,
        linterError: result.error,
        validationResults: result.validationResults,
        testResults: result.testResults,
      },
    });
    return trimmed;
  }

  void writeRepoMemoryAfterAgentTurn({
    threadId,
    userText,
    input: userText,
    agentReply: result.reply,
    fullTurnOutput: out,
    agentError: result.error || undefined,
    plan: result.plan || undefined,
    fixAttempt: result.fixAttempt || undefined,
    iterations: result.iterations,
    deterministic: {
      formatResults: result.formatResults,
      linterResults: result.linterResults,
      linterError: result.error,
      validationResults: result.validationResults,
      testResults: result.testResults,
    },
  });

  return out;
}

/**
 * LangGraph server entry point.
 * Export the compiled graph for LangGraph Platform deployment.
 *
 * @see https://langchain-ai.github.io/langgraph/concepts/low_level/#stategraph
 */
export function getGraphForExport() {
  return getGraph();
}
