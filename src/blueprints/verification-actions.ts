import type { SandboxService } from "../integrations/sandbox-service";
import type { DeterministicAction } from "./types";

export type SandboxAccessor = () => Promise<SandboxService | undefined>;

export function createVerifyTestsAction(getSandbox: SandboxAccessor): DeterministicAction {
  return {
    name: "run_tests",
    description: "Run tests",
    execute: async () => ({ success: true, output: "Stubbed" }),
  };
}

export function createVerifyLintAction(getSandbox: SandboxAccessor): DeterministicAction {
  return {
    name: "run_linters",
    description: "Run linters",
    execute: async () => ({ success: true, output: "Stubbed" }),
  };
}

export function createVerifyTypecheckAction(getSandbox: SandboxAccessor): DeterministicAction {
  return {
    name: "run_typecheck",
    description: "Run typecheck",
    execute: async () => ({ success: true, output: "Stubbed" }),
  };
}

export function createCreatePrAction(getSandbox: SandboxAccessor): DeterministicAction {
  return {
    name: "create_pr",
    description: "Create PR",
    execute: async () => ({ success: true, output: "Stubbed" }),
  };
}
