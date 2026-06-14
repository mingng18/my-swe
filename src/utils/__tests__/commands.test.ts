import { describe, it, expect, spyOn } from "bun:test";
import { handleCommand, isCommand, tokenize } from "../commands";
import * as telemetry from "../telemetry";
import * as harness from "../../harness";

describe("tokenize", () => {
  it("parses a bare command", () => {
    expect(tokenize("/usage")).toEqual({ cmd: "/usage", args: "" });
  });
  it("parses command + args", () => {
    expect(tokenize("/model gpt-4o-mini")).toEqual({ cmd: "/model", args: "gpt-4o-mini" });
  });
  it("strips an @botname suffix", () => {
    expect(tokenize("/help@bullhorse_bot extra")).toEqual({ cmd: "/help", args: "extra" });
  });
  it("lowercases the command", () => {
    expect(tokenize("/USAGE")).toEqual({ cmd: "/usage", args: "" });
  });
  it("returns null for non-commands", () => {
    expect(tokenize("hello world")).toBeNull();
    expect(tokenize("")).toBeNull();
    expect(tokenize("   ")).toBeNull();
    expect(tokenize("not /at start")).toBeNull();
  });
});

describe("isCommand", () => {
  it("recognizes owned commands (with optional @bot)", () => {
    expect(isCommand("/usage")).toBe(true);
    expect(isCommand("/export")).toBe(true);
    expect(isCommand("/help")).toBe(true);
    expect(isCommand("/help@bot")).toBe(true);
  });
  it("rejects unknown commands and plain text", () => {
    expect(isCommand("/plan")).toBe(false);
    expect(isCommand("/unknown")).toBe(false);
    expect(isCommand("hello")).toBe(false);
    expect(isCommand("/")).toBe(false);
  });
});

describe("handleCommand", () => {
  it("does not handle ordinary messages", async () => {
    const r = await handleCommand("fix the bug", "t1");
    expect(r.handled).toBe(false);
  });

  it("does not handle unknown slash commands (they pass through to the agent)", async () => {
    const r = await handleCommand("/plan do the thing", "t1");
    expect(r.handled).toBe(false);
  });

  it("handles /help", async () => {
    const r = await handleCommand("/help", "t1");
    expect(r.handled).toBe(true);
    expect(r.reply).toContain("commands");
    expect(r.reply).toContain("/usage");
    expect(r.reply).toContain("/export");
  });

  it("handles /usage and reports metrics (zero for an unseen thread)", async () => {
    const r = await handleCommand("/usage", "never-seen-thread-xyz");
    expect(r.handled).toBe(true);
    expect(r.reply).toContain("Usage for thread");
    expect(r.reply).toContain("LLM calls: 0");
  });

  it("handles /export using the harness state", async () => {
    const spy = spyOn(harness, "getAgentHarness").mockResolvedValue({
      getState: async () => ({
        values: {
          messages: [
            { role: "user", content: "hello" },
            { role: "assistant", content: "hi there" },
          ],
        },
      }),
      run: async () => ({ reply: "" }),
      invoke: async () => ({ reply: "" }),
      stream: async function* () {},
    } as any);
    try {
      const r = await handleCommand("/export", "t-export");
      expect(r.handled).toBe(true);
      expect(r.reply).toContain("Export for thread");
      expect(r.reply).toContain("[user]");
      expect(r.reply).toContain("[assistant]");
    } finally {
      spy.mockRestore();
    }
  });

  it("returns a friendly message when a command throws", async () => {
    const spy = spyOn(telemetry, "getThreadMetrics").mockImplementation(() => {
      throw new Error("boom");
    });
    try {
      const r = await handleCommand("/usage", "t1");
      expect(r.handled).toBe(true);
      expect(r.reply).toContain("Command failed");
    } finally {
      spy.mockRestore();
    }
  });
});
