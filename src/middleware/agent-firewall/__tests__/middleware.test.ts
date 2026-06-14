import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { ToolMessage } from "@langchain/core/messages";
import { createAgentFirewallMiddleware } from "../index";
import { loadFirewallConfig, resetFirewallConfig } from "../config";
import {
  resetThreadCallCounts,
  clearThreadCallCount,
} from "../engine";
import { FirewallViolationError } from "../types";

/**
 * Build a fresh middleware against a given env, then reset env after the test.
 * The middleware reads config lazily at construction, so we control the env
 * before each call to `createAgentFirewallMiddleware`.
 */
function withEnv(
  env: Record<string, string>,
  fn: () => Promise<void> | void,
): () => Promise<void> {
  return async () => {
    const backup: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(env)) {
      backup[k] = process.env[k];
      process.env[k] = v;
    }
    resetFirewallConfig();
    resetThreadCallCounts();
    try {
      await fn();
    } finally {
      for (const [k, v] of Object.entries(backup)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      resetFirewallConfig();
      resetThreadCallCounts();
    }
  };
}

describe("Agent Firewall middleware", () => {
  beforeEach(() => {
    resetFirewallConfig();
    resetThreadCallCounts();
  });

  afterEach(() => {
    delete process.env.FIREWALL_COMMAND_DENY;
    delete process.env.FIREWALL_COMMAND_ALLOW;
    delete process.env.FIREWALL_NETWORK_ALLOW;
    delete process.env.FIREWALL_MAX_CALLS_PER_THREAD;
    resetFirewallConfig();
    resetThreadCallCounts();
  });

  it(
    "passes through when no firewall env vars are configured",
    withEnv({}, async () => {
      const mw = createAgentFirewallMiddleware();
      const handler = mock(async (req: any) => ({ ok: true, req }));
      const request = {
        toolCall: { id: "1", name: "shell", args: { command: "rm -rf /" } },
        runtime: { configurable: { thread_id: "t1" } },
      };
      const result = await mw.wrapToolCall!(request as any, handler as any) as any;
      expect(handler).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ ok: true, req: request });
    }),
  );

  it(
    "blocks a denied shell command and returns a ToolMessage (never executes)",
    withEnv({ FIREWALL_COMMAND_DENY: "\\brm\\s+-rf\\b" }, async () => {
      const mw = createAgentFirewallMiddleware();
      const handler = mock(async (req: any) => ({
        shouldNotReach: true,
        req,
      }));
      const request = {
        toolCall: {
          id: "call-1",
          name: "shell",
          args: { command: "rm -rf /tmp" },
        },
        runtime: { configurable: { thread_id: "t1" } },
      };
      const result = (await mw.wrapToolCall!(
        request as any,
        handler as any,
      )) as ToolMessage;

      // The tool must NOT have executed.
      expect(handler).not.toHaveBeenCalled();
      // A ToolMessage reporting the block is returned to the agent.
      expect(result).toBeInstanceOf(ToolMessage);
      expect(result.name).toBe("shell");
      const content = String(result.content);
      expect(content).toContain("BLOCKED");
      expect(content).toContain("rm");
    }),
  );

  it(
    "allows a command that does not trip the denylist",
    withEnv({ FIREWALL_COMMAND_DENY: "\\brm\\s+-rf\\b" }, async () => {
      const mw = createAgentFirewallMiddleware();
      const handler = mock(async (req: any) => ({ ran: true, req }));
      const request = {
        toolCall: {
          id: "call-2",
          name: "shell",
          args: { command: "git status" },
        },
        runtime: { configurable: { thread_id: "t1" } },
      };
      await mw.wrapToolCall!(request as any, handler as any);
      expect(handler).toHaveBeenCalledTimes(1);
    }),
  );

  it(
    "blocks a non-allowlisted network host",
    withEnv({ FIREWALL_NETWORK_ALLOW: "github.com" }, async () => {
      const mw = createAgentFirewallMiddleware();
      const handler = mock(async (req: any) => ({ ran: true, req }));
      const request = {
        toolCall: {
          id: "call-3",
          name: "fetch_url",
          args: { url: "https://evil.example.com/exfil" },
        },
        runtime: { configurable: { thread_id: "t1" } },
      };
      const result = (await mw.wrapToolCall!(
        request as any,
        handler as any,
      )) as ToolMessage;
      expect(handler).not.toHaveBeenCalled();
      expect(result).toBeInstanceOf(ToolMessage);
      expect(String(result.content)).toContain("evil.example.com");
    }),
  );

  it(
    "allows an allowlisted network host",
    withEnv(
      { FIREWALL_NETWORK_ALLOW: "github.com, *.langfuse.com" },
      async () => {
        const mw = createAgentFirewallMiddleware();
        const handler = mock(async (req: any) => ({ ran: true, req }));
        const request = {
          toolCall: {
            id: "call-4",
            name: "fetch_url",
            args: { url: "https://cloud.langfuse.com/api" },
          },
          runtime: { configurable: { thread_id: "t1" } },
        };
        await mw.wrapToolCall!(request as any, handler as any);
        expect(handler).toHaveBeenCalledTimes(1);
      },
    ),
  );

  it(
    "aborts the turn with FirewallViolationError when the call ceiling is breached",
    withEnv({ FIREWALL_MAX_CALLS_PER_THREAD: "2" }, async () => {
      const mw = createAgentFirewallMiddleware();
      const handler = mock(async (req: any) => ({ ran: true, req }));

      // First two calls succeed.
      for (let i = 0; i < 2; i++) {
        const request = {
          toolCall: {
            id: `call-${i}`,
            name: "shell",
            args: { command: "echo hi" },
          },
          runtime: { configurable: { thread_id: "t1" } },
        };
        await mw.wrapToolCall!(request as any, handler as any);
      }
      expect(handler).toHaveBeenCalledTimes(2);

      // Third call trips the kill-switch (count was 2 after the two calls).
      const request = {
        toolCall: {
          id: "call-3",
          name: "shell",
          args: { command: "echo again" },
        },
        runtime: { configurable: { thread_id: "t1" } },
      };
      await expect(
        mw.wrapToolCall!(request as any, handler as any),
      ).rejects.toBeInstanceOf(FirewallViolationError);

      // The tool must NOT have executed on the blocked turn.
      expect(handler).toHaveBeenCalledTimes(2);
    }),
  );

  it(
    "returns a blocked ToolMessage when denylist AND allowlist both apply (deny wins)",
    withEnv(
      {
        FIREWALL_COMMAND_ALLOW: "^git\\b",
        FIREWALL_COMMAND_DENY: "\\brm\\b",
      },
      async () => {
        const mw = createAgentFirewallMiddleware();
        const handler = mock(async (req: any) => ({ ran: true, req }));
        // rm is not on the allowlist AND is on the denylist.
        const request = {
          toolCall: {
            id: "call-5",
            name: "shell",
            args: { command: "rm something" },
          },
          runtime: { configurable: { thread_id: "t1" } },
        };
        const result = (await mw.wrapToolCall!(
          request as any,
          handler as any,
        )) as ToolMessage;
        expect(handler).not.toHaveBeenCalled();
        expect(result).toBeInstanceOf(ToolMessage);
      },
    ),
  );

  it("counts each permitted call toward the per-thread ceiling", async () => {
    process.env.FIREWALL_MAX_CALLS_PER_THREAD = "3";
    resetFirewallConfig();
    const mw = createAgentFirewallMiddleware();
    const handler = mock(async (req: any) => ({ ran: true, req }));
    for (let i = 0; i < 3; i++) {
      const request = {
        toolCall: {
          id: `c${i}`,
          name: "shell",
          args: { command: "echo hi" },
        },
        runtime: { configurable: { thread_id: "counter" } },
      };
      await mw.wrapToolCall!(request as any, handler as any);
    }
    // 4th call should breach (3 calls already recorded).
    const request = {
      toolCall: {
        id: "c4",
        name: "shell",
        args: { command: "echo again" },
      },
      runtime: { configurable: { thread_id: "counter" } },
    };
    await expect(
      mw.wrapToolCall!(request as any, handler as any),
    ).rejects.toBeInstanceOf(FirewallViolationError);
    clearThreadCallCount("counter");
  });

  it("config is loaded once and shared (memoized)", () => {
    const a = loadFirewallConfig();
    const b = loadFirewallConfig();
    expect(b).toBe(a);
  });
});
