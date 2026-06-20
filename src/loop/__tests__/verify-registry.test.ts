// src/loop/__tests__/verify-registry.test.ts
import { test, expect } from "bun:test";
import { buildVerifyRegistry } from "../verify-registry";
import type { SandboxAccessor } from "../../blueprints/verification-actions";

const noSandbox: SandboxAccessor = async () => undefined;

test("registers compiler-expected sandbox-backed names for tests+lint", () => {
  const reg = buildVerifyRegistry(noSandbox, "tests+lint");
  expect(reg.has("run_tests")).toBe(true);
  expect(reg.has("run_linters")).toBe(true);
  expect(reg.has("create_pr")).toBe(true);
  expect(reg.has("run_typecheck")).toBe(false);
});

test("tests+lint+typecheck profile also registers run_typecheck", () => {
  const reg = buildVerifyRegistry(noSandbox, "tests+lint+typecheck");
  expect(reg.has("run_typecheck")).toBe(true);
});
