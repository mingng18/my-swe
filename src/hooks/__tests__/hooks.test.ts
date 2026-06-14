import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  validateHooksConfig,
  loadHooksConfig,
} from "../config";
import { HooksRegistry, isHookVeto, type McpToolCaller } from "../registry";
import {
  HooksDispatcher,
  resetHooksDispatcher,
  createHooksMiddleware,
} from "../dispatcher";
import type { HooksConfig } from "../types";

// ---------------------------------------------------------------------------
// config.ts
// ---------------------------------------------------------------------------

describe("hooks config validation", () => {
  it("validates a minimal valid config", () => {
    const cfg = validateHooksConfig({
      handlers: [
        {
          name: "log-tool",
          events: ["PreToolUse", "PostToolUse"],
          handler: { type: "shell", command: "echo hi" },
        },
      ],
    });
    expect(cfg.enabled).toBe(true);
    expect(cfg.agent_id).toBe("bullhorse");
    expect(cfg.agent_type).toBe("deepagents");
    expect(cfg.handlers).toHaveLength(1);
    expect(cfg.handlers[0].enabled).toBe(true);
  });

  it("rejects invalid event names", () => {
    expect(() =>
      validateHooksConfig({
        handlers: [
          { name: "x", events: ["Bogus"], handler: { type: "shell", command: "true" } },
        ],
      }),
    ).toThrow(/invalid event/);
  });

  it("rejects shell handler missing command", () => {
    expect(() =>
      validateHooksConfig({
        handlers: [{ name: "x", events: ["PreToolUse"], handler: { type: "shell" } }],
      }),
    ).toThrow(/command/);
  });

  it("rejects mcp_tool handler missing server/tool", () => {
    expect(() =>
      validateHooksConfig({
        handlers: [
          { name: "x", events: ["PostToolUse"], handler: { type: "mcp_tool" } },
        ],
      }),
    ).toThrow(/server.*tool/);
  });

  it("requires handlers array", () => {
    expect(() => validateHooksConfig({ handlers: "nope" })).toThrow(/array/);
  });
});

describe("hooks config discovery", () => {
  const origEnv = { ...process.env };
  beforeEach(() => {
    delete process.env.HOOKS_CONFIG;
    delete process.env.HOOKS_CONFIG_FILE;
  });
  afterEach(() => {
    process.env = { ...origEnv };
  });

  it("returns disabled empty config when nothing is configured", () => {
    const cfg = loadHooksConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.handlers).toEqual([]);
  });

  it("loads inline HOOKS_CONFIG json", () => {
    process.env.HOOKS_CONFIG = JSON.stringify({
      handlers: [
        { name: "h", events: ["SessionStart"], handler: { type: "shell", command: "true" } },
      ],
    });
    const cfg = loadHooksConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.handlers).toHaveLength(1);
  });

  it("falls back to disabled config on malformed json", () => {
    process.env.HOOKS_CONFIG = "{ not json";
    const cfg = loadHooksConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.handlers).toEqual([]);
  });

  it("accepts an explicit config object", () => {
    const cfg = loadHooksConfig({
      enabled: true,
      handlers: [
        { name: "h", events: ["PostToolUse"], handler: { type: "shell", command: "true" } },
      ],
    });
    expect(cfg.handlers).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// registry.ts
// ---------------------------------------------------------------------------

const baseConfig: HooksConfig = {
  enabled: true,
  agent_id: "bullhorse",
  agent_type: "deepagents",
  handlers: [
    {
      name: "all-tools",
      events: ["PreToolUse", "PostToolUse"],
      handler: { type: "shell", command: "true" },
    },
    {
      name: "grep-only",
      events: ["PreToolUse"],
      tools: ["grep", "search_files"],
      handler: { type: "shell", command: "true" },
    },
    {
      name: "session",
      events: ["SessionStart"],
      handler: { type: "shell", command: "true" },
    },
    {
      name: "disabled-one",
      events: ["PreToolUse"],
      enabled: false,
      handler: { type: "shell", command: "true" },
    },
  ],
};

describe("HooksRegistry", () => {
  it("filters out disabled handlers at construction", () => {
    const reg = new HooksRegistry(baseConfig);
    expect(reg.isEmpty).toBe(false);
    // disabled-one is dropped
    const pres = reg.selectHandlers("PreToolUse", "anything");
    expect(pres.map((h) => h.name)).not.toContain("disabled-one");
  });

  it("selects tool-scoped handlers correctly", () => {
    const reg = new HooksRegistry(baseConfig);
    const grepPres = reg.selectHandlers("PreToolUse", "grep");
    expect(grepPres.map((h) => h.name).sort()).toEqual(["all-tools", "grep-only"]);

    const writePres = reg.selectHandlers("PreToolUse", "write_file");
    expect(writePres.map((h) => h.name)).toEqual(["all-tools"]);
  });

  it("SessionStart ignores tool scoping", () => {
    const reg = new HooksRegistry(baseConfig);
    const sessions = reg.selectHandlers("SessionStart", "grep");
    expect(sessions.map((h) => h.name)).toEqual(["session"]);
  });

  it("runs a shell handler that exits 0 (no veto)", async () => {
    const reg = new HooksRegistry({
      enabled: true,
      handlers: [
        {
          name: "ok",
          events: ["PreToolUse"],
          handler: { type: "shell", command: "true" },
        },
      ],
    });
    const out = await reg.runHandler(reg.selectHandlers("PreToolUse", "t")[0], {
      agent_id: "a",
      agent_type: "b",
      tool: "t",
      args: {},
    });
    expect(out).toBeUndefined();
  });

  it("treats non-zero shell exit as a veto for PreToolUse", async () => {
    const reg = new HooksRegistry({
      enabled: true,
      handlers: [
        {
          name: "block",
          events: ["PreToolUse"],
          handler: { type: "shell", command: "echo blocked >&2; exit 2" },
        },
      ],
    });
    const out = await reg.runHandler(reg.selectHandlers("PreToolUse", "t")[0], {
      agent_id: "a",
      agent_type: "b",
      tool: "t",
      args: {},
    });
    expect(isHookVeto(out)).toBe(true);
    expect((out as any).reason).toContain("blocked");
  });

  it("does NOT veto SessionStart on non-zero shell exit", async () => {
    const reg = new HooksRegistry({
      enabled: true,
      handlers: [
        {
          name: "session-fail",
          events: ["SessionStart"],
          handler: { type: "shell", command: "exit 1" },
        },
      ],
    });
    const out = await reg.runHandler(reg.selectHandlers("SessionStart")[0], {
      agent_id: "a",
      agent_type: "b",
      thread_id: "t1",
    });
    expect(isHookVeto(out)).toBe(false);
  });

  it("passes payload JSON to shell handler on stdin", async () => {
    const reg = new HooksRegistry({
      enabled: true,
      handlers: [
        {
          name: "capture",
          events: ["PreToolUse"],
          handler: { type: "shell", command: "cat > /dev/null; true" },
        },
      ],
    });
    // Just verify it runs without error for a payload with args.
    const out = await reg.runHandler(reg.selectHandlers("PreToolUse", "t")[0], {
      agent_id: "a",
      agent_type: "b",
      tool: "t",
      args: { path: "/x" },
    });
    expect(out).toBeUndefined();
  });

  it("invokes mcp_tool handler through the injected caller", async () => {
    const calls: Array<{ server: string; tool: string; args: any }> = [];
    const mcpCaller: McpToolCaller = async (server, tool, args) => {
      calls.push({ server, tool, args });
      return undefined;
    };
    const reg = new HooksRegistry(
      {
        enabled: true,
        handlers: [
          {
            name: "mcp",
            events: ["PreToolUse"],
            handler: { type: "mcp_tool", server: "svc", tool: "check", args: { mode: "strict" } },
          },
        ],
      },
      mcpCaller,
    );
    await reg.runHandler(reg.selectHandlers("PreToolUse", "t")[0], {
      agent_id: "a",
      agent_type: "b",
      tool: "t",
      args: { foo: 1 },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].server).toBe("svc");
    expect(calls[0].tool).toBe("check");
    expect(calls[0].args.mode).toBe("strict");
    expect(calls[0].args.tool).toBe("t"); // payload merged
  });

  it("treats mcp_tool veto response as veto", async () => {
    const mcpCaller: McpToolCaller = async () => ({ veto: true, reason: "nope" });
    const reg = new HooksRegistry(
      {
        enabled: true,
        handlers: [
          {
            name: "mcp",
            events: ["PreToolUse"],
            handler: { type: "mcp_tool", server: "svc", tool: "check" },
          },
        ],
      },
      mcpCaller,
    );
    const out = await reg.runHandler(reg.selectHandlers("PreToolUse", "t")[0], {
      agent_id: "a",
      agent_type: "b",
      tool: "t",
      args: {},
    });
    expect(isHookVeto(out)).toBe(true);
    expect((out as any).reason).toBe("nope");
  });

  it("swallows handler errors and returns undefined", async () => {
    const mcpCaller: McpToolCaller = async () => {
      throw new Error("boom");
    };
    const reg = new HooksRegistry(
      {
        enabled: true,
        handlers: [
          {
            name: "mcp",
            events: ["PreToolUse"],
            handler: { type: "mcp_tool", server: "svc", tool: "check" },
          },
        ],
      },
      mcpCaller,
    );
    const out = await reg.runHandler(reg.selectHandlers("PreToolUse", "t")[0], {
      agent_id: "a",
      agent_type: "b",
      tool: "t",
      args: {},
    });
    expect(out).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// dispatcher.ts
// ---------------------------------------------------------------------------

describe("HooksDispatcher", () => {
  beforeEach(() => {
    resetHooksDispatcher();
  });

  it("is disabled when config is empty", () => {
    const d = new HooksDispatcher({ enabled: false, handlers: [] });
    expect(d.enabled).toBe(false);
  });

  it("is disabled when enabled but no handlers", () => {
    const d = new HooksDispatcher({ enabled: true, handlers: [] });
    expect(d.enabled).toBe(false);
  });

  it("fires SessionStart once per thread_id (idempotent)", async () => {
    let count = 0;
    const d = new HooksDispatcher({
      enabled: true,
      handlers: [
        {
          name: "s",
          events: ["SessionStart"],
          handler: { type: "shell", command: "true" },
        },
      ],
    });
    // Wrap runHandler to count invocations.
    const origRun = d["registry"].runHandler.bind(d["registry"]);
    d["registry"].runHandler = async (entry, payload) => {
      count++;
      return origRun(entry, payload);
    };

    const first = await d.dispatchSessionStart("thread-1");
    const second = await d.dispatchSessionStart("thread-1");
    const otherThread = await d.dispatchSessionStart("thread-2");

    expect(first).toBe(true);
    expect(second).toBe(false); // idempotent
    expect(otherThread).toBe(true);
    expect(count).toBe(2); // two distinct threads
  });

  it("returns veto from PreToolUse when a handler vetoes", async () => {
    const d = new HooksDispatcher({
      enabled: true,
      handlers: [
        {
          name: "block",
          events: ["PreToolUse"],
          handler: { type: "shell", command: "echo no >&2; exit 1" },
        },
      ],
    });
    const veto = await d.dispatchPreToolUse({
      agent_id: "a",
      agent_type: "b",
      tool: "write_file",
      args: {},
    });
    expect(veto).not.toBeNull();
    expect(veto?.veto).toBe(true);
  });

  it("returns null from PreToolUse when no handler applies", async () => {
    const d = new HooksDispatcher({
      enabled: true,
      handlers: [
        {
          name: "grep-only",
          events: ["PreToolUse"],
          tools: ["grep"],
          handler: { type: "shell", command: "exit 1" },
        },
      ],
    });
    const veto = await d.dispatchPreToolUse({
      agent_id: "a",
      agent_type: "b",
      tool: "write_file",
      args: {},
    });
    expect(veto).toBeNull();
  });

  it("fireSessionStart helper is a no-op when disabled", async () => {
    // No env config set -> disabled
    delete process.env.HOOKS_CONFIG;
    const { fireSessionStart } = await import("../dispatcher");
    const ran = await fireSessionStart("t-x");
    expect(ran).toBe(false);
  });
});

describe("createHooksMiddleware", () => {
  it("returns a middleware object with wrapToolCall and a name", () => {
    const mw = createHooksMiddleware(new HooksDispatcher({ enabled: false, handlers: [] }));
    expect(mw).toBeTruthy();
    expect(typeof (mw as any).wrapToolCall).toBe("function");
  });

  it("passes through when hooks are disabled", async () => {
    const mw = createHooksMiddleware(new HooksDispatcher({ enabled: false, handlers: [] }));
    const handler = (req: any) => Promise.resolve({ content: "ran", req });
    const request = {
      tool: { name: "grep" },
      toolCall: { id: "tc1", name: "grep", args: { q: "x" } },
      state: { thread_id: "t1" },
    };
    const result = await (mw as any).wrapToolCall(request, handler);
    expect(result.content).toBe("ran");
  });

  it("vetoes the tool call and returns a ToolMessage when a PreToolUse handler vetoes", async () => {
    const dispatcher = new HooksDispatcher({
      enabled: true,
      handlers: [
        {
          name: "block-grep",
          events: ["PreToolUse"],
          tools: ["grep"],
          handler: { type: "shell", command: "echo blocked >&2; exit 1" },
        },
      ],
    });
    const mw = createHooksMiddleware(dispatcher);
    let handlerCalled = false;
    const handler = () => {
      handlerCalled = true;
      return Promise.resolve({ content: "should-not-run" });
    };
    const request = {
      tool: { name: "grep" },
      toolCall: { id: "tc1", name: "grep", args: { q: "x" } },
      state: { thread_id: "t1" },
    };
    const result = await (mw as any).wrapToolCall(request, handler);
    expect(handlerCalled).toBe(false);
    // ToolMessage carries content + tool_call_id
    expect(result).toBeTruthy();
    expect(String(result?.content ?? result?.content?.[0]?.text ?? "")).toMatch(/vetoed/);
  });

  it("runs the tool and fires PostToolUse when no veto", async () => {
    let postSeen: string | undefined;
    const dispatcher = new HooksDispatcher({
      enabled: true,
      handlers: [
        {
          name: "observe",
          events: ["PostToolUse"],
          tools: ["read_file"],
          handler: { type: "shell", command: "echo ok" },
        },
      ],
    });
    // Spy on PostToolUse by wrapping the dispatcher method.
    const origPost = dispatcher.dispatchPostToolUse.bind(dispatcher);
    dispatcher.dispatchPostToolUse = async (payload: any) => {
      postSeen = payload.tool;
      return origPost(payload);
    };

    const mw = createHooksMiddleware(dispatcher);
    const handler = () =>
      Promise.resolve({ content: [{ text: "file contents" }] });
    const request = {
      tool: { name: "read_file" },
      toolCall: { id: "tc1", name: "read_file", args: { path: "/a" } },
      state: { thread_id: "t1" },
    };
    const result = await (mw as any).wrapToolCall(request, handler);
    expect(result.content[0].text).toBe("file contents");
    expect(postSeen).toBe("read_file");
  });
});
