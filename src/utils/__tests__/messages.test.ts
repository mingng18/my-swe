import { test, expect } from "bun:test";
import { isToolMessage } from "../messages";

test("isToolMessage", () => {
  expect(isToolMessage({ type: "tool" })).toBe(true);
  expect(isToolMessage({ role: "tool" })).toBe(true);
  expect(isToolMessage({ type: "tool", role: "tool" })).toBe(true);

  expect(isToolMessage({ type: "text" })).toBe(false);
  expect(isToolMessage({ role: "user" })).toBe(false);

  expect(isToolMessage(null as any)).toBe(false);
  expect(isToolMessage(undefined as any)).toBe(false);
});
