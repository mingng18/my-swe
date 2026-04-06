import { describe, test } from "bun:test";
import { cleanupDeepAgents } from "./deepagents";

describe("deepagents cleanup", () => {
  test("cleanupDeepAgents executes successfully when maps are empty", async () => {
    // Wait for the cleanup function to complete.
    // If it throws or returns a rejected promise, the test will automatically fail.
    await cleanupDeepAgents();
  });
});
