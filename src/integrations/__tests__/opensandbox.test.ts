import { describe, expect, it } from "bun:test";
import { isOpenSandboxBackend, OpenSandboxBackend } from "../opensandbox";

describe("isOpenSandboxBackend", () => {
  it("should return true for a valid OpenSandboxBackend instance", () => {
    const mockBackend = {
      id: "mock-id",
      execute: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      getSandbox: () => ({})
    };

    expect(isOpenSandboxBackend(mockBackend)).toBe(true);
  });

  it("should return true for a duck-typed object matching the backend shape", () => {
    // Since the actual implementation uses 'in' checks, this duck typed
    // object will return true.
    const duckTyped = {
      id: "duck",
      execute: "not-a-function-but-passes-in-operator",
      getSandbox: "also-passes-in-operator"
    };
    expect(isOpenSandboxBackend(duckTyped)).toBe(true);
  });

  it("should return false for null", () => {
    expect(isOpenSandboxBackend(null)).toBe(false);
  });

  it("should return false for undefined", () => {
    expect(isOpenSandboxBackend(undefined)).toBe(false);
  });

  it("should return false for a string", () => {
    expect(isOpenSandboxBackend("backend")).toBe(false);
  });

  it("should return false for a number", () => {
    expect(isOpenSandboxBackend(123)).toBe(false);
  });

  it("should return false for a boolean", () => {
    expect(isOpenSandboxBackend(true)).toBe(false);
  });

  it("should return false for a generic object", () => {
    expect(isOpenSandboxBackend({})).toBe(false);
  });

  it("should return false for an object missing 'id'", () => {
    const obj = {
      execute: async () => {},
      getSandbox: () => {}
    };
    expect(isOpenSandboxBackend(obj)).toBe(false);
  });

  it("should return false for an object missing 'execute'", () => {
    const obj = {
      id: "test",
      getSandbox: () => {}
    };
    expect(isOpenSandboxBackend(obj)).toBe(false);
  });

  it("should return false for an object missing 'getSandbox'", () => {
    const obj = {
      id: "test",
      execute: async () => {}
    };
    expect(isOpenSandboxBackend(obj)).toBe(false);
  });
});
