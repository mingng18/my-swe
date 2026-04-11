// src/blueprints/state.ts
import { Annotation } from "@langchain/langgraph";
import type { ActionResult } from "./types";

/**
 * Blueprint state annotation for LangGraph StateGraph.
 * Uses Annotation.Root() for modern LangGraph API.
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
});
