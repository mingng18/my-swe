import { describe, it, expect } from "bun:test";

describe("getGraphForExport", () => {
  it("returns a compiled graph object", async () => {
    const { getGraphForExport } = await import("../graph");
    const graph = getGraphForExport();
    expect(graph).toBeDefined();
    expect(typeof graph.invoke).toBe("function");
    expect(typeof graph.stream).toBe("function");
  });

  it("compiled graph has a nodes property or can be inspected", async () => {
    const { getGraphForExport } = await import("../graph");
    const graph = getGraphForExport();
    expect(graph).toHaveProperty("invoke");
  });
});
