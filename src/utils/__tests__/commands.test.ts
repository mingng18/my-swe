import { describe, it, expect, spyOn } from "bun:test";
import {
  handleCommand,
  isCommand,
  tokenize,
  listCommands,
  registerCommand,
} from "../commands";
import { getMode, getModelOverride, clearSession } from "../session-store";
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
    expect(tokenize("/PLAN")).toEqual({ cmd: "/plan", args: "" });
  });
  it("returns null for non-commands", () => {
    expect(tokenize("hello world")).toBeNull();
    expect(tokenize("")).toBeNull();
    expect(tokenize("   ")).toBeNull();
    expect(tokenize("not /at start")).toBeNull();
  });
});

describe("isCommand", () => {
  it("recognizes built-in commands", () => {
    expect(isCommand("/usage")).toBe(true);
    expect(isCommand("/export")).toBe(true);
    expect(isCommand("/help")).toBe(true);
    expect(isCommand("/plan")).toBe(true);
    expect(isCommand("/act")).toBe(true);
    expect(isCommand("/model")).toBe(true);
    expect(isCommand("/help@bot")).toBe(true);
  });
  it("rejects unknown commands and plain text", () => {
    expect(isCommand("/nope")).toBe(false);
    expect(isCommand("hello")).toBe(false);
    expect(isCommand("/")).toBe(false);
  });
});

describe("handleCommand (built-ins)", () => {
  it("does not handle ordinary messages", async () => {
    expect((await handleCommand("fix the bug", "t1")).handled).toBe(false);
  });
  it("does not handle unknown slash commands (pass through to agent)", async () => {
    expect((await handleCommand("/nope do thing", "t1")).handled).toBe(false);
  });
  it("handles /help and lists commands", async () => {
    const r = await handleCommand("/help", "t1");
    expect(r.handled).toBe(true);
    expect(r.reply).toContain("/usage");
    expect(r.reply).toContain("/plan");
    expect(r.reply).toContain("/model");
  });
  it("handles /usage (zero metrics for an unseen thread)", async () => {
    const r = await handleCommand("/usage", "never-seen-thread-xyz");
    expect(r.handled).toBe(true);
    expect(r.reply).toContain("Usage for thread");
    expect(r.reply).toContain("LLM calls: 0");
  });
  it("handles /export via the harness state", async () => {
    const spy = spyOn(harness, "getAgentHarness").mockResolvedValue({
      getState: async () => ({
        values: {
          messages: [
            { role: "user", content: "hello" },
            { role: "assistant", content: "hi" },
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

describe("handleCommand (/plan, /act, /model)", () => {
  it("/plan sets plan mode for the thread", async () => {
    clearSession("t-plan");
    const r = await handleCommand("/plan", "t-plan");
    expect(r.handled).toBe(true);
    expect(r.reply).toContain("Plan mode");
    expect(getMode("t-plan")).toBe("plan");
    clearSession("t-plan");
  });
  it("/act restores act mode", async () => {
    clearSession("t-act");
    await handleCommand("/plan", "t-act");
    expect(getMode("t-act")).toBe("plan");
    const r = await handleCommand("/act", "t-act");
    expect(r.handled).toBe(true);
    expect(getMode("t-act")).toBe("act");
    clearSession("t-act");
  });
  it("/model <name> sets the per-thread override; no arg reports it", async () => {
    clearSession("t-model");
    const set = await handleCommand("/model gpt-4o-mini", "t-model");
    expect(set.handled).toBe(true);
    expect(getModelOverride("t-model")).toBe("gpt-4o-mini");

    const cur = await handleCommand("/model", "t-model");
    expect(cur.reply).toContain("gpt-4o-mini");

    const reset = await handleCommand("/model default", "t-model");
    expect(getModelOverride("t-model")).toBeUndefined();
    expect(reset.reply).toContain("cleared");
    clearSession("t-model");
  });
});

describe("extensible registry (slash-commands framework)", () => {
  it("registerCommand adds a callable command", async () => {
    registerCommand("/__testcmd", "test only", (args) => `got:${args}`);
    expect(isCommand("/__testcmd")).toBe(true);
    const r = await handleCommand("/__testcmd hello", "t1");
    expect(r).toEqual({ handled: true, reply: "got:hello" });
  });
  it("listCommands includes the built-ins", () => {
    const cmds = listCommands().map((c) => c.cmd);
    expect(cmds).toContain("/help");
    expect(cmds).toContain("/plan");
    expect(cmds).toContain("/model");
  });
});
