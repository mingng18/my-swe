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

  /**
   * Register an action in the registry.
   * @param action - The action to register
   * @throws {Error} If an action with the same name is already registered
   */
  register(action: DeterministicAction): void {
    if (this.actions.has(action.name)) {
      throw new Error(`Action "${action.name}" is already registered`);
    }
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

/**
 * Builtin action: Run configured linters.
 * @param state - Blueprint state (unused in this action)
 * @returns ActionResult with linter output
 */
const runLintersAction: DeterministicAction = {
  name: "run_linters",
  description: "Run configured linters",
  execute: async (_state: BlueprintState): Promise<ActionResult> => {
    const linterCommand = process.env.LINTER_COMMAND || "bunx tsc --noEmit";
    try {
      const { stdout, stderr } = await execAsync(linterCommand);
      return { success: true, output: stdout || "Linters passed" };
    } catch (error) {
      const err = error as { stderr?: string; message?: string };
      return {
        success: false,
        error: err.stderr || err.message || "Linters failed",
      };
    }
  },
};

/**
 * Builtin action: Run test suite.
 * @param state - Blueprint state (unused in this action)
 * @returns ActionResult with test output
 */
const runTestsAction: DeterministicAction = {
  name: "run_tests",
  description: "Run test suite",
  execute: async (_state: BlueprintState): Promise<ActionResult> => {
    const testCommand = process.env.TEST_COMMAND || "bun test";
    try {
      const { stdout, stderr } = await execAsync(testCommand);
      return { success: true, output: stdout || "Tests passed" };
    } catch (error) {
      const err = error as { stderr?: string; message?: string };
      return {
        success: false,
        error: err.stderr || err.message || "Tests failed",
      };
    }
  },
};

/**
 * Builtin action: Run TypeScript type checking.
 * @param state - Blueprint state (unused in this action)
 * @returns ActionResult with typecheck output
 */
const runTypecheckAction: DeterministicAction = {
  name: "run_typecheck",
  description: "Run TypeScript type checking",
  execute: async (_state: BlueprintState): Promise<ActionResult> => {
    try {
      const { stdout, stderr } = await execAsync("bunx tsc --noEmit");
      return { success: true, output: "Type check passed" };
    } catch (error) {
      const err = error as { stderr?: string; message?: string };
      return {
        success: false,
        error: err.stderr || err.message || "Type check failed",
      };
    }
  },
};

/**
 * Builtin action: Create pull request.
 * @param state - Blueprint state (unused in this action)
 * @returns ActionResult - currently returns not implemented error
 */
const createPrAction: DeterministicAction = {
  name: "create_pr",
  description: "Create pull request",
  execute: async (_state: BlueprintState): Promise<ActionResult> => {
    return { success: false, error: "Not yet implemented" };
  },
};

/**
 * Register all builtin actions to the global registry.
 * This function must be called explicitly to initialize builtin actions.
 */
export function registerBuiltinActions(): void {
  actionRegistry.register(runLintersAction);
  actionRegistry.register(runTestsAction);
  actionRegistry.register(runTypecheckAction);
  actionRegistry.register(createPrAction);
}
