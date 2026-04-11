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

export {
  type Blueprint as OldBlueprint,
  type BlueprintSelection as OldBlueprintSelection,
  type BlueprintRegistry as OldBlueprintRegistry,
  type VerificationRequirements,
  type PRRequirements,
  type PromptCustomization,
  blueprintRegistry as oldBlueprintRegistry,
  selectBlueprint as selectOldBlueprint,
  buildInputWithBlueprint,
  blueprintToInvokeConfig,
  DEFAULT_BLUEPRINTS,
} from "./blueprint-legacy";
