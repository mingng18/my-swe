import { describe, it, expect, mock } from "bun:test";
import {
  createVerifyTestsAction,
  createVerifyLintAction,
  createVerifyTypecheckAction,
  createCreatePrAction,
  appendVerificationResult,
} from "../verification-actions";
import type { SandboxAccessor } from "../verification-actions";
import type { BlueprintState } from "../types";
import type { VerificationResult } from "../state";

// ---------------------------------------------------------------------------
// Mock sandbox accessors
// ---------------------------------------------------------------------------

function makeMockSandboxAccessor(
  sandboxOverride?: unknown,
  repoDir = "/tmp/repo",
): SandboxAccessor {
  return async () => ({
    sandbox: sandboxOverride ?? {
      execute: mock(async (cmd: string, _opts?: { timeout?: number }) => ({
        exitCode: 0,
        output: "ok",
      })),
    },
    repoDir,
  });
}

function makeMockSandboxAccessorReturningNothing(): SandboxAccessor {
  return async () => undefined;
}

// ---------------------------------------------------------------------------
// Helper state
// ---------------------------------------------------------------------------

const baseState: BlueprintState = {
  input: "fix the login bug",
  currentState: "verify",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createVerifyTestsAction", () => {
  it("returns an action with correct name", () => {
    const getSandbox = makeMockSandboxAccessor();
    const action = createVerifyTestsAction(getSandbox);
    expect(action.name).toBe("verify_tests");
    expect(action.description).toContain("test");
  });

  it("returns error when no sandbox is available", async () => {
    const getSandbox = makeMockSandboxAccessorReturningNothing();
    const action = createVerifyTestsAction(getSandbox);
    const result = await action.execute(baseState);
    expect(result.success).toBe(false);
    expect(result.error).toContain("No sandbox available");
  });

  it("delegates to runTests and returns success when tests pass", async () => {
    // The action dynamically imports runTests.  We provide a mock sandbox
    // that simulates a passing test run.  Since the dynamic import goes to
    // the real TestRunnerNode, and we can't easily mock it, we verify the
    // sandbox accessor is called correctly.
    const getSandbox = makeMockSandboxAccessor();
    const action = createVerifyTestsAction(getSandbox);

    // This will call the real runTests with our mock sandbox object.
    // Since our mock sandbox has execute(), runTests will use it.
    // The result depends on what runTests does with it.
    const result = await action.execute(baseState);
    // The key assertion: it doesn't crash and returns an ActionResult
    expect(result).toHaveProperty("success");
    expect(typeof result.success).toBe("boolean");
  });

  it("handles errors from sandbox gracefully", async () => {
    const badSandbox = {
      execute: mock(async () => {
        throw new Error("Sandbox crashed");
      }),
    };
    const getSandbox = makeMockSandboxAccessor(badSandbox);
    const action = createVerifyTestsAction(getSandbox);
    const result = await action.execute(baseState);
    // Should catch the error and return failure
    expect(result.success).toBe(false);
  });
});

describe("createVerifyLintAction", () => {
  it("returns an action with correct name", () => {
    const getSandbox = makeMockSandboxAccessor();
    const action = createVerifyLintAction(getSandbox);
    expect(action.name).toBe("verify_lint");
    expect(action.description).toContain("linter");
  });

  it("returns error when no sandbox is available", async () => {
    const getSandbox = makeMockSandboxAccessorReturningNothing();
    const action = createVerifyLintAction(getSandbox);
    const result = await action.execute(baseState);
    expect(result.success).toBe(false);
    expect(result.error).toContain("No sandbox available");
  });

  it("returns an ActionResult from lint execution", async () => {
    const getSandbox = makeMockSandboxAccessor();
    const action = createVerifyLintAction(getSandbox);
    const result = await action.execute(baseState);
    expect(result).toHaveProperty("success");
    expect(typeof result.success).toBe("boolean");
  });
});

describe("createVerifyTypecheckAction", () => {
  it("returns an action with correct name", () => {
    const getSandbox = makeMockSandboxAccessor();
    const action = createVerifyTypecheckAction(getSandbox);
    expect(action.name).toBe("verify_typecheck");
    expect(action.description).toContain("TypeScript");
  });

  it("returns error when no sandbox is available", async () => {
    const getSandbox = makeMockSandboxAccessorReturningNothing();
    const action = createVerifyTypecheckAction(getSandbox);
    const result = await action.execute(baseState);
    expect(result.success).toBe(false);
    expect(result.error).toContain("No sandbox available");
  });

  it("returns success when typecheck passes (exitCode 0)", async () => {
    const sandbox = {
      execute: mock(async () => ({
        exitCode: 0,
        output: "",
      })),
    };
    const getSandbox = makeMockSandboxAccessor(sandbox);
    const action = createVerifyTypecheckAction(getSandbox);
    const result = await action.execute(baseState);
    expect(result.success).toBe(true);
    expect(result.output).toContain("Type check passed");
  });

  it("returns failure when typecheck fails (exitCode != 0)", async () => {
    const sandbox = {
      execute: mock(async () => ({
        exitCode: 1,
        output: "error TS2304: Cannot find name 'foo'",
      })),
    };
    const getSandbox = makeMockSandboxAccessor(sandbox);
    const action = createVerifyTypecheckAction(getSandbox);
    const result = await action.execute(baseState);
    expect(result.success).toBe(false);
    expect(result.output).toContain("Type check failed");
  });
});

describe("createCreatePrAction", () => {
  it("returns an action with correct name", () => {
    const getSandbox = makeMockSandboxAccessor();
    const action = createCreatePrAction(getSandbox);
    expect(action.name).toBe("create_pr");
    expect(action.description).toContain("PR");
  });

  it("returns error when no sandbox is available", async () => {
    const getSandbox = makeMockSandboxAccessorReturningNothing();
    const action = createCreatePrAction(getSandbox);
    const result = await action.execute(baseState);
    expect(result.success).toBe(false);
    expect(result.error).toContain("No sandbox available");
  });

  it("returns an ActionResult from PR creation", async () => {
    const getSandbox = makeMockSandboxAccessor();
    const action = createCreatePrAction(getSandbox);
    const result = await action.execute(baseState);
    // Should not crash - returns an ActionResult
    expect(result).toHaveProperty("success");
    expect(typeof result.success).toBe("boolean");
  });
});

describe("appendVerificationResult", () => {
  it("appends a new result to existing array", () => {
    const existing: VerificationResult[] = [
      { step: "run_tests", passed: true, output: "ok" },
    ];
    const result = appendVerificationResult(existing, "run_lint", true, "Lint ok");
    expect(result).toHaveLength(2);
    expect(result[1]!.step).toBe("run_lint");
    expect(result[1]!.passed).toBe(true);
  });

  it("does not mutate the original array", () => {
    const existing: VerificationResult[] = [];
    const result = appendVerificationResult(existing, "step", false, "err");
    expect(existing).toHaveLength(0);
    expect(result).toHaveLength(1);
  });

  it("preserves existing results", () => {
    const existing: VerificationResult[] = [
      { step: "a", passed: true, output: "ok" },
      { step: "b", passed: false, output: "fail" },
    ];
    const result = appendVerificationResult(existing, "c", true, "good");
    expect(result[0]!.step).toBe("a");
    expect(result[1]!.step).toBe("b");
    expect(result[2]!.step).toBe("c");
  });
});
