// src/blueprints/actions.ts

import { execFile } from "child_process";
import { promisify } from "util";
import { parse } from "shell-quote";
import type {
  DeterministicAction,
  ActionResult,
  BlueprintState,
} from "./types";

const execFileAsync = promisify(execFile);

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
      const parsed = parse(linterCommand);
      const cmd = parsed[0] as string;
      const args = parsed.slice(1).map(String);
      const { stdout, stderr } = await execFileAsync(cmd, args);
      return { success: true, output: stdout || "Linters passed" };
    } catch (error) {
      const err = error as { stderr?: string | Buffer; message?: string };
      const stderrStr =
        err.stderr instanceof Buffer ? err.stderr.toString() : err.stderr;
      return {
        success: false,
        error: stderrStr || err.message || "Linters failed",
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
      const parsed = parse(testCommand);
      const cmd = parsed[0] as string;
      const args = parsed.slice(1).map(String);
      const { stdout, stderr } = await execFileAsync(cmd, args);
      return { success: true, output: stdout || "Tests passed" };
    } catch (error) {
      const err = error as { stderr?: string | Buffer; message?: string };
      const stderrStr =
        err.stderr instanceof Buffer ? err.stderr.toString() : err.stderr;
      return {
        success: false,
        error: stderrStr || err.message || "Tests failed",
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
      const { stdout, stderr } = await execFileAsync("bunx", [
        "tsc",
        "--noEmit",
      ]);
      return { success: true, output: "Type check passed" };
    } catch (error) {
      const err = error as { stderr?: string | Buffer; message?: string };
      const stderrStr =
        err.stderr instanceof Buffer ? err.stderr.toString() : err.stderr;
      return {
        success: false,
        error: stderrStr || err.message || "Type check failed",
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
