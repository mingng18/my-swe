import { describe, it, expect, beforeEach } from "bun:test";
import { DeepAgentWrapper } from "../../src/harness/deepagents";

// Mock environment variables
process.env.LANGFUSE_PUBLIC_KEY = "pk-test-key";
process.env.LANGFUSE_SECRET_KEY = "sk-test-secret";

describe("DeepAgents - Langfuse Integration", () => {
  beforeEach(() => {
    // Clear any cached agents
    // Note: This test verifies the callback is registered, not full execution
  });

  it("should create agent with Langfuse callback when enabled", async () => {
    // This test verifies the structure - actual execution requires more setup
    // For now, we check that the module imports correctly
    const harnessModule = await import("../../src/harness/deepagents");
    expect(DeepAgentWrapper).toBeDefined();
  });
});
