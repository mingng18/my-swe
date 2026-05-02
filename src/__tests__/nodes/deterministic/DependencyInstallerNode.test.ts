import { expect, test, describe } from "bun:test";
import { formatInstallationResults } from "../../../nodes/deterministic/DependencyInstallerNode";

describe("formatInstallationResults", () => {
  test("should format successfully installed results", () => {
    const result = {
      installed: true,
      packageManager: "npm",
      output: "added 100 packages"
    };
    expect(formatInstallationResults(result)).toBe("[OK] Dependencies installed using npm");
  });

  test("should format no package manager detected results", () => {
    const result = {
      installed: false,
      packageManager: null,
      output: ""
    };
    expect(formatInstallationResults(result)).toBe("[INFO] No package manager detected or dependencies already present");
  });

  test("should format installation failed results", () => {
    const result = {
      installed: false,
      packageManager: "npm",
      output: "npm ERR! something went wrong"
    };
    expect(formatInstallationResults(result)).toBe("[WARNING] Dependency installation failed: npm ERR! something went wrong");
  });
});
