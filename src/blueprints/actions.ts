// src/blueprints/actions.ts

import { exec } from "child_process";
import { promisify } from "util";
import type {
  DeterministicAction,
  ActionResult,
  BlueprintState,
} from "./types";

const execAsync = promisify(exec);

/**
 * Registry for deterministic actions.
 */
export class ActionRegistry {
  private actions = new Map<string, DeterministicAction>();

  register(action: DeterministicAction): void {
    this.actions.set(action.name, action);
  }

  get(name: string): DeterministicAction | undefined {
    return this.actions.get(name);
  }

  list(): DeterministicAction[] {
    return Array.from(this.actions.values());
  }

  has(name: string): boolean {
    return this.actions.has(name);
  }
}

export const actionRegistry = new ActionRegistry();

const runLintersAction: DeterministicAction = {
  name: "run_linters",
  description: "Run configured linters",
  execute: async (state: BlueprintState): Promise<ActionResult> => {
    const linterCommand = process.env.LINTER_COMMAND || "bunx tsc --noEmit";
    try {
      const { stdout, stderr } = await execAsync(linterCommand);
      return { success: true, output: stdout || "Linters passed" };
    } catch (error: any) {
      return { success: false, error: error.stderr || error.message || "Linters failed" };
    }
  },
};

const runTestsAction: DeterministicAction = {
  name: "run_tests",
  description: "Run test suite",
  execute: async (state: BlueprintState): Promise<ActionResult> => {
    const testCommand = process.env.TEST_COMMAND || "bun test";
    try {
      const { stdout, stderr } = await execAsync(testCommand);
      return { success: true, output: stdout || "Tests passed" };
    } catch (error: any) {
      return { success: false, error: error.stderr || error.message || "Tests failed" };
    }
  },
};

const runTypecheckAction: DeterministicAction = {
  name: "run_typecheck",
  description: "Run TypeScript type checking",
  execute: async (state: BlueprintState): Promise<ActionResult> => {
    try {
      const { stdout, stderr } = await execAsync("bunx tsc --noEmit");
      return { success: true, output: "Type check passed" };
    } catch (error: any) {
      return { success: false, error: error.stderr || error.message || "Type check failed" };
    }
  },
};

const createPrAction: DeterministicAction = {
  name: "create_pr",
  description: "Create pull request",
  execute: async (state: BlueprintState): Promise<ActionResult> => {
    return { success: true, output: "PR creation not yet implemented" };
  },
};

export function registerBuiltinActions(): void {
  actionRegistry.register(runLintersAction);
  actionRegistry.register(runTestsAction);
  actionRegistry.register(runTypecheckAction);
  actionRegistry.register(createPrAction);
}

registerBuiltinActions();
