/**
 * Blueprint Pattern - Workflow Selection Module
 *
 * Exports blueprint types, registry, and utilities for workflow selection.
 * This module works WITH the existing DeepAgents infrastructure, not as a replacement.
 *
 * Usage:
 * ```ts
 * import { selectBlueprint, buildInputWithBlueprint } from './blueprints';
 *
 * const selection = selectBlueprint("fix the login bug");
 * const input = buildInputWithBlueprint(task, selection);
 * await agentHarness.invoke(input, { threadId });
 * ```
 */

// New state machine exports
export type {
  Blueprint,
  State,
  AgentState,
  DeterministicState,
  TerminalState,
  AgentConfig,
  StateTransition,
  ConditionalTransition,
  BlueprintSelection,
  BlueprintState,
  ActionResult,
  DeterministicAction,
} from "./types";

export {
  BlueprintLoader,
  BlueprintValidationError,
  type LoaderOptions,
} from "./loader";

export {
  selectBlueprint,
  getBlueprintById,
  listBlueprints,
} from "./selection";

export {
  BlueprintCompiler,
  BlueprintCompilerError,
} from "./compiler";

export {
  ActionRegistry,
  actionRegistry,
  registerBuiltinActions,
} from "./actions";

export {
  loadAndSelectBlueprints,
  executeWithBlueprint,
} from "./utils";

// Re-import types for utility functions
import type { Blueprint } from "./types";
import type { LoaderOptions } from "./loader";
import type { ActionRegistry } from "./compiler";
import { BlueprintLoader } from "./loader";
import { BlueprintCompiler } from "./compiler";

export async function loadBlueprints(options?: LoaderOptions) {
  const loader = new BlueprintLoader(options);
  return await loader.loadAll();
}

export function compileBlueprint(blueprint: Blueprint, actionRegistry: ActionRegistry) {
  const compiler = new BlueprintCompiler(actionRegistry);
  return compiler.compile(blueprint);
}

// Legacy exports (for backward compatibility)
export {
  // Types
  type BlueprintRegistry,
  type VerificationRequirements,
  type PRRequirements,
  type PromptCustomization,

  // Main exports
  blueprintRegistry,
  buildInputWithBlueprint,
  blueprintToInvokeConfig,
  DEFAULT_BLUEPRINTS,
} from "./blueprint";

export {
  // Retry loop utilities (can be used independently)
  BoundedRetryLoop,
  createBoundedRetryLoop,
  globalRetryLoop,
  type RetryConfig,
  type RetryAttempt,
  type RetryResult,
  DEFAULT_RETRY_CONFIGS,
  defaultEscalationHandler,
} from "./retry-loop";
