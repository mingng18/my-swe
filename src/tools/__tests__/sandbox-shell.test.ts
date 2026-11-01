import { describe, expect, test, mock, beforeEach, spyOn, afterEach } from "bun:test";
import * as sandboxState from "../../utils/sandboxState";
import {
  sandboxShellTool,
  sandboxMetricsTool,
  sandboxNetworkTool,
  sandboxPauseTool,
  sandboxResumeTool,
  sandboxRenewTool,
  sandboxEndpointTool,
} from "../sandbox-shell";

describe("sandbox tools", () => {
  const config = { configurable: { thread_id: "test-thread" } };
  const missingBackendConfig = { configurable: { missingBackend: true } };

  let spy: any;

  beforeEach(() => {
    spy = spyOn(sandboxState, "getSandboxBackendFromConfig").mockImplementation((config: any) => {
      if (config?.configurable?.missingBackend) {
        return null;
      }

      return {
        execute: mock().mockResolvedValue({
          output: "mock output",
          exitCode: 0,
          truncated: false,
        }),
        getInfo: mock().mockResolvedValue({
          id: "sandbox-123",
          state: "running",
          createdAt: "2023-01-01T00:00:00Z",
          expiresAt: "2023-01-01T01:00:00Z",
        }),
        patchEgressRules: mock().mockResolvedValue(true),
        pause: mock().mockResolvedValue(true),
        resume: mock().mockResolvedValue(true),
        renew: mock().mockResolvedValue(true),
        getEndpointUrl: mock().mockResolvedValue("https://example.com:8080"),
      } as any;
    });
  });

  afterEach(() => {
    if (spy) {
      spy.mockRestore();
    }
  });

  describe("sandboxShellTool", () => {
    test("throws error if backend is missing", async () => {
      await expect(
        sandboxShellTool.invoke({ command: "ls" }, missingBackendConfig),
      ).rejects.toThrow("Sandbox backend not initialized");
    });

    test("executes command successfully without shell prefix", async () => {
      const result = await sandboxShellTool.invoke({ command: "ls" }, config);
      expect(result).toEqual({
        stdout: "mock output",
        exitCode: 0,
        truncated: false,
        command: "ls",
      });
    });

    test("executes command successfully with shell prefix", async () => {
      const result = await sandboxShellTool.invoke(
        { command: "echo hello", shell: "bash" },
        config,
      );
      expect(result).toEqual({
        stdout: "mock output",
        exitCode: 0,
        truncated: false,
        command: "echo hello",
      });
    });
  });

  describe("sandboxMetricsTool", () => {
    test("throws error if backend is missing", async () => {
      await expect(
        sandboxMetricsTool.invoke({}, missingBackendConfig),
      ).rejects.toThrow("Sandbox backend not initialized");
    });

    test("returns sandbox info", async () => {
      const result = await sandboxMetricsTool.invoke({}, config);
      expect(result.id).toBe("sandbox-123");
      expect(result.state).toBe("running");
      expect(result.createdAt).toBe("2023-01-01T00:00:00Z");
      expect(result.expiresAt).toBe("2023-01-01T01:00:00Z");
      expect(typeof result.timestamp).toBe("string");
    });
  });

  describe("sandboxNetworkTool", () => {
    test("throws error if backend is missing", async () => {
      await expect(
        sandboxNetworkTool.invoke(
          { rules: [{ action: "allow", target: "example.com" }] },
          missingBackendConfig,
        ),
      ).rejects.toThrow("Sandbox backend not initialized");
    });

    test("updates network policy", async () => {
      const rules: Array<{ action: "allow" | "deny"; target: string }> = [{ action: "allow", target: "example.com" }];
      const result = await sandboxNetworkTool.invoke({ rules }, config);
      expect(result).toEqual({
        success: true,
        rules,
        message: "Network policy updated successfully",
      });
    });
  });

  describe("sandboxPauseTool", () => {
    test("throws error if backend is missing", async () => {
      await expect(
        sandboxPauseTool.invoke({}, missingBackendConfig),
      ).rejects.toThrow("Sandbox backend not initialized");
    });

    test("pauses sandbox", async () => {
      const result = await sandboxPauseTool.invoke({}, config);
      expect(result).toEqual({
        success: true,
        message: "Sandbox paused successfully. Use resume to continue.",
      });
    });
  });

  describe("sandboxResumeTool", () => {
    test("throws error if backend is missing", async () => {
      await expect(
        sandboxResumeTool.invoke({}, missingBackendConfig),
      ).rejects.toThrow("Sandbox backend not initialized");
    });

    test("resumes sandbox", async () => {
      const result = await sandboxResumeTool.invoke({}, config);
      expect(result).toEqual({
        success: true,
        message: "Sandbox resumed successfully",
      });
    });
  });

  describe("sandboxRenewTool", () => {
    test("throws error if backend is missing", async () => {
      await expect(
        sandboxRenewTool.invoke({ timeoutSeconds: 3600 }, missingBackendConfig),
      ).rejects.toThrow("Sandbox backend not initialized");
    });

    test("renews sandbox timeout", async () => {
      const result = await sandboxRenewTool.invoke(
        { timeoutSeconds: 3600 },
        config,
      );
      expect(result).toEqual({
        success: true,
        timeoutSeconds: 3600,
        message: "Sandbox renewed for 3600 seconds",
      });
    });
  });

  describe("sandboxEndpointTool", () => {
    test("throws error if backend is missing", async () => {
      await expect(
        sandboxEndpointTool.invoke({ port: 8080 }, missingBackendConfig),
      ).rejects.toThrow("Sandbox backend not initialized");
    });

    test("gets endpoint url", async () => {
      const result = await sandboxEndpointTool.invoke({ port: 8080 }, config);
      expect(result).toEqual({
        port: 8080,
        url: "https://example.com:8080",
        exists: true,
      });
    });
  });
});
