import { describe, expect, it, mock } from "bun:test";
import { OpenSandboxBackend } from "./opensandbox";
import { Sandbox, SandboxException } from "@alibaba-group/opensandbox";

describe("OpenSandboxBackend", () => {
  describe("initialize", () => {
    it("should throw a wrapped Error when Sandbox.create throws a SandboxException", async () => {
      // Setup mock
      const mockConfig = {
        domain: "test.example.com",
        apiKey: "test-api-key",
      };

      const expectedErrorCode = "TEST_ERROR_CODE";
      const expectedErrorMessage = "Test error message";

      const mockException = new SandboxException({
        error: {
          code: expectedErrorCode,
          message: expectedErrorMessage,
        }
      });

      // Mock Sandbox.create to throw our specific exception
      mock.module("@alibaba-group/opensandbox", () => ({
        Sandbox: {
          create: mock().mockRejectedValue(mockException)
        },
        SandboxException: SandboxException,
        ConnectionConfig: class {}
      }));

      const backend = new OpenSandboxBackend(mockConfig);

      // Verify the expected error is thrown
      let error: any;
      try {
        await backend.initialize();
      } catch (e) {
        error = e;
      }

      expect(error).toBeDefined();
      expect(error.message).toBe(`Sandbox creation failed: ${expectedErrorMessage}`);

      // Restore module mock
      mock.restore();
    });

    it("should rethrow unknown errors when Sandbox.create throws a non-SandboxException", async () => {
      // Setup mock
      const mockConfig = {
        domain: "test.example.com",
        apiKey: "test-api-key",
      };

      const expectedErrorMessage = "Network error";
      const mockException = new Error(expectedErrorMessage);

      // Mock Sandbox.create to throw our specific exception
      mock.module("@alibaba-group/opensandbox", () => ({
        Sandbox: {
          create: mock().mockRejectedValue(mockException)
        },
        SandboxException: SandboxException,
        ConnectionConfig: class {}
      }));

      const backend = new OpenSandboxBackend(mockConfig);

      // Verify the expected error is thrown
      let error: any;
      try {
        await backend.initialize();
      } catch (e) {
        error = e;
      }

      expect(error).toBeDefined();
      expect(error.message).toBe(expectedErrorMessage);

      // Restore module mock
      mock.restore();
    });

    it("should throw a wrapped Error with default message when SandboxException has no message", async () => {
      // Setup mock
      const mockConfig = {
        domain: "test.example.com",
        apiKey: "test-api-key",
      };

      const expectedErrorCode = "TEST_ERROR_CODE";

      const mockException = new SandboxException({
        error: {
          code: expectedErrorCode,
          // no message
        }
      });

      // Mock Sandbox.create to throw our specific exception
      mock.module("@alibaba-group/opensandbox", () => ({
        Sandbox: {
          create: mock().mockRejectedValue(mockException)
        },
        SandboxException: SandboxException,
        ConnectionConfig: class {}
      }));

      const backend = new OpenSandboxBackend(mockConfig);

      // Verify the expected error is thrown
      let error: any;
      try {
        await backend.initialize();
      } catch (e) {
        error = e;
      }

      expect(error).toBeDefined();
      expect(error.message).toBe("Sandbox creation failed: Unknown error");

      // Restore module mock
      mock.restore();
    });
  });
});
