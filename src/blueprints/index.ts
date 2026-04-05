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

export {
  // Types
  type Blueprint,
  type BlueprintSelection,
  type BlueprintRegistry,
  type VerificationRequirements,
  type PRRequirements,
  type PromptCustomization,

  // Main exports
  blueprintRegistry,
  selectBlueprint,
  buildInputWithBlueprint,
  blueprintToInvokeConfig,
  DEFAULT_BLUEPRINTS,
} from './Blueprint';

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
} from './RetryLoop';
