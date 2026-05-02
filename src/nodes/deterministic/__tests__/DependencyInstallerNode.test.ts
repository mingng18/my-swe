import { expect, test, describe, beforeEach, mock } from "bun:test";
import { installDependencies, formatInstallationResults, DependencyInstallerResult, DependencyInstallProgress } from "../DependencyInstallerNode";

describe("DependencyInstallerNode", () => {
  let mockSandbox: any;
  let progressEvents: DependencyInstallProgress[];
  let onProgress: (p: DependencyInstallProgress) => void;

  beforeEach(() => {
    mockSandbox = {
      execute: mock(async () => ({ output: "", exitCode: 0 })),
    };
    progressEvents = [];
    onProgress = (p) => progressEvents.push(p);
  });

  describe("installDependencies", () => {
    test("skips installation if node_modules exists and is not empty", async () => {
      mockSandbox.execute.mockImplementation(async (cmd: string) => {
        if (cmd.includes("test -d")) return { output: "exists" };
        if (cmd.includes("ls -A")) return { output: "some-dir" };
        return { output: "" };
      });

      const result = await installDependencies(mockSandbox, "/test/repo", { onProgress });

      expect(result.installed).toBe(false);
      expect(result.packageManager).toBeNull();
      expect(result.output).toBe("Dependencies already installed");

      expect(progressEvents.length).toBe(2);
      expect(progressEvents[0].stage).toBe("checking");
      expect(progressEvents[1].stage).toBe("complete");
    });

    test("skips if no package manager is detected", async () => {
      mockSandbox.execute.mockImplementation(async (cmd: string) => {
        if (cmd.includes("test -d")) return { output: "not_found" };
        if (cmd.includes("bun.lockb")) return { output: "not_found" };
        return { output: "" };
      });

      const result = await installDependencies(mockSandbox, "/test/repo", { onProgress });

      expect(result.installed).toBe(false);
      expect(result.packageManager).toBeNull();
      expect(result.output).toBe("No package manager found");

      expect(progressEvents[progressEvents.length - 1].stage).toBe("complete");
      expect(progressEvents[progressEvents.length - 1].message).toBe("No package manager found");
    });

    const packageManagers = ["bun", "npm", "yarn", "pnpm"];

    for (const pm of packageManagers) {
      test(`installs successfully with ${pm}`, async () => {
        mockSandbox.execute.mockImplementation(async (cmd: string) => {
          if (cmd.includes("test -d")) return { output: "not_found" };
          if (cmd.includes("bun.lockb")) return { output: pm };
          if (cmd.includes(`${pm} install --silent`)) return { output: "Success log", exitCode: 0 };
          return { output: "" };
        });

        const result = await installDependencies(mockSandbox, "/test/repo", { onProgress });

        expect(result.installed).toBe(true);
        expect(result.packageManager).toBe(pm);
        expect(result.output).toBe("Success log");

        expect(progressEvents.some(p => p.stage === "detecting")).toBe(true);
        expect(progressEvents.some(p => p.stage === "installing")).toBe(true);
        expect(progressEvents[progressEvents.length - 1].stage).toBe("complete");
      });
    }

    test("handles fallback to bun when only package.json is found", async () => {
      mockSandbox.execute.mockImplementation(async (cmd: string) => {
        if (cmd.includes("test -d")) return { output: "not_found" };
        if (cmd.includes("bun.lockb")) return { output: "fallback" };
        if (cmd.includes("bun install --silent")) return { output: "Success log", exitCode: 0 };
        return { output: "" };
      });

      const result = await installDependencies(mockSandbox, "/test/repo", { onProgress });

      expect(result.installed).toBe(true);
      expect(result.packageManager).toBe("bun");
      expect(result.output).toBe("Success log");
    });

    test("returns failed status when install command fails", async () => {
      mockSandbox.execute.mockImplementation(async (cmd: string) => {
        if (cmd.includes("test -d")) return { output: "not_found" };
        if (cmd.includes("bun.lockb")) return { output: "npm" };
        if (cmd.includes("npm install --silent")) return { output: "Error log", exitCode: 1 };
        return { output: "" };
      });

      const result = await installDependencies(mockSandbox, "/test/repo", { onProgress });

      expect(result.installed).toBe(false);
      expect(result.packageManager).toBe("npm");
      expect(result.output).toBe("Error log");

      expect(progressEvents[progressEvents.length - 1].stage).toBe("failed");
    });

    test("handles exceptions thrown by sandbox execute", async () => {
      mockSandbox.execute.mockImplementation(async (cmd: string) => {
        if (cmd.includes("test -d")) return { output: "not_found" };
        if (cmd.includes("bun.lockb")) return { output: "bun" };
        if (cmd.includes("bun install --silent")) throw new Error("Sandbox crashed");
        return { output: "" };
      });

      const result = await installDependencies(mockSandbox, "/test/repo", { onProgress });

      expect(result.installed).toBe(false);
      expect(result.packageManager).toBe("bun");
      expect(result.output).toBe("Sandbox crashed");

      expect(progressEvents[progressEvents.length - 1].stage).toBe("failed");
      expect(progressEvents[progressEvents.length - 1].message).toBe("Installation error: Sandbox crashed");
    });
  });

  describe("formatInstallationResults", () => {
    test("formats successful installation", () => {
      const result: DependencyInstallerResult = {
        installed: true,
        packageManager: "npm",
        output: "done"
      };
      expect(formatInstallationResults(result)).toBe("[OK] Dependencies installed using npm");
    });

    test("formats missing package manager / already installed", () => {
      const result: DependencyInstallerResult = {
        installed: false,
        packageManager: null,
        output: "No package manager"
      };
      expect(formatInstallationResults(result)).toBe("[INFO] No package manager detected or dependencies already present");
    });

    test("formats failed installation", () => {
      const result: DependencyInstallerResult = {
        installed: false,
        packageManager: "yarn",
        output: "Network error"
      };
      expect(formatInstallationResults(result)).toBe("[WARNING] Dependency installation failed: Network error");
    });
  });
});
