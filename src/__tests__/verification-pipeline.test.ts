import { describe, it, expect, mock, beforeEach } from "bun:test";

// Mock dependencies before importing the module under test
const mockInstallDependencies = mock(async () => ({ installed: true, packageManager: "npm" }));
const mockRunTests = mock(async () => ({ testPassed: true }));
const mockRunLinter = mock(async () => ({ lintPassed: true }));
const mockEnforcePRSubmission = mock(async () => ({ prCreated: true, prUrl: "http://pr" }));

mock.module("../nodes/deterministic/DependencyInstallerNode", () => ({
  installDependencies: mockInstallDependencies,
}));

mock.module("../nodes/deterministic/TestRunnerNode", () => ({
  runTests: mockRunTests,
}));

mock.module("../nodes/deterministic/LinterNode", () => ({
  runLinter: mockRunLinter,
}));

mock.module("../nodes/deterministic/PRSubmitNode", () => ({
  enforcePRSubmission: mockEnforcePRSubmission,
}));

// Now import the module under test
import { runVerificationPipeline } from "../nodes/deterministic/index";

describe("runVerificationPipeline", () => {
  beforeEach(() => {
    mockInstallDependencies.mockClear();
    mockRunTests.mockClear();
    mockRunLinter.mockClear();
    mockEnforcePRSubmission.mockClear();

    // Reset mocks to their default successful states
    mockInstallDependencies.mockImplementation(async () => ({ installed: true, packageManager: "npm" }));
    mockRunTests.mockImplementation(async () => ({ testPassed: true }));
    mockRunLinter.mockImplementation(async () => ({ lintPassed: true }));
    mockEnforcePRSubmission.mockImplementation(async () => ({ prCreated: true, prUrl: "http://pr" }));
  });

  const defaultParams = {
    sandbox: {},
    repoDir: "/test",
    repoOwner: "owner",
    repoName: "name",
    threadId: "thread1",
    messages: []
  };

  it("should successfully execute all steps on the happy path", async () => {
    const result = await runVerificationPipeline(defaultParams);

    expect(result).toEqual({
      dependenciesInstalled: true,
      testsPassed: true,
      lintPassed: true,
      prCreated: true,
      prUrl: "http://pr"
    });

    expect(mockInstallDependencies).toHaveBeenCalledTimes(1);
    expect(mockRunTests).toHaveBeenCalledTimes(1);
    expect(mockRunLinter).toHaveBeenCalledTimes(1);
    expect(mockEnforcePRSubmission).toHaveBeenCalledTimes(1);
  });

  it("should skip tests and linter if explicitly not required", async () => {
    const result = await runVerificationPipeline({
      ...defaultParams,
      requireTests: false,
      requireLint: false
    });

    expect(result).toEqual({
      dependenciesInstalled: true,
      prCreated: true,
      prUrl: "http://pr"
    });

    expect(mockInstallDependencies).toHaveBeenCalledTimes(1);
    expect(mockRunTests).not.toHaveBeenCalled();
    expect(mockRunLinter).not.toHaveBeenCalled();
    expect(mockEnforcePRSubmission).toHaveBeenCalledTimes(1);
  });

  it("should stop execution and return error if tests fail", async () => {
    mockRunTests.mockImplementationOnce(async () => ({ testPassed: false }));

    const result = await runVerificationPipeline(defaultParams);

    expect(result).toEqual({
      dependenciesInstalled: true,
      testsPassed: false,
      error: "Tests failed"
    });

    expect(mockInstallDependencies).toHaveBeenCalledTimes(1);
    expect(mockRunTests).toHaveBeenCalledTimes(1);
    expect(mockRunLinter).not.toHaveBeenCalled();
    expect(mockEnforcePRSubmission).not.toHaveBeenCalled();
  });

  it("should stop execution and return error if linter fails", async () => {
    mockRunLinter.mockImplementationOnce(async () => ({ lintPassed: false }));

    const result = await runVerificationPipeline(defaultParams);

    expect(result).toEqual({
      dependenciesInstalled: true,
      testsPassed: true,
      lintPassed: false,
      error: "Linter failed"
    });

    expect(mockInstallDependencies).toHaveBeenCalledTimes(1);
    expect(mockRunTests).toHaveBeenCalledTimes(1);
    expect(mockRunLinter).toHaveBeenCalledTimes(1);
    expect(mockEnforcePRSubmission).not.toHaveBeenCalled();
  });

  it("should continue execution even if dependency installation fails or finds no package manager", async () => {
    mockInstallDependencies.mockImplementationOnce(async () => ({
      installed: false,
      packageManager: "unknown",
      output: "no package.json"
    }));

    const result = await runVerificationPipeline(defaultParams);

    expect(result).toEqual({
      dependenciesInstalled: false,
      testsPassed: true,
      lintPassed: true,
      prCreated: true,
      prUrl: "http://pr"
    });

    expect(mockInstallDependencies).toHaveBeenCalledTimes(1);
    expect(mockRunTests).toHaveBeenCalledTimes(1);
    expect(mockRunLinter).toHaveBeenCalledTimes(1);
    expect(mockEnforcePRSubmission).toHaveBeenCalledTimes(1);
  });

  it("should return error if PR submission fails", async () => {
    mockEnforcePRSubmission.mockImplementationOnce(async () => ({
      prCreated: false,
      prUrl: "error: GitHub API rate limit"
    }));

    const result = await runVerificationPipeline(defaultParams);

    expect(result).toEqual({
      dependenciesInstalled: true,
      testsPassed: true,
      lintPassed: true,
      prCreated: false,
      prUrl: "error: GitHub API rate limit"
    });

    expect(mockInstallDependencies).toHaveBeenCalledTimes(1);
    expect(mockRunTests).toHaveBeenCalledTimes(1);
    expect(mockRunLinter).toHaveBeenCalledTimes(1);
    expect(mockEnforcePRSubmission).toHaveBeenCalledTimes(1);
  });
});
