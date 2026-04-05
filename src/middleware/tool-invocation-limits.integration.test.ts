/**
 * Integration test for tool invocation limits middleware in DeepAgents harness.
 *
 * This test verifies that the tool invocation limits middleware is properly
 * integrated and prevents infinite loops during agent execution.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { toolInvocationTracker } from "./tool-invocation-limits";

describe("Tool Invocation Limits - Integration Test", () => {
  beforeEach(() => {
    // Clear the tracker before each test
    toolInvocationTracker.clearThread("test-thread");
  });

  it("should track tool calls for a thread", () => {
    toolInvocationTracker.trackToolCall("test-thread", "search_files", {
      pattern: "*.ts",
    });

    const count = toolInvocationTracker.getInvocationCount(
      "test-thread",
      "search_files",
    );

    expect(count).toBe(1);
  });

  it("should block tool calls when limit is exceeded", () => {
    const toolName = "grep";
    // Use the default limit (10) but track calls with different args to avoid debounce
    const defaultLimit = 10; // TOOL_MAX_INVOCATIONS_DEFAULT

    // Track calls up to the limit, using different args to avoid debounce
    for (let i = 0; i < defaultLimit; i++) {
      toolInvocationTracker.trackToolCall("test-thread", toolName, {
        pattern: `test${i}`,
      });
    }

    // Next call should be blocked
    const blockCheck = toolInvocationTracker.shouldBlockToolCall(
      "test-thread",
      toolName,
      { pattern: "test_final" },
    );

    expect(blockCheck.block).toBe(true);
    expect(blockCheck.reason).toContain("invocation limit");
    expect(blockCheck.count).toBe(defaultLimit);
  });

  it("should block duplicate calls within debounce window", () => {
    const toolName = "search_files";
    const args = { pattern: "*.ts" };

    // Track a call
    toolInvocationTracker.trackToolCall("test-thread", toolName, args);

    // Immediate duplicate should be blocked
    const blockCheck = toolInvocationTracker.shouldBlockToolCall(
      "test-thread",
      toolName,
      args,
    );

    expect(blockCheck.block).toBe(true);
    // The reason should mention this appears to be a retry loop
    expect(blockCheck.reason).toContain("retry loop");
  });

  it("should allow different arguments for the same tool", () => {
    const toolName = "grep";

    toolInvocationTracker.trackToolCall("test-thread", toolName, {
      pattern: "test1",
    });

    const blockCheck = toolInvocationTracker.shouldBlockToolCall(
      "test-thread",
      toolName,
      { pattern: "test2" },
    );

    expect(blockCheck.block).toBe(false);
  });

  it("should clear thread invocations", () => {
    toolInvocationTracker.trackToolCall("test-thread", "search_files", {
      pattern: "*.ts",
    });

    expect(
      toolInvocationTracker.getInvocationCount("test-thread", "search_files"),
    ).toBe(1);

    toolInvocationTracker.clearThread("test-thread");

    expect(
      toolInvocationTracker.getInvocationCount("test-thread", "search_files"),
    ).toBe(0);
  });

  it("should provide actionable error messages", () => {
    // Test debounce message
    toolInvocationTracker.trackToolCall("test-thread", "grep", {
      pattern: "test",
    });

    const debounceCheck = toolInvocationTracker.shouldBlockToolCall(
      "test-thread",
      "grep",
      { pattern: "test" },
    );

    expect(debounceCheck.block).toBe(true);
    expect(debounceCheck.reason).toContain("NEXT STEPS");
    expect(debounceCheck.reason).toContain("Try a different tool or approach");

    // Test limit exceeded message (using default limit of 10)
    const limit = 10;
    const limitTool = "limit_test_tool";
    toolInvocationTracker.clearThread("test-thread");

    for (let i = 0; i < limit; i++) {
      toolInvocationTracker.trackToolCall("test-thread", limitTool, {
        arg: `test${i}`,
      });
    }

    const limitCheck = toolInvocationTracker.shouldBlockToolCall(
      "test-thread",
      limitTool,
      { arg: "test_next" }, // Use different args to avoid debounce
    );

    expect(limitCheck.block).toBe(true);
    expect(limitCheck.reason).toContain("NEXT STEPS");
    expect(limitCheck.reason).toContain("Try an alternative tool or approach");
  });
});
