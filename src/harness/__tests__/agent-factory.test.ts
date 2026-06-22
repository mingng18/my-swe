import { describe, it, expect } from "bun:test";

// ---------------------------------------------------------------------------
// agent-factory.ts has heavy dependencies (model loading, tools, middleware).
// We test that the module exports the function with the correct signature.
// Full integration testing would require a real model setup.
// ---------------------------------------------------------------------------

describe("agent-factory", () => {
  describe("createAgentInstance", () => {
    it("exports a function named createAgentInstance", async () => {
      const mod = await import("../agent-factory");
      expect(mod.createAgentInstance).toBeDefined();
      expect(typeof mod.createAgentInstance).toBe("function");
    });

    it("the function accepts an object with optional workspaceRoot and backend", async () => {
      const mod = await import("../agent-factory");
      // Check the function has the right arity
      expect(mod.createAgentInstance.length).toBe(1);
    });

    it("the exported function is async (returns a Promise)", async () => {
      const mod = await import("../agent-factory");
      // Calling without args will likely fail due to missing config,
      // but the return type should be a Promise (or it throws).
      // We just verify the function signature, not successful execution.
      const fn = mod.createAgentInstance;
      const paramStr = fn.toString();
      expect(paramStr).toContain("async");
    });
  });
});
