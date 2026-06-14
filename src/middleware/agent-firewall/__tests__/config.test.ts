import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  loadFirewallConfig,
  resetFirewallConfig,
} from "../config";

describe("Agent Firewall config loader", () => {
  beforeEach(() => {
    resetFirewallConfig();
  });

  afterEach(() => {
    // Clean up any env vars the tests set so they don't leak across suites.
    delete process.env.FIREWALL_COMMAND_DENY;
    delete process.env.FIREWALL_COMMAND_ALLOW;
    delete process.env.FIREWALL_NETWORK_ALLOW;
    delete process.env.FIREWALL_MAX_CALLS_PER_THREAD;
    resetFirewallConfig();
  });

  it("is permissive (disabled) when no env vars are set", () => {
    const config = loadFirewallConfig();
    expect(config.enabled).toBe(false);
    expect(config.commandDeny).toEqual([]);
    expect(config.commandAllow).toEqual([]);
    expect(config.networkAllow).toEqual([]);
    expect(config.maxCallsPerThread).toBe(0);
  });

  it("parses a comma-separated FIREWALL_COMMAND_DENY into compiled regexes", () => {
    process.env.FIREWALL_COMMAND_DENY = "\\brm\\b,\\bsudo\\b";
    const config = loadFirewallConfig();
    expect(config.enabled).toBe(true);
    expect(config.commandDeny).toHaveLength(2);
    expect(config.commandDeny[0].test("rm -rf /")).toBe(true);
    expect(config.commandDeny[1].test("sudo apt install")).toBe(true);
  });

  it("skips invalid regex patterns without crashing", () => {
    process.env.FIREWALL_COMMAND_DENY = "valid_pattern, ([unclosed, also_valid";
    const config = loadFirewallConfig();
    // Two invalid patterns dropped, two valid ones kept.
    expect(config.commandDeny).toHaveLength(2);
  });

  it("parses FIREWALL_NETWORK_ALLOW host globs (preserving wildcards)", () => {
    process.env.FIREWALL_NETWORK_ALLOW = "github.com, *.cloud.langfuse.com";
    const config = loadFirewallConfig();
    expect(config.networkAllow).toEqual(["github.com", "*.cloud.langfuse.com"]);
  });

  it("reads FIREWALL_MAX_CALLS_PER_THREAD as an integer", () => {
    process.env.FIREWALL_MAX_CALLS_PER_THREAD = "25";
    const config = loadFirewallConfig();
    expect(config.maxCallsPerThread).toBe(25);
    expect(config.enabled).toBe(true);
  });

  it("memoizes the config (same object reference on repeat calls)", () => {
    const first = loadFirewallConfig();
    const second = loadFirewallConfig();
    expect(second).toBe(first);
  });

  it("resetFirewallConfig forces a re-read after env mutation", () => {
    const before = loadFirewallConfig();
    expect(before.enabled).toBe(false);

    process.env.FIREWALL_COMMAND_DENY = "danger";
    resetFirewallConfig();
    const after = loadFirewallConfig();
    expect(after.enabled).toBe(true);
    expect(after.commandDeny).toHaveLength(1);
  });
});
