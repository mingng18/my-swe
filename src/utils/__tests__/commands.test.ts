import { describe, it, expect, spyOn } from "bun:test";
import {
  handleCommand,
  isCommand,
  tokenize,
  listCommands,
  registerCommand,
} from "../commands";
import { formatTelegramMarkdownV2 } from "../telegram";
import { getMode, getModelOverride, clearSession } from "../session-store";
import * as telemetry from "../telemetry";
import * as harness from "../../harness";
import { threadManager } from "../../harness/thread-manager";

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

// Retrospective #504: the command-reply dispatcher (src/index.ts
// sendCommandReply) must route replies through formatTelegramMarkdownV2 when
// parseMode === "MarkdownV2", mirroring the agent-reply path. Without that,
// /usage, /export, /help output containing unescaped special chars triggers
// Telegram HTTP 400 and the reply is silently dropped. These tests pin the
// invariant the dispatcher relies on (the formatter), since importing index.ts
// runs the server as a top-level side effect.
describe("command reply MarkdownV2 escaping (#504)", () => {
  // Mirror the dispatcher's routing predicate exactly.
  const route = (reply: string, parseMode: string) =>
    parseMode === "MarkdownV2" ? formatTelegramMarkdownV2(reply) : reply;

  it("escapes the special chars named in the blocker: ( ) . -", () => {
    // A /usage-shaped reply: parens, dots, dashes must all be escaped.
    const reply = "Usage for thread (t-1): 1.5k tokens - 2 LLM calls.";
    const escaped = route(reply, "MarkdownV2");
    expect(escaped).not.toBe(reply); // routing actually changed the text
    // Unescaped special chars would break MarkdownV2; assert each got a backslash.
    expect(escaped).toContain("\\(");
    expect(escaped).toContain("\\)");
    expect(escaped).toContain("1\\.5k");
    expect(escaped).toContain(" \\- ");
    expect(escaped).toContain("calls\\.");
  });

  it("passes the reply through unchanged for non-MarkdownV2 modes", () => {
    const reply = "Usage for thread (t-1): 1.5k tokens.";
    expect(route(reply, "Markdown")).toBe(reply);
    expect(route(reply, "")).toBe(reply);
    expect(route(reply, "HTML")).toBe(reply);
  });

  it("escapes an /export reply with untrusted conversation content", () => {
    // /export echoes conversation text, so untrusted content (e.g. a hidden-link
    // or stray parens) must not render as Markdown after escaping.
    const reply = "[user] check (this) out - see fig. 1";
    const escaped = route(reply, "MarkdownV2");
    expect(escaped).not.toContain("(this)");
    expect(escaped).toContain("\\(this\\)");
    expect(escaped).toContain("fig\\. 1");
  });

  it("end-to-end: /usage reply is valid MarkdownV2 after the dispatcher routes it", async () => {
    const r = await handleCommand("/usage", "never-seen-mdv2-thread");
    expect(r.handled).toBe(true);
    expect(r.reply).toBeDefined();
    // Run the real command reply through the same path the dispatcher uses.
    const escaped = route(r.reply!, "MarkdownV2");
    // Routing must have transformed the text (escaping happened).
    expect(escaped).not.toBe(r.reply);
    // The /usage body has parens and a decimal point OUTSIDE code spans
    // ("Tokens: 0 (in 0 / out 0)" and "Wall time: 0.0 s") — these are the
    // exact chars the blocker flags. They MUST be escaped (a raw, unescaped
    // occurrence means Telegram would reject the message with HTTP 400).
    expect(escaped).toContain("\\(in 0 / out 0\\)");
    expect(escaped).toContain("0\\.0 s");
    // And the raw forms must NOT survive (that is the bug the fix prevents).
    expect(escaped).not.toContain("(in 0 / out 0)");
    expect(escaped).not.toContain("0.0 s");
  });
});

describe("/model rebuild preserves history via per-thread checkpointer (#505 retro)", () => {
  it("setting /model rebuilds the agent but KEEPS the thread's checkpointer", async () => {
    const tid = "t-model-history";
    clearSession(tid);
    // Simulate prior conversation history: agent + checkpointer exist.
    threadManager.setAgent(tid, { id: "old-agent" } as any);
    const cp = threadManager.getCheckpointer(tid);

    // /model <name> must rebuild (drop agent) but NOT drop the checkpointer,
    // so the rebuilt agent reuses the same conversation history.
    const r = await handleCommand("/model gpt-4o-mini", tid);
    expect(r.handled).toBe(true);
    expect(threadManager.getAgent(tid)).toBeUndefined();
    expect(threadManager.getCheckpointer(tid)).toBe(cp);

    clearSession(tid);
    threadManager.clearAgent(tid);
  });

  it("clearing /model rebuilds the agent but KEEPS the checkpointer", async () => {
    const tid = "t-model-clear-history";
    clearSession(tid);
    threadManager.setAgent(tid, { id: "old-agent" } as any);
    const cp = threadManager.getCheckpointer(tid);

    const r = await handleCommand("/model default", tid);
    expect(r.handled).toBe(true);
    expect(getModelOverride(tid)).toBeUndefined();
    expect(threadManager.getAgent(tid)).toBeUndefined();
    expect(threadManager.getCheckpointer(tid)).toBe(cp);

    clearSession(tid);
    threadManager.clearAgent(tid);
  });
});

describe("/model provider-family advisory (#505 retro)", () => {
  it("warns when the override looks cross-provider vs the global MODEL", async () => {
    const tid = "t-model-xprovider";
    clearSession(tid);
    const prev = process.env.MODEL;
    process.env.MODEL = "gemini-2.5-flash";
    try {
      const r = await handleCommand("/model gpt-4o", tid);
      expect(r.handled).toBe(true);
      expect(r.reply).toContain("different provider family");
    } finally {
      if (prev === undefined) delete process.env.MODEL;
      else process.env.MODEL = prev;
      clearSession(tid);
      threadManager.clearAgent(tid);
    }
  });

  it("does not warn for a within-family override", async () => {
    const tid = "t-model-withinfamily";
    clearSession(tid);
    const prev = process.env.MODEL;
    process.env.MODEL = "gpt-4o";
    try {
      const r = await handleCommand("/model gpt-4o-mini", tid);
      expect(r.handled).toBe(true);
      expect(r.reply).not.toContain("different provider family");
      // Still carries the general advisory note about provider family.
      expect(r.reply).toContain("NOT the provider");
    } finally {
      if (prev === undefined) delete process.env.MODEL;
      else process.env.MODEL = prev;
      clearSession(tid);
      threadManager.clearAgent(tid);
    }
  });
});

describe("/plan and /act recreate the agent (#505 retro)", () => {
  it("/plan drops the cached agent so the read-only toolset is loaded next turn", async () => {
    const tid = "t-plan-recreate";
    clearSession(tid);
    threadManager.setAgent(tid, { id: "act-agent" } as any);
    // Keep checkpointer to assert mode change preserves history.
    const cp = threadManager.getCheckpointer(tid);

    const r = await handleCommand("/plan", tid);
    expect(r.handled).toBe(true);
    expect(getMode(tid)).toBe("plan");
    expect(threadManager.getAgent(tid)).toBeUndefined();
    // Checkpointer survives the mode-change recreation.
    expect(threadManager.getCheckpointer(tid)).toBe(cp);

    clearSession(tid);
    threadManager.clearAgent(tid);
  });

  it("/act restores the full toolset by dropping the cached agent", async () => {
    const tid = "t-act-recreate";
    clearSession(tid);
    threadManager.setAgent(tid, { id: "plan-agent" } as any);

    const r = await handleCommand("/act", tid);
    expect(r.handled).toBe(true);
    expect(getMode(tid)).toBe("act");
    expect(threadManager.getAgent(tid)).toBeUndefined();

    clearSession(tid);
    threadManager.clearAgent(tid);
  });
});

describe("/export reply is plain text (#509)", () => {
  it("flags the /export reply plainText so the transport sends no parse_mode", async () => {
    const spy = spyOn(harness, "getAgentHarness").mockResolvedValue({
      getState: async () => ({ values: { messages: [{ role: "user", content: "hi" }] } }),
      run: async () => ({ reply: "" }),
      invoke: async () => ({ reply: "" }),
      stream: async function* () {},
    } as any);
    try {
      const r = await handleCommand("/export", "t-plain-509");
      expect(r.handled).toBe(true);
      expect(r.plainText).toBe(true);
      expect(r.reply).toContain("Export for thread");
    } finally {
      spy.mockRestore();
    }
  });
});
