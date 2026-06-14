import { describe, it, expect, beforeEach } from "bun:test";
import {
  checkCommand,
  checkNetwork,
  clearThreadCallCount,
  enforceBudget,
  getThreadCallCount,
  hostGlobToRegExp,
  incrementThreadCallCount,
  inspectToolCall,
  isCommandTool,
  isNetworkTool,
  resetThreadCallCounts,
} from "../engine";
import type { FirewallConfig } from "../types";
import { FirewallViolationError } from "../types";

function makeConfig(overrides: Partial<FirewallConfig> = {}): FirewallConfig {
  return {
    commandDeny: [],
    commandAllow: [],
    networkAllow: [],
    maxCallsPerThread: 0,
    enabled: true,
    ...overrides,
  };
}

describe("Agent Firewall engine", () => {
  beforeEach(() => {
    resetThreadCallCounts();
  });

  // --------------------------------------------------------------------------
  // Tool classification
  // --------------------------------------------------------------------------

  describe("isCommandTool", () => {
    it("classifies tools whose name hints at a shell", () => {
      expect(isCommandTool("sandbox_shell", {})).toBe(true);
      expect(isCommandTool("run_command", {})).toBe(true);
      expect(isCommandTool("bash", {})).toBe(true);
    });

    it("classifies tools whose args carry a command key", () => {
      expect(isCommandTool("custom_tool", { command: "ls" })).toBe(true);
      expect(isCommandTool("custom_tool", { cmd: "ls" })).toBe(true);
      expect(isCommandTool("custom_tool", { query: "ls" })).toBe(false);
    });
  });

  describe("isNetworkTool", () => {
    it("classifies tools whose name hints at networking", () => {
      expect(isNetworkTool("fetch_url", {})).toBe(true);
      expect(isNetworkTool("http_request", {})).toBe(true);
    });

    it("classifies tools whose args carry a url key", () => {
      expect(isNetworkTool("custom_tool", { url: "https://x" })).toBe(true);
      expect(isNetworkTool("custom_tool", { endpoint: "https://x" })).toBe(true);
      expect(isNetworkTool("custom_tool", { query: "x" })).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Command denylist / allowlist
  // --------------------------------------------------------------------------

  describe("checkCommand", () => {
    it("blocks commands matching the denylist", () => {
      const config = makeConfig({
        commandDeny: [/\brm\s+-rf\b/],
      });
      const result = checkCommand("rm -rf /tmp", config);
      expect(result.block).toBe(true);
      expect(result.rule).toBe("command_denied");
      expect(result.reason).toContain("rm -rf");
    });

    it("allows commands that do not match the denylist", () => {
      const config = makeConfig({
        commandDeny: [/\brm\s+-rf\b/],
      });
      expect(checkCommand("ls -la", config).block).toBe(false);
    });

    it("denylist wins over the allowlist", () => {
      const config = makeConfig({
        commandDeny: [/\brm\b/],
        commandAllow: [/^rm/],
      });
      const result = checkCommand("rm -rf /", config);
      expect(result.block).toBe(true);
      expect(result.rule).toBe("command_denied");
    });

    it("blocks commands missing from the allowlist when one is set", () => {
      const config = makeConfig({
        commandAllow: [/^git\b/, /^ls\b/],
      });
      expect(checkCommand("rm file", config).block).toBe(true);
      expect(checkCommand("git status", config).block).toBe(false);
    });

    it("allows everything when neither list is set", () => {
      const config = makeConfig();
      expect(checkCommand("anything goes", config).block).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Network allowlist
  // --------------------------------------------------------------------------

  describe("hostGlobToRegExp", () => {
    it("matches literal hosts exactly (case-insensitive)", () => {
      const re = hostGlobToRegExp("github.com");
      expect(re.test("github.com")).toBe(true);
      expect(re.test("GITHUB.COM")).toBe(true);
      expect(re.test("evil-github.com")).toBe(false);
    });

    it("expands '*' into a wildcard segment match", () => {
      const re = hostGlobToRegExp("*.langfuse.com");
      expect(re.test("cloud.langfuse.com")).toBe(true);
      expect(re.test("a.b.langfuse.com")).toBe(true);
      expect(re.test("langfuse.com")).toBe(false);
    });

    it("escapes regex metacharacters other than '*'", () => {
      const re = hostGlobToRegExp("api.v1.com");
      expect(re.test("api.v1.com")).toBe(true);
      expect(re.test("apiXv1.com")).toBe(false);
    });
  });

  describe("checkNetwork", () => {
    it("blocks hosts not on the allowlist", () => {
      const config = makeConfig({
        networkAllow: ["github.com", "*.langfuse.com"],
      });
      const result = checkNetwork(["https://evil.example.com/steal"], config);
      expect(result.block).toBe(true);
      expect(result.rule).toBe("network_denied");
      expect(result.reason).toContain("evil.example.com");
    });

    it("allows hosts matching a literal glob", () => {
      const config = makeConfig({
        networkAllow: ["github.com"],
      });
      expect(checkNetwork(["https://github.com/api"], config).block).toBe(false);
    });

    it("allows hosts matching a wildcard glob", () => {
      const config = makeConfig({
        networkAllow: ["*.langfuse.com"],
      });
      expect(
        checkNetwork(["https://cloud.langfuse.com/api"], config).block,
      ).toBe(false);
    });

    it("is permissive when no allowlist is set", () => {
      const config = makeConfig();
      expect(
        checkNetwork(["https://anything.example.com"], config).block,
      ).toBe(false);
    });

    it("ignores non-URL values", () => {
      const config = makeConfig({ networkAllow: ["github.com"] });
      expect(checkNetwork(["not a url"], config).block).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // inspectToolCall (integration of the layers)
  // --------------------------------------------------------------------------

  describe("inspectToolCall", () => {
    it("is a no-op when the firewall is disabled", () => {
      const config: FirewallConfig = {
        commandDeny: [/\brm\b/],
        commandAllow: [],
        networkAllow: [],
        maxCallsPerThread: 0,
        enabled: false,
      };
      expect(
        inspectToolCall("shell", { command: "rm -rf /" }, config).block,
      ).toBe(false);
    });

    it("denies a shell command via tool args", () => {
      const config = makeConfig({ commandDeny: [/\brm\s+-rf\b/] });
      const result = inspectToolCall("shell", { command: "rm -rf /" }, config);
      expect(result.block).toBe(true);
      expect(result.rule).toBe("command_denied");
    });

    it("denies a non-allowlisted fetch target", () => {
      const config = makeConfig({ networkAllow: ["github.com"] });
      const result = inspectToolCall(
        "fetch_url",
        { url: "https://evil.example.com" },
        config,
      );
      expect(result.block).toBe(true);
      expect(result.rule).toBe("network_denied");
    });

    it("allows a benign command + allowlisted host together", () => {
      const config = makeConfig({
        commandDeny: [/\brm\b/],
        networkAllow: ["github.com"],
      });
      const result = inspectToolCall(
        "shell",
        { command: "git status", url: "https://github.com/api" },
        config,
      );
      expect(result.block).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Per-thread call counter
  // --------------------------------------------------------------------------

  describe("per-thread call counter", () => {
    it("starts at zero for an unknown thread", () => {
      expect(getThreadCallCount("t1")).toBe(0);
    });

    it("increments and returns the new count", () => {
      expect(incrementThreadCallCount("t1")).toBe(1);
      expect(incrementThreadCallCount("t1")).toBe(2);
      expect(getThreadCallCount("t1")).toBe(2);
    });

    it("tracks threads independently", () => {
      incrementThreadCallCount("t1");
      incrementThreadCallCount("t2");
      incrementThreadCallCount("t2");
      expect(getThreadCallCount("t1")).toBe(1);
      expect(getThreadCallCount("t2")).toBe(2);
    });

    it("clearThreadCallCount removes a single thread", () => {
      incrementThreadCallCount("t1");
      clearThreadCallCount("t1");
      expect(getThreadCallCount("t1")).toBe(0);
    });

    it("resetThreadCallCounts clears every thread", () => {
      incrementThreadCallCount("t1");
      incrementThreadCallCount("t2");
      resetThreadCallCounts();
      expect(getThreadCallCount("t1")).toBe(0);
      expect(getThreadCallCount("t2")).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Hard kill-switch (enforceBudget)
  // --------------------------------------------------------------------------

  describe("enforceBudget", () => {
    it("does nothing when maxCallsPerThread is disabled", () => {
      const config = makeConfig({ maxCallsPerThread: 0 });
      incrementThreadCallCount("t1");
      expect(() => enforceBudget("t1", config)).not.toThrow();
    });

    it("raises FirewallViolationError when the call ceiling is reached", () => {
      const config = makeConfig({ maxCallsPerThread: 3 });
      incrementThreadCallCount("t1");
      incrementThreadCallCount("t1");
      incrementThreadCallCount("t1");
      // count is now 3, which is >= limit 3 -> breach.
      expect(() => enforceBudget("t1", config)).toThrow(FirewallViolationError);
    });

    it("does not breach when the count is below the ceiling", () => {
      const config = makeConfig({ maxCallsPerThread: 3 });
      incrementThreadCallCount("t1");
      incrementThreadCallCount("t1");
      expect(() => enforceBudget("t1", config)).not.toThrow();
    });

    it("the raised error carries reason=budget_exceeded and the thread id", () => {
      const config = makeConfig({ maxCallsPerThread: 1 });
      incrementThreadCallCount("t1");
      try {
        enforceBudget("t1", config);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(FirewallViolationError);
        const e = err as FirewallViolationError;
        expect(e.reason).toBe("budget_exceeded");
        expect(e.threadId).toBe("t1");
        expect(e.message).toContain("call budget");
      }
    });
  });
});
