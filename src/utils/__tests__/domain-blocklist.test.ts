import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  checkDomainBlocklist,
  checkUrlBlocklist,
  addToBlocklist,
  removeFromBlocklist,
  addToAllowlist,
  clearDomainCheckCache,
  getBlocklistStats,
} from "../domain-blocklist";

describe("domain-blocklist", () => {
  // To avoid polluting the global allowlist state for other test files,
  // we save the original getBlocklistStats value and we will not mutate
  // allowlist in ways that break other suites (since there's no removeFromAllowlist).
  // In a real scenario, we would mock the module or add a test-only reset function.
  // We'll isolate our testing logic.

  beforeEach(() => {
    clearDomainCheckCache();
  });

  afterEach(() => {
    clearDomainCheckCache();
    delete process.env.SKIP_DOMAIN_BLOCKLIST_CHECK;
  });

  describe("checkDomainBlocklist", () => {
    it("allows standard domains by default", async () => {
      const result = await checkDomainBlocklist("example.com");
      expect(result.status).toBe("allowed");
    });

    it("blocks domains added to the local blocklist", async () => {
      addToBlocklist("bad-domain.com");

      const result = await checkDomainBlocklist("bad-domain.com");
      expect(result.status).toBe("blocked");
      if (result.status === "blocked") {
        expect(result.reason).toBe("Domain is in local blocklist");
      }

      removeFromBlocklist("bad-domain.com");
    });

    it("blocks subdomains of blocked domains", async () => {
      addToBlocklist("evil.com");

      const result = await checkDomainBlocklist("sub.evil.com");
      expect(result.status).toBe("blocked");
      if (result.status === "blocked") {
        expect(result.reason).toContain("Subdomain of blocked domain");
      }

      removeFromBlocklist("evil.com");
    });

    it("ignores case when checking blocklist", async () => {
      addToBlocklist("MIXED-case.COM");

      const result = await checkDomainBlocklist("mixed-CASE.com");
      expect(result.status).toBe("blocked");

      removeFromBlocklist("MIXED-case.COM");
    });

    it("skips external check and allows by default if not locally blocked", async () => {
      process.env.SKIP_DOMAIN_BLOCKLIST_CHECK = "true";
      const result = await checkDomainBlocklist("unblocked-external.com");
      expect(result.status).toBe("allowed");
    });

    it("caches allowed results", async () => {
      const result1 = await checkDomainBlocklist("cached-domain.com");
      expect(result1.status).toBe("allowed");

      const stats = getBlocklistStats();
      expect(stats.cacheSize).toBeGreaterThan(0);

      const result2 = await checkDomainBlocklist("cached-domain.com");
      expect(result2.status).toBe("allowed");
    });
  });

  describe("checkUrlBlocklist", () => {
    it("extracts hostname and checks it", async () => {
      const result = await checkUrlBlocklist(
        "https://example.com/path?query=1",
      );
      expect(result.status).toBe("allowed");
    });

    it("returns check_failed for invalid URLs", async () => {
      const result = await checkUrlBlocklist("not-a-valid-url");
      expect(result.status).toBe("check_failed");
    });
  });

  describe("getBlocklistStats", () => {
    it("returns size statistics", () => {
      const stats = getBlocklistStats();
      expect(typeof stats.cacheSize).toBe("number");
      expect(typeof stats.blocklistSize).toBe("number");
      expect(typeof stats.allowlistSize).toBe("number");
    });
  });

  // Adding to allowlist is irreversible via the public API of the module.
  // We place this test at the very end of the file.
  describe("allowlist enforcement", () => {
    it("enforces allowlist if domains are added to it", async () => {
      addToAllowlist("allowed-by-whitelist.com");

      const resultAllowed = await checkDomainBlocklist(
        "allowed-by-whitelist.com",
      );
      expect(resultAllowed.status).toBe("allowed");

      const resultBlocked = await checkDomainBlocklist("not-in-allowlist.com");
      expect(resultBlocked.status).toBe("blocked");
      if (resultBlocked.status === "blocked") {
        expect(resultBlocked.reason).toBe(
          "Domain is not in the configured allowlist",
        );
      }
    });
  });
});
