import { describe, it, expect, beforeEach } from "bun:test";
import {
  getSandboxBackendSync,
  getSandboxBackendFromConfig,
  setSandboxBackend,
  clearSandboxBackend,
} from "../sandboxState";
import type { SandboxService } from "../../integrations/sandbox-service";

describe("sandboxState", () => {
  beforeEach(() => {
    // Clear state before each test to ensure isolation
    clearSandboxBackend("test-thread");
    clearSandboxBackend("another-thread");
  });

  const dummyBackend = {} as SandboxService;

  describe("getSandboxBackendSync & setSandboxBackend", () => {
    it("returns null if threadId is falsy", () => {
      expect(getSandboxBackendSync("")).toBeNull();
    });

    it("returns null if no backend is set for threadId", () => {
      expect(getSandboxBackendSync("test-thread")).toBeNull();
    });

    it("returns the set backend for a threadId", () => {
      setSandboxBackend("test-thread", dummyBackend);
      expect(getSandboxBackendSync("test-thread")).toBe(dummyBackend);
    });

    it("ignores falsy threadId when setting", () => {
      setSandboxBackend("", dummyBackend);
      expect(getSandboxBackendSync("")).toBeNull();
    });
  });

  describe("getSandboxBackendFromConfig", () => {
    it("returns null if config is undefined or missing thread_id", () => {
      expect(getSandboxBackendFromConfig(undefined)).toBeNull();
      expect(getSandboxBackendFromConfig({})).toBeNull();
      expect(getSandboxBackendFromConfig({ configurable: {} })).toBeNull();
    });

    it("returns the backend if thread_id is in config", () => {
      setSandboxBackend("test-thread", dummyBackend);
      const config = { configurable: { thread_id: "test-thread" } };
      expect(getSandboxBackendFromConfig(config)).toBe(dummyBackend);
    });

    it("returns null if thread_id is in config but no backend is set", () => {
      const config = { configurable: { thread_id: "test-thread" } };
      expect(getSandboxBackendFromConfig(config)).toBeNull();
    });
  });

  describe("clearSandboxBackend", () => {
    it("removes the backend for a threadId", () => {
      setSandboxBackend("test-thread", dummyBackend);
      expect(getSandboxBackendSync("test-thread")).toBe(dummyBackend);

      clearSandboxBackend("test-thread");
      expect(getSandboxBackendSync("test-thread")).toBeNull();
    });

    it("ignores falsy threadId", () => {
      clearSandboxBackend("");
      // No exception should be thrown
    });
  });
});
