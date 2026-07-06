import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  isPreapprovedHost,
  isPreapprovedUrl,
  addPreapprovedDomain,
  removePreapprovedDomain,
  isPreapprovedHostWithRuntime,
  getPreapprovedDomains,
} from "../preapproved-domains";

describe("preapproved-domains", () => {
  describe("isPreapprovedHost", () => {
    it("should return true for exact matches in PREAPPROVED_DOMAINS", () => {
      expect(isPreapprovedHost("github.com")).toBe(true);
      expect(isPreapprovedHost("npmjs.com")).toBe(true);
      expect(isPreapprovedHost("aws.amazon.com")).toBe(true);
    });

    it("should return true for subdomains of PREAPPROVED_DOMAINS", () => {
      expect(isPreapprovedHost("api.github.com")).toBe(true);
      expect(isPreapprovedHost("registry.npmjs.org")).toBe(true); // actually in the exact list, but tests exact match
      expect(isPreapprovedHost("subdomain.github.com")).toBe(true);
      expect(isPreapprovedHost("nested.subdomain.npmjs.com")).toBe(true);
    });

    it("should return true for wildcard subdomains in PREAPPROVED_DOMAIN_PATTERNS", () => {
      expect(isPreapprovedHost("user.github.io")).toBe(true);
      expect(isPreapprovedHost("user.gist.github.com")).toBe(true);
      expect(isPreapprovedHost("lib.docs.rs")).toBe(true);
      expect(isPreapprovedHost("project.readthedocs.io")).toBe(true);
    });

    it("should return false for base domains of wildcard patterns (if not in PREAPPROVED_DOMAINS)", () => {
      // github.io is not in PREAPPROVED_DOMAINS, only *.github.io is in PATTERNS
      expect(isPreapprovedHost("github.io")).toBe(false);
      // docs.rs is not in PREAPPROVED_DOMAINS
      expect(isPreapprovedHost("docs.rs")).toBe(false);
    });

    it("should handle case insensitivity", () => {
      expect(isPreapprovedHost("GitHub.com")).toBe(true);
      expect(isPreapprovedHost("API.GITHUB.COM")).toBe(true);
      expect(isPreapprovedHost("USER.github.io")).toBe(true);
    });

    it("should return false for unrelated domains", () => {
      expect(isPreapprovedHost("malicious-site.com")).toBe(false);
      expect(isPreapprovedHost("example.com")).toBe(false);
      expect(isPreapprovedHost("google.com")).toBe(false); // not in list
    });

    it("should handle tricky subdomain edge cases", () => {
      // "fakegithub.com" ends with "github.com" but isn't a subdomain
      expect(isPreapprovedHost("fakegithub.com")).toBe(false);
      expect(isPreapprovedHost("my-aws.amazon.com.fake")).toBe(false);
    });
  });

  describe("isPreapprovedUrl", () => {
    it("should extract hostname and check it", () => {
      expect(isPreapprovedUrl("https://github.com/user/repo")).toBe(true);
      expect(isPreapprovedUrl("http://api.github.com/users")).toBe(true);
      expect(isPreapprovedUrl("https://malicious.com/github.com")).toBe(false);
    });

    it("should handle invalid URLs", () => {
      expect(isPreapprovedUrl("not a valid url")).toBe(false);
      expect(isPreapprovedUrl("")).toBe(false);
    });

    it("returns true for exact matches of preapproved domains", () => {
      expect(isPreapprovedUrl("https://github.com/foo/bar")).toBe(true);
      expect(isPreapprovedUrl("http://github.com")).toBe(true);
      expect(isPreapprovedUrl("wss://github.com")).toBe(true);
    });

    it("returns true for allowed subdomains of preapproved domains", () => {
      expect(isPreapprovedUrl("https://docs.github.com/foo")).toBe(true);
      expect(isPreapprovedUrl("https://api.github.com/users")).toBe(true);
    });

    it("returns true for wildcard domain patterns, fixing the previous implementation bug", () => {
      // The implementation of matchesDomainPattern has been fixed to correctly match standard
      // subdomains and reject invalid double-dot domains.
      expect(isPreapprovedUrl("https://test.github.io")).toBe(true);
      expect(isPreapprovedUrl("https://test..github.io")).toBe(false);

      // user.gist.github.com actually returns true because gist.github.com is in PREAPPROVED_DOMAINS
      // and the subdomain check matches it before it even reaches wildcard check!
      expect(isPreapprovedUrl("https://user.gist.github.com/xyz")).toBe(true);
    });

    it("returns false for non-preapproved domains", () => {
      expect(isPreapprovedUrl("https://example.com")).toBe(false);
      expect(isPreapprovedUrl("http://malicious-site.net/foo")).toBe(false);
    });

    it("returns false for invalid URLs instead of throwing", () => {
      expect(isPreapprovedUrl("not-a-url")).toBe(false);
      expect(isPreapprovedUrl("")).toBe(false);
      expect(isPreapprovedUrl("github.com")).toBe(false); // missing protocol makes it invalid for new URL()
    });

    it("handles trailing slashes and paths correctly", () => {
      expect(isPreapprovedUrl("https://github.com/")).toBe(true);
      expect(isPreapprovedUrl("https://github.com/a/b/c?q=1#hash")).toBe(true);
    });

    it("handles case insensitivity in hostname", () => {
      expect(isPreapprovedUrl("https://GitHub.com")).toBe(true);
      expect(isPreapprovedUrl("https://DOCS.GITHUB.COM")).toBe(true);
    });
  });

  describe("runtime domains", () => {
    // We need to clean up runtime domains after each test to avoid cross-test pollution
    afterEach(() => {
      const domains = getPreapprovedDomains();
      // Remove any domain that was added during the test
      // (This is a bit tricky since we can't distinguish static from runtime easily without parsing getPreapprovedDomains vs PREAPPROVED_DOMAINS,
      // but removePreapprovedDomain will remove from runtime only)
      for (const domain of domains) {
        removePreapprovedDomain(domain);
      }
    });

    it("should add and check runtime domains", () => {
      expect(isPreapprovedHostWithRuntime("custom-domain.com")).toBe(false);

      addPreapprovedDomain("custom-domain.com");

      expect(isPreapprovedHostWithRuntime("custom-domain.com")).toBe(true);
      expect(isPreapprovedHostWithRuntime("sub.custom-domain.com")).toBe(true);
      expect(isPreapprovedHostWithRuntime("fakecustom-domain.com")).toBe(false);
    });

    it("should normalize runtime domains on addition", () => {
      addPreapprovedDomain("https://My-Domain.com/path");
      expect(isPreapprovedHostWithRuntime("my-domain.com")).toBe(true);
    });

    it("should remove runtime domains", () => {
      addPreapprovedDomain("temp-domain.com");
      expect(isPreapprovedHostWithRuntime("temp-domain.com")).toBe(true);

      removePreapprovedDomain("temp-domain.com");
      expect(isPreapprovedHostWithRuntime("temp-domain.com")).toBe(false);
    });

    it("getPreapprovedDomains should include static and runtime domains", () => {
      addPreapprovedDomain("runtime-domain1.com");

      const allDomains = getPreapprovedDomains();
      expect(allDomains).toContain("github.com"); // From static list
      expect(allDomains).toContain("runtime-domain1.com"); // From runtime list
    });
  });
});
