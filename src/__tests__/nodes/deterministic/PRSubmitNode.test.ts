import { expect, test, describe } from "bun:test";
import { wasPrToolCalled } from "../../../nodes/deterministic/PRSubmitNode";

describe("wasPrToolCalled", () => {
  test("returns false for empty messages array", () => {
    expect(wasPrToolCalled([])).toBe(false);
  });

  test("returns false when no matching tool is called", () => {
    const messages = [
      { type: "text", content: "hello" },
      { type: "tool", name: "other_tool", content: '{"success": true}' }
    ];
    expect(wasPrToolCalled(messages)).toBe(false);
  });

  test("returns true when tool is called with success true as stringified JSON", () => {
    const messages = [
      { type: "tool", name: "commit_and_open_pr", content: '{"success": true}' }
    ];
    expect(wasPrToolCalled(messages)).toBe(true);
  });

  test("returns true when tool is called with success true as object", () => {
    const messages = [
      { type: "tool", name: "commit_and_open_pr", content: { success: true } }
    ];
    expect(wasPrToolCalled(messages)).toBe(true);
  });

  test("returns false when tool is called with success false", () => {
    const messages = [
      { type: "tool", name: "commit_and_open_pr", content: '{"success": false}' }
    ];
    expect(wasPrToolCalled(messages)).toBe(false);
  });

  test("continues searching backwards if JSON.parse fails", () => {
    const messages = [
      { type: "tool", name: "commit_and_open_pr", content: '{"success": true}' },
      { type: "tool", name: "commit_and_open_pr", content: "invalid json" }
    ];
    expect(wasPrToolCalled(messages)).toBe(true);
  });

  test("evaluates the last valid message", () => {
    const messages = [
      { type: "tool", name: "commit_and_open_pr", content: '{"success": true}' },
      { type: "tool", name: "commit_and_open_pr", content: '{"success": false}' }
    ];
    expect(wasPrToolCalled(messages)).toBe(false);
  });

  test("handles undefined properties gracefully", () => {
    const messages = [
      null,
      undefined,
      {},
      { type: "tool" },
      { type: "tool", name: "commit_and_open_pr" },
      { type: "tool", name: "commit_and_open_pr", content: null },
      { type: "tool", name: "commit_and_open_pr", content: 'null' }
    ];
    expect(wasPrToolCalled(messages)).toBe(false);
  });
});
