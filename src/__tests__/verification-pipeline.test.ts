import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { runVerificationPipeline } from "../nodes/deterministic/index";
import * as DependencyInstallerNode from "../nodes/deterministic/DependencyInstallerNode";
import * as TestRunnerNode from "../nodes/deterministic/TestRunnerNode";
import * as LinterNode from "../nodes/deterministic/LinterNode";
import * as PRSubmitNode from "../nodes/deterministic/PRSubmitNode";

describe("runVerificationPipeline", () => {
  beforeEach(() => {
    spyOn(DependencyInstallerNode, "installDependencies").mockResolvedValue({
      installed: true,
      packageManager: "npm",
      output: "",
    });
    spyOn(TestRunnerNode, "runTests").mockResolvedValue({
      testPassed: true,
      testExitCode: 0,
      testOutput: "",
    });
    spyOn(LinterNode, "runLinter").mockResolvedValue({
      lintPassed: true,
      lintExitCode: 0,
      lintOutput: "",
    });
    spyOn(PRSubmitNode, "enforcePRSubmission").mockResolvedValue({
      hasChanges: true,
      prCreated: true,
      prUrl: "http://pr",
    });
  });

  afterEach(() => {
    mock.restore();
  });

  const defaultParams = {
    sandbox: {},
    repoDir: "/test",
    repoOwner: "owner",
    repoName: "name",
    threadId: "thread1",
    messages: [],
  };

  it("should successfully execute all steps on the happy path", async () => {
    const result = await runVerificationPipeline(defaultParams);

    expect(result).toEqual({
      dependenciesInstalled: true,
      testsPassed: true,
      lintPassed: true,
      prCreated: true,
      prUrl: "http://pr",
    });

    expect(DependencyInstallerNode.installDependencies).toHaveBeenCalledTimes(1);
    expect(TestRunnerNode.runTests).toHaveBeenCalledTimes(1);
    expect(LinterNode.runLinter).toHaveBeenCalledTimes(1);
    expect(PRSubmitNode.enforcePRSubmission).toHaveBeenCalledTimes(1);
  });

  it("should skip tests and linter if explicitly not required", async () => {
    const result = await runVerificationPipeline({
      ...defaultParams,
      requireTests: false,
      requireLint: false,
    });

    expect(result).toEqual({
      dependenciesInstalled: true,
      prCreated: true,
      prUrl: "http://pr",
    });

    expect(DependencyInstallerNode.installDependencies).toHaveBeenCalledTimes(1);
    expect(TestRunnerNode.runTests).not.toHaveBeenCalled();
    expect(LinterNode.runLinter).not.toHaveBeenCalled();
    expect(PRSubmitNode.enforcePRSubmission).toHaveBeenCalledTimes(1);
  });

  it("should stop execution and return error if tests fail", async () => {
    spyOn(TestRunnerNode, "runTests").mockResolvedValueOnce({
      testPassed: false,
      testExitCode: 1,
      testOutput: "tests failed",
    });

    const result = await runVerificationPipeline(defaultParams);

    expect(result).toEqual({
      dependenciesInstalled: true,
      testsPassed: false,
      error: "Tests failed",
    });

    expect(DependencyInstallerNode.installDependencies).toHaveBeenCalledTimes(1);
    expect(TestRunnerNode.runTests).toHaveBeenCalledTimes(1);
    expect(LinterNode.runLinter).not.toHaveBeenCalled();
    expect(PRSubmitNode.enforcePRSubmission).not.toHaveBeenCalled();
  });

  it("should stop execution and return error if linter fails", async () => {
    spyOn(LinterNode, "runLinter").mockResolvedValueOnce({
      lintPassed: false,
      lintExitCode: 1,
      lintOutput: "lint failed",
    });

    const result = await runVerificationPipeline(defaultParams);

    expect(result).toEqual({
      dependenciesInstalled: true,
      testsPassed: true,
      lintPassed: false,
      error: "Linter failed",
    });

    expect(DependencyInstallerNode.installDependencies).toHaveBeenCalledTimes(1);
    expect(TestRunnerNode.runTests).toHaveBeenCalledTimes(1);
    expect(LinterNode.runLinter).toHaveBeenCalledTimes(1);
    expect(PRSubmitNode.enforcePRSubmission).not.toHaveBeenCalled();
  });

  it("should continue execution even if dependency installation fails or finds no package manager", async () => {
    spyOn(DependencyInstallerNode, "installDependencies").mockResolvedValueOnce({
      installed: false,
      packageManager: "",
      output: "no package.json",
    });

    const result = await runVerificationPipeline(defaultParams);

    expect(result).toEqual({
      dependenciesInstalled: false,
      testsPassed: true,
      lintPassed: true,
      prCreated: true,
      prUrl: "http://pr",
    });

    expect(DependencyInstallerNode.installDependencies).toHaveBeenCalledTimes(1);
    expect(TestRunnerNode.runTests).toHaveBeenCalledTimes(1);
    expect(LinterNode.runLinter).toHaveBeenCalledTimes(1);
    expect(PRSubmitNode.enforcePRSubmission).toHaveBeenCalledTimes(1);
  });

  it("should return error if PR submission fails", async () => {
    spyOn(PRSubmitNode, "enforcePRSubmission").mockResolvedValueOnce({
      hasChanges: true,
      prCreated: false,
      prUrl: "",
      error: "GitHub API rate limit",
    });

    const result = await runVerificationPipeline(defaultParams);

    expect(result).toEqual({
      dependenciesInstalled: true,
      testsPassed: true,
      lintPassed: true,
      prCreated: false,
      prUrl: "",
      error: "GitHub API rate limit",
    });

    expect(DependencyInstallerNode.installDependencies).toHaveBeenCalledTimes(1);
    expect(TestRunnerNode.runTests).toHaveBeenCalledTimes(1);
    expect(LinterNode.runLinter).toHaveBeenCalledTimes(1);
    expect(PRSubmitNode.enforcePRSubmission).toHaveBeenCalledTimes(1);
  });
});
