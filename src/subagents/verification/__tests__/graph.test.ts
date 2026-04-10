import { describe, it, expect, beforeAll } from "bun:test";
import { getVerificationGraph } from "../graph";

describe("verification graph", () => {
  beforeAll(() => {
    // Set required environment variables for testing
    process.env.MODEL = "gpt-4o";
    process.env.OPENAI_API_KEY = "test-key-for-testing";
    process.env.OPENAI_BASE_URL = "https://api.openai.com/v1";
  });

  it("should compile the graph", async () => {
    const graph = await getVerificationGraph();
    expect(graph).toBeDefined();
    expect(graph).toHaveProperty("invoke");
  });

  it("should have correct structure", async () => {
    const graph = await getVerificationGraph();
    // Compiled graphs should have an invoke method for execution
    expect(typeof graph.invoke).toBe("function");
  });
});
