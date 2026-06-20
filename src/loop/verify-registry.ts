// src/loop/verify-registry.ts
import { ActionRegistry } from "../blueprints/actions";
import type { DeterministicAction } from "../blueprints/types";
import {
  createVerifyTestsAction,
  createVerifyLintAction,
  createVerifyTypecheckAction,
  createCreatePrAction,
  type SandboxAccessor,
} from "../blueprints/verification-actions";
import type { VerifyProfile } from "./goal";

/**
 * Build the verify ActionRegistry for the loop.
 *
 * `compileWithFeedbackLoop`'s verify node looks actions up by name; this
 * registers the SANDBOX-backed verification creators under exactly the names
 * the verify node (Task 6) queries — `run_tests`, `run_linters`, and (when the
 * profile includes typecheck) `run_typecheck` — plus `create_pr`. We deliberately
 * do NOT use `registerBuiltinActions()` (host-execFile): loop verification must
 * run inside the sandbox.
 */
export function buildVerifyRegistry(
  getSandbox: SandboxAccessor,
  profile: VerifyProfile = "tests+lint",
): ActionRegistry {
  const reg = new ActionRegistry();
  const rename = (a: DeterministicAction, name: string): DeterministicAction => ({
    ...a,
    name,
  });
  reg.register(rename(createVerifyTestsAction(getSandbox), "run_tests"));
  reg.register(rename(createVerifyLintAction(getSandbox), "run_linters"));
  if (profile.includes("typecheck")) {
    reg.register(rename(createVerifyTypecheckAction(getSandbox), "run_typecheck"));
  }
  reg.register(rename(createCreatePrAction(getSandbox), "create_pr"));
  return reg;
}
