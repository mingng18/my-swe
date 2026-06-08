/**
 * Preapproved domains for external access.
 *
 * These domains are considered safe and don't require additional
 * security checks or user approval for access.
 */

import { createLogger } from "./logger";

const logger = createLogger("preapproved-domains");

/**
 * Preapproved domains that are safe to access without additional checks.
 * These are well-known public services with legitimate APIs.
 *
 * Format: domain without protocol (e.g., "github.com" not "https://github.com")
 */
export const PREAPPROVED_DOMAINS = [
  // GitHub
  "github.com",
  "api.github.com",
  "docs.github.com",
  "raw.githubusercontent.com",
  "gist.githubusercontent.com",
  "gist.github.com",

  // Package registries
  "npmjs.com",
  "registry.npmjs.org",
  "unpkg.com",
  "cdn.jsdelivr.net",
  "yarnpkg.com",

  // Documentation
  "developer.mozilla.org",
  "nodejs.org",
  "typescriptlang.org",
  "deno.land",
  "bun.sh",
  "go.dev",
  "pkg.go.dev",
  "pypi.org",
  "rust-lang.org",
  "crates.io",
  "rubygems.org",

  // Cloud services
  "aws.amazon.com",
  "docs.aws.amazon.com",
  "cloud.google.com",
  "cloud.microsoft.com",
  "azure.microsoft.com",

  // CI/CD
  "githubusercontent.com",
  "actions.githubusercontent.com",

  // Stack Overflow for code help
  "stackoverflow.com",
] as const;

/**
 * Domain patterns that are preapproved (wildcard subdomains).
 */
export const PREAPPROVED_DOMAIN_PATTERNS = [
  // GitHub Pages
  "*.github.io",

  // GitHub Gists (user-specific)
  "*.gist.github.com",

  // Documentation subdomains
  "*.docs.rs", // Rust documentation
  "*.readthedocs.io", // Python documentation
] as const;

// PERFORMANCE OPTIMIZATION: Precompile exact domains for O(1) lookup
const exactPreapprovedDomains = new Set<string>(PREAPPROVED_DOMAINS);

// PERFORMANCE OPTIMIZATION: Precompile regexes for wildcard patterns to replace O(N) string processing
const compiledPatterns = PREAPPROVED_DOMAIN_PATTERNS.map((pattern) => {
  if (!pattern.includes("*")) {
    return new RegExp(`^${pattern.replace(/\./g, "\\.")}$`, "i");
  }
  const regexPattern = pattern.replace(/\./g, "\\.").replace(/\*/g, "[^.]+");
  return new RegExp(`^${regexPattern}$`, "i");
});

/**
 * Check if a hostname is in the preapproved list.
 * Supports both exact matches and subdomain matching.
 */
export function isPreapprovedHost(hostname: string): boolean {
  const lowerHostname = hostname.toLowerCase();

  // PERFORMANCE OPTIMIZATION: Exact match (O(1)) instead of Array.some
  if (exactPreapprovedDomains.has(lowerHostname)) {
    return true;
  }

  // PERFORMANCE OPTIMIZATION: Subdomain match check valid suffixes sequentially
  // rather than iterating the entire array
  let dotIndex = lowerHostname.indexOf(".");
  while (dotIndex !== -1) {
    const suffix = lowerHostname.slice(dotIndex + 1);
    if (exactPreapprovedDomains.has(suffix)) {
      return true;
    }
    dotIndex = lowerHostname.indexOf(".", dotIndex + 1);
  }

  // Pattern match (wildcard subdomains using precompiled Regexes)
  for (const regex of compiledPatterns) {
    if (regex.test(lowerHostname)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a URL is preapproved.
 */
export function isPreapprovedUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    return isPreapprovedHost(parsedUrl.hostname);
  } catch {
    return false;
  }
}

/**
 * Add a domain to the preapproved list at runtime.
 * Note: Changes are not persisted across restarts.
 */
const runtimePreapprovedDomains = new Set<string>();

export function addPreapprovedDomain(domain: string): void {
  const normalized = domain
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  runtimePreapprovedDomains.add(normalized);
  logger.info(`[preapproved-domains] Added domain: ${normalized}`);
}

/**
 * Remove a domain from the runtime preapproved list.
 */
export function removePreapprovedDomain(domain: string): void {
  const normalized = domain
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  runtimePreapprovedDomains.delete(normalized);
  logger.info(`[preapproved-domains] Removed domain: ${normalized}`);
}

/**
 * Check if a domain is preapproved (including runtime additions).
 */
export function isPreapprovedHostWithRuntime(hostname: string): boolean {
  const lowerHostname = hostname.toLowerCase();

  // Check static list
  if (isPreapprovedHost(lowerHostname)) {
    return true;
  }

  // PERFORMANCE OPTIMIZATION: Check runtime additions - Exact match
  if (runtimePreapprovedDomains.has(lowerHostname)) {
    return true;
  }

  // PERFORMANCE OPTIMIZATION: Check runtime additions - Subdomain match
  let dotIndex = lowerHostname.indexOf(".");
  while (dotIndex !== -1) {
    const suffix = lowerHostname.slice(dotIndex + 1);
    if (runtimePreapprovedDomains.has(suffix)) {
      return true;
    }
    dotIndex = lowerHostname.indexOf(".", dotIndex + 1);
  }

  return false;
}

/**
 * Get all preapproved domains (static + runtime).
 */
export function getPreapprovedDomains(): string[] {
  return [
    ...Array.from(PREAPPROVED_DOMAINS),
    ...Array.from(runtimePreapprovedDomains),
  ];
}
