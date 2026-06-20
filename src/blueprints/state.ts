// src/blueprints/state.ts
import { Annotation } from "@langchain/langgraph";
import type { ActionResult } from "./types";
import type { GoalSpec } from "../loop/goal";

/**
 * A single verification result from a deterministic step.
 */
export interface VerificationResult {
  /** The step/action name that produced this result */
  step: string;
  /** Whether the verification passed */
  passed: boolean;
  /** Output or error text from the verification */
  output: string;
}

/**
 * Blueprint state annotation for LangGraph StateGraph.
 * Uses Annotation.Root() for modern LangGraph API.
 *
 * Extended with fields for the verification feedback loop:
 * - iteration / maxIterations: track retry attempts
 * - verificationResults: accumulated results from verify steps
 * - agentMessages: messages from agent turns for context injection
 */
export const BlueprintStateAnnotation = Annotation.Root({
  /** Original task input */
  input: Annotation<string>(),

  /** Current state ID */
  currentState: Annotation<string>(),

  /** Last action result (for conditional transitions) */
  lastResult: Annotation<ActionResult | undefined>(),

  /** Error message if something went wrong */
  error: Annotation<string>({
    reducer: (_, y) => y ?? "",
    default: () => "",
  }),

  /** Current retry iteration (0-based). Increments each time the agent retries. */
  iteration: Annotation<number>({
    reducer: (_, y) => y ?? 0,
    default: () => 0,
  }),

  /** Maximum number of retries before escalating. */
  maxIterations: Annotation<number>({
    reducer: (_, y) => y ?? 2,
    default: () => 2,
  }),

  /** Accumulated verification results from deterministic steps. */
  verificationResults: Annotation<VerificationResult[]>({
    reducer: (prev, next) => next ?? prev ?? [],
    default: () => [],
  }),

  /** Messages from agent turns, used to feed context back into retries. */
  agentMessages: Annotation<unknown[]>({
    reducer: (prev, next) => next ?? prev ?? [],
    default: () => [],
  }),

  goal: Annotation<GoalSpec | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
  traceId: Annotation<string | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
  loopOutcome: Annotation<"passed" | "escalated" | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
});
