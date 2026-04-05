/**
 * Demonstration script for tool invocation limits middleware.
 * Run with: bun run src/middleware/tool-invocation-limits.demo.ts
 *
 * This script demonstrates:
 * 1. Basic tool invocation tracking
 * 2. Debouncing logic (blocking duplicate calls within time window)
 * 3. Invocation limit enforcement
 * 4. Custom per-tool limits
 * 5. Thread cleanup
 */

import {
  toolInvocationTracker,
  getTrackerStats,
  resetToolInvocationTracker,
  type ToolBlockCheck,
} from "./tool-invocation-limits";

// Demo configuration
const THREAD_ID = "demo-thread-123";
const TOOL_NAME = "grep";
const ARGS = { pattern: "TODO", path: "/src" };

function printResult(check: ToolBlockCheck, action: string): void {
  console.log(`\n${action}`);
  console.log("=".repeat(60));
  console.log(`Blocked: ${check.block}`);
  if (check.count !== undefined) {
    console.log(`Count: ${check.count}`);
  }
  if (check.reason) {
    console.log(`Reason:\n${check.reason}`);
  }
}

function printStats(): void {
  const stats = getTrackerStats();
  console.log("\n📊 Current Stats:");
  console.log("=".repeat(60));
  console.log(`Total Threads: ${stats.totalThreads}`);
  console.log(`Total Invocations: ${stats.totalInvocations}`);
  console.log("By Tool:", stats.invocationsByTool);
  console.log("By Thread:", stats.invocationsByThread);
}

async function main() {
  console.log("🔧 Tool Invocation Limits Middleware Demo");
  console.log("=".repeat(60));

  // Reset tracker for clean demo
  resetToolInvocationTracker();

  // Demo 1: First call should succeed
  console.log("\n📞 Demo 1: First tool call (should succeed)");
  let check = toolInvocationTracker.shouldBlockToolCall(
    THREAD_ID,
    TOOL_NAME,
    ARGS,
  );
  printResult(check, "Check Result:");
  if (!check.block) {
    toolInvocationTracker.trackToolCall(THREAD_ID, TOOL_NAME, ARGS);
    console.log("✅ Tool call tracked successfully");
  }
  printStats();

  // Wait a bit to show time difference
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Demo 2: Immediate duplicate call should be blocked (debounce)
  console.log("\n📞 Demo 2: Immediate duplicate call (should block - debounce)");
  check = toolInvocationTracker.shouldBlockToolCall(THREAD_ID, TOOL_NAME, ARGS);
  printResult(check, "Check Result:");

  // Demo 3: Different args should succeed
  console.log("\n📞 Demo 3: Different arguments (should succeed)");
  const differentArgs = { pattern: "FIXME", path: "/src" };
  check = toolInvocationTracker.shouldBlockToolCall(
    THREAD_ID,
    TOOL_NAME,
    differentArgs,
  );
  printResult(check, "Check Result:");
  if (!check.block) {
    toolInvocationTracker.trackToolCall(THREAD_ID, TOOL_NAME, differentArgs);
    console.log("✅ Tool call tracked successfully");
  }
  printStats();

  // Demo 4: Call multiple times to test limit
  console.log("\n📞 Demo 4: Multiple calls to test invocation limit");
  const maxInvocations = 10; // Default limit
  for (let i = 2; i < maxInvocations; i++) {
    const args = { pattern: `TEST_${i}`, path: "/src" };
    check = toolInvocationTracker.shouldBlockToolCall(
      THREAD_ID,
      TOOL_NAME,
      args,
    );
    if (!check.block) {
      toolInvocationTracker.trackToolCall(THREAD_ID, TOOL_NAME, args);
    }
  }

  console.log(`Made ${maxInvocations - 1} calls...`);
  printStats();

  // Demo 5: Exceed the limit
  console.log("\n📞 Demo 5: Exceed invocation limit (should block)");
  check = toolInvocationTracker.shouldBlockToolCall(
    THREAD_ID,
    TOOL_NAME,
    { pattern: "FINAL", path: "/src" },
  );
  printResult(check, "Check Result:");
  printStats();

  // Demo 6: Different tool should work
  console.log("\n📞 Demo 6: Different tool (should succeed)");
  const differentTool = "read_file";
  check = toolInvocationTracker.shouldBlockToolCall(
    THREAD_ID,
    differentTool,
    { path: "/src/index.ts" },
  );
  printResult(check, "Check Result:");
  if (!check.block) {
    toolInvocationTracker.trackToolCall(THREAD_ID, differentTool, {
      path: "/src/index.ts",
    });
    console.log("✅ Tool call tracked successfully");
  }
  printStats();

  // Demo 7: Clear thread
  console.log("\n📞 Demo 7: Clear thread and try again");
  toolInvocationTracker.clearThread(THREAD_ID);
  console.log("🧹 Thread cleared");
  check = toolInvocationTracker.shouldBlockToolCall(
    THREAD_ID,
    TOOL_NAME,
    ARGS,
  );
  printResult(check, "Check Result:");
  if (!check.block) {
    toolInvocationTracker.trackToolCall(THREAD_ID, TOOL_NAME, ARGS);
    console.log("✅ Tool call tracked successfully");
  }
  printStats();

  console.log("\n✅ Demo complete!");
  console.log(
    "\n💡 Tip: Set TOOL_MAX_INVOCATIONS_DEFAULT, TOOL_DEBOUNCE_WINDOW_MS,",
  );
  console.log("   and PER_TOOL_LIMITS_JSON environment variables to customize behavior.");
}

main().catch(console.error);
