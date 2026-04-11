/**
 * @deprecated
 *
 * This file contains the OLD blueprint implementation.
 * Use the new state machine blueprint system instead:
 *
 * ```ts
 * import { loadBlueprints, selectBlueprint, compileBlueprint } from './blueprints';
 * ```
 */

import {
  type Blueprint,
  type BlueprintSelection,
  type VerificationRequirements,
  type PRRequirements,
  type PromptCustomization,
  blueprintRegistry,
  selectBlueprint as _selectBlueprint,
  buildInputWithBlueprint,
  blueprintToInvokeConfig,
  DEFAULT_BLUEPRINTS,
} from "./blueprint-legacy";
import { BlueprintRegistry } from "./blueprint-legacy";

// Re-export with Old_ prefix for deprecation
export type { Blueprint as OldBlueprint };
export type { BlueprintSelection as OldBlueprintSelection };
export type { VerificationRequirements };
export type { PRRequirements };
export type { PromptCustomization };

export { BlueprintRegistry as OldBlueprintRegistry };
export const oldBlueprintRegistry = blueprintRegistry;
export const selectOldBlueprint = _selectBlueprint;
export { buildInputWithBlueprint };
export { blueprintToInvokeConfig };
export { DEFAULT_BLUEPRINTS };
