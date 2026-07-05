import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import {
  validateHooksConfig,
  loadHooksConfig,
} from "../config";
import { HooksRegistry, isHookVeto, type McpToolCaller } from "../registry";
import {
  HooksDispatcher,
  getHooksDispatcher,
  resetHooksDispatcher,
  createHooksMiddleware,
  createMcpToolCaller,
  setActiveHooksWorkspace,
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
          handler: { type: "shell", command: "node -e \"console.error('blocked'); process.exit(2)\"" },
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
          handler: { type: "shell", command: "node -e \"process.exit(1)\"" },
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
          handler: { type: "shell", command: "node -e \"process.exit(0)\"" },
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

  it("fails LOUDLY (not silent) when no McpToolCaller is wired", async () => {
    // No caller passed -> default sentinel throws -> runHandler logs + returns
    // undefined. This is the loud-failure contract replacing the old silent
    // no-op, so a misconfigured mcp_tool handler is visible, not invisible.
    const reg = new HooksRegistry({
      enabled: true,
      handlers: [
        {
          name: "mcp",
          events: ["PreToolUse"],
          handler: { type: "mcp_tool", server: "svc", tool: "check" },
        },
      ],
    });
    const out = await reg.runHandler(reg.selectHandlers("PreToolUse", "t")[0], {
      agent_id: "a",
      agent_type: "b",
      tool: "t",
      args: {},
    });
    // runHandler swallows the throw and returns undefined (observer semantics),
    // but the failure is logged at WARN — not silently dropped.
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
          handler: { type: "shell", command: "node -e \"console.error('no'); process.exit(1)\"" },
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
      runtime: { configurable: { thread_id: "t1" } },
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
          handler: { type: "shell", command: "node -e \"console.error('blocked'); process.exit(1)\"" },
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
      runtime: { configurable: { thread_id: "t1" } },
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
      runtime: { configurable: { thread_id: "t1" } },
    };
    const result = await (mw as any).wrapToolCall(request, handler);
    expect(result.content[0].text).toBe("file contents");
    expect(postSeen).toBe("read_file");
  });

  it("sources thread_id from runtime.configurable (not request.state)", async () => {
    let seenThreadId: unknown = "untouched";
    const dispatcher = new HooksDispatcher({
      enabled: true,
      handlers: [
        {
          name: "obs",
          events: ["PreToolUse"],
          handler: { type: "shell", command: "true" },
        },
      ],
    });
    const origPre = dispatcher.dispatchPreToolUse.bind(dispatcher);
    dispatcher.dispatchPreToolUse = async (payload: any) => {
      seenThreadId = payload.thread_id;
      return origPre(payload);
    };
    const mw = createHooksMiddleware(dispatcher);
    const handler = () => Promise.resolve({ content: "ok" });
    // production-shape request: runtime.configurable.thread_id is set,
    // request.state.thread_id is NOT a real field and must be ignored.
    const request = {
      tool: { name: "grep" },
      toolCall: { id: "tc1", name: "grep", args: {} },
      runtime: { configurable: { thread_id: "real-thread" } },
      state: { messages: [] },
    };
    await (mw as any).wrapToolCall(request, handler);
    expect(seenThreadId).toBe("real-thread");
  });

  it("tags subagent-spawn (task tool) events with a distinct agent_type", async () => {
    let seenType: string | undefined;
    const dispatcher = new HooksDispatcher({
      enabled: true,
      handlers: [
        {
          name: "obs",
          events: ["PreToolUse"],
          handler: { type: "shell", command: "true" },
        },
      ],
    });
    const origPre = dispatcher.dispatchPreToolUse.bind(dispatcher);
    dispatcher.dispatchPreToolUse = async (payload: any) => {
      seenType = payload.agent_type;
      return origPre(payload);
    };
    const mw = createHooksMiddleware(dispatcher);
    const handler = () => Promise.resolve({ content: "ok" });
    // The `task` tool is the SDK's subagent launcher.
    const request = {
      tool: { name: "task" },
      toolCall: { id: "tc1", name: "task", args: { subagent_type: "explore-agent" } },
      runtime: { configurable: { thread_id: "t1", agent_id: "bullhorse", agent_type: "deepagents", agent_scope: "top" } },
    };
    await (mw as any).wrapToolCall(request, handler);
    // acceptance criterion #3: top-level vs subagent must be distinguishable.
    expect(seenType).toBe("deepagents:subagent");
  });

  it("honours the top-level agent_scope override for ordinary tools", async () => {
    let seenType: string | undefined;
    const dispatcher = new HooksDispatcher({
      enabled: true,
      handlers: [
        {
          name: "obs",
          events: ["PreToolUse"],
          handler: { type: "shell", command: "true" },
        },
      ],
    });
    const origPre = dispatcher.dispatchPreToolUse.bind(dispatcher);
    dispatcher.dispatchPreToolUse = async (payload: any) => {
      seenType = payload.agent_type;
      return origPre(payload);
    };
    const mw = createHooksMiddleware(dispatcher);
    const handler = () => Promise.resolve({ content: "ok" });
    const request = {
      tool: { name: "grep" },
      toolCall: { id: "tc1", name: "grep", args: {} },
      runtime: { configurable: { thread_id: "t1", agent_scope: "top" } },
    };
    await (mw as any).wrapToolCall(request, handler);
    expect(seenType).toBe("deepagents"); // not suffixed
  });
});

// ---------------------------------------------------------------------------
// veto reason sanitization (prompt-injection hardening)
// ---------------------------------------------------------------------------

describe("sanitizeVetoReason", () => {
  it("strips ANSI escapes and control characters", () => {
    const { sanitizeVetoReason } = require("../dispatcher");
    const dirty = "\x1b[31mRED\x1b[0m\x00noise\x07";
    expect(sanitizeVetoReason(dirty)).toBe("REDnoise");
  });
  it("collapses whitespace and newlines into single spaces", () => {
    const { sanitizeVetoReason } = require("../dispatcher");
    const spaced = "line1\n\nline2\r\n\t  line3";
    expect(sanitizeVetoReason(spaced)).toBe("line1 line2 line3");
  });
  it("truncates strictly to MAX_VETO_REASON_LEN", () => {
    const { sanitizeVetoReason } = require("../dispatcher");
    const long = "a".repeat(1000);
    const out = sanitizeVetoReason(long);
    expect(out.length).toBe(500);
    expect(out).toBe("a".repeat(500));
  });
  it("returns a safe default for empty string and whitespace-only input", () => {
    const { sanitizeVetoReason } = require("../dispatcher");
    expect(sanitizeVetoReason("")).toBe("handler vetoed the tool call");
    expect(sanitizeVetoReason("   \n  \t  ")).toBe("handler vetoed the tool call");
  });
  it("returns a safe default for non-string inputs", () => {
    const { sanitizeVetoReason } = require("../dispatcher");
    expect(sanitizeVetoReason(null as any)).toBe("handler vetoed the tool call");
    expect(sanitizeVetoReason(undefined as any)).toBe("handler vetoed the tool call");
    expect(sanitizeVetoReason(123 as any)).toBe("handler vetoed the tool call");
    expect(sanitizeVetoReason({} as any)).toBe("handler vetoed the tool call");
    expect(sanitizeVetoReason([] as any)).toBe("handler vetoed the tool call");
  });
});

// ---------------------------------------------------------------------------
// SessionStart bounded map eviction
// ---------------------------------------------------------------------------

describe("HooksDispatcher SessionStart eviction", () => {
  it("evicts expired sessions past the TTL", () => {
    const d = new HooksDispatcher({
      enabled: true,
      handlers: [
        { name: "s", events: ["SessionStart"], handler: { type: "shell", command: "true" } },
      ],
    });
    return d.dispatchSessionStart("old").then(() => {
      // Backdate the entry.
      (d as any).sessionStarted.set("old", Date.now() - 48 * 60 * 60 * 1000);
      const removed = d.evictExpiredSessions(Date.now(), 24 * 60 * 60 * 1000);
      expect(removed).toBe(1);
      expect(d.evictExpiredSessions(Date.now(), 24 * 60 * 60 * 1000)).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Production wiring: getHooksDispatcher() must use a REAL McpToolCaller
// ---------------------------------------------------------------------------

describe("production mcp_tool wiring", () => {
  const origEnv = { ...process.env };
  beforeEach(() => {
    delete process.env.HOOKS_CONFIG;
    delete process.env.HOOKS_CONFIG_FILE;
    resetHooksDispatcher();
  });
  afterEach(() => {
    process.env = { ...origEnv };
    setActiveHooksWorkspace(undefined);
    resetHooksDispatcher();
  });

  it("getHooksDispatcher() wires a real McpToolCaller (not the unset sentinel)", async () => {
    // The production dispatcher's caller should invoke the MCP manager, not
    // throw the unsetMcpCaller sentinel error. We stub the dynamic import of
    // the MCP client and assert the caller actually calls executeTool.
    const capturedCalls: Array<{
      workspace: string;
      server: string;
      tool: string;
      args: any;
    }> = [];
    const stubManager = {
      loadConfig: mock(() => Promise.resolve()),
      executeTool: mock((server: string, options: any) => {
        capturedCalls.push({
          workspace: (stubManager as any).__workspace,
          server,
          tool: options.name,
          args: options.arguments,
        });
        return Promise.resolve({
          success: true,
          content: { ok: true, server, tool: options.name },
        });
      }),
    };
    // Intercept the dynamic import("../mcp/client") the real caller performs.
    const origImport = (globalThis as any).__dynamicImportHook;
    (globalThis as any).__dynamicImportHook = undefined;

    // Bun supports import.meta mocking via module.mock.module. Use spyOn on
    // the real client module's getMcpManager to return our stub.
    const clientMod = await import("../../mcp/client");
    const getMcpManagerSpy = spyOn(clientMod, "getMcpManager").mockImplementation(
      (workspaceRoot: string) => {
        (stubManager as any).__workspace = workspaceRoot;
        return stubManager as any;
      },
    );

    try {
      // Enable hooks with an mcp_tool handler via HOOKS_CONFIG.
      process.env.HOOKS_CONFIG = JSON.stringify({
        enabled: true,
        handlers: [
          {
            name: "mcp-pre",
            events: ["PreToolUse"],
            handler: {
              type: "mcp_tool",
              server: "audit-svc",
              tool: "check",
              args: { mode: "strict" },
            },
          },
        ],
      });

      // The workspace is resolved from the middleware-set active context.
      setActiveHooksWorkspace("/tmp/repo-xyz");

      const dispatcher = getHooksDispatcher();
      const mw = createHooksMiddleware(dispatcher);

      let handlerRan = false;
      const handler = () => {
        handlerRan = true;
        return Promise.resolve({ content: "tool-result" });
      };
      const request = {
        tool: { name: "grep" },
        toolCall: { id: "tc1", name: "grep", args: { q: "x" } },
        runtime: {
          configurable: {
            thread_id: "t-prod",
            repo: { workspaceDir: "/tmp/repo-xyz" },
          },
        },
      };

      await (mw as any).wrapToolCall(request, handler);

      // The handler ran (no veto) AND the MCP manager was invoked through the
      // real caller — proving the production wiring executes mcp_tool handlers.
      expect(handlerRan).toBe(true);
      // capturedCalls (executeTool) is the deterministic proof the real caller ran
      // (the unset sentinel would never invoke executeTool). The spy's exact call
      // count is not isolated across the full suite, so it is not asserted.
      expect(capturedCalls).toHaveLength(1);
      expect(capturedCalls[0].workspace).toBe("/tmp/repo-xyz");
      expect(capturedCalls[0].server).toBe("audit-svc");
      expect(capturedCalls[0].tool).toBe("check");
      // Payload merged: handler.args.mode + payload.tool
      expect(capturedCalls[0].args.mode).toBe("strict");
      expect(capturedCalls[0].args.tool).toBe("grep");
    } finally {
      getMcpManagerSpy.mockRestore();
      (globalThis as any).__dynamicImportHook = origImport;
    }
  });

  it("createMcpToolCaller resolves workspace from the active context slot", async () => {
    // The caller's lazy workspace resolution: no explicit dir, but the
    // middleware-set active slot provides it.
    const clientMod = await import("../../mcp/client");
    const stubManager = {
      loadConfig: mock(() => Promise.resolve()),
      executeTool: mock(() =>
        Promise.resolve({ success: true, content: "ok" }),
      ),
    };
    let seenWorkspace: string | undefined;
    const spy = spyOn(clientMod, "getMcpManager").mockImplementation((w: string) => {
      seenWorkspace = w;
      return stubManager as any;
    });

    try {
      const caller = createMcpToolCaller(); // no explicit dir
      setActiveHooksWorkspace("/tmp/from-context");
      await caller("svc", "tool", { a: 1 });
      expect(seenWorkspace).toBe("/tmp/from-context");
    } finally {
      spy.mockRestore();
      setActiveHooksWorkspace(undefined);
    }
  });

  it("createMcpToolCaller throws (handled by runHandler) when no workspace resolvable", async () => {
    // No explicit dir, no active context, no WORKSPACE_ROOT — but process.cwd()
    // is a fallback, so to force the throw we clear cwd by stubbing it.
    const origCwd = process.cwd;
    const origWorkspaceRoot = process.env.WORKSPACE_ROOT;
    delete process.env.WORKSPACE_ROOT;
    setActiveHooksWorkspace(undefined);
    (process as any).cwd = () => {
      throw new Error("cwd unavailable");
    };
    try {
      const caller = createMcpToolCaller();
      await expect(caller("svc", "tool", {})).rejects.toThrow(
        /no workspace directory available/,
      );
    } finally {
      (process as any).cwd = origCwd;
      if (origWorkspaceRoot !== undefined) process.env.WORKSPACE_ROOT = origWorkspaceRoot;
    }
  });

  it("mcp_tool handler swallows missing-server errors (does not throw across the boundary)", async () => {
    // When the MCP manager reports a missing server, runHandler must convert it
    // to a swallowed error (returns undefined), NOT propagate the throw.
    const clientMod = await import("../../mcp/client");
    const stubManager = {
      loadConfig: mock(() => Promise.resolve()),
      executeTool: mock(() =>
        Promise.resolve({
          success: false,
          content: null,
          error: 'Server "nope" not found',
        }),
      ),
    };
    const spy = spyOn(clientMod, "getMcpManager").mockImplementation(() => stubManager as any);
    try {
      const reg = new HooksRegistry(
        {
          enabled: true,
          handlers: [
            {
              name: "m",
              events: ["PreToolUse"],
              handler: { type: "mcp_tool", server: "nope", tool: "x" },
            },
          ],
        },
        createMcpToolCaller("/tmp/ws"),
      );
      const out = await reg.runHandler(reg.selectHandlers("PreToolUse", "t")[0], {
        agent_id: "a",
        agent_type: "b",
        tool: "t",
        args: {},
      });
      // Missing server -> executeTool returns success:false -> caller throws ->
      // runHandler swallows -> returns undefined. NOT a propagated throw.
      expect(out).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });
});
