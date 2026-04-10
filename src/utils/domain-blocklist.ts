/**
 * Domain blocklist checking for external URL fetches.
 *
 * Provides security checks to prevent access to malicious or
 * unauthorized domains. Supports enterprise environments where
 * external API access may be restricted.
 */

import { createLogger } from "./logger";

const logger = createLogger("domain-blocklist");

/**
 * Result of a domain blocklist check.
 */
export type DomainCheckResult =
  | { status: "allowed" }
  | { status: "blocked"; reason: string }
  | { status: "check_failed"; error: Error };

/**
 * Local domain blocklist.
 * Add domains here that should never be accessed.
 */
const LOCAL_BLOCKLIST = new Set<string>([
  // Add malicious or unsafe domains here
  // Example: "malicious-domain.com"
]);

/**
 * Domain allowlist (when enabled, only these domains are allowed).
 * Useful for restricted environments.
 */
const LOCAL_ALLOWLIST = new Set<string>();

/**
 * Cache for checked domains to avoid repeated checks.
 * Cache only "allowed" results - blocked/failed are rechecked.
 */
const DOMAIN_CHECK_CACHE = new Map<string, true>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 128;

/**
 * Clear the domain check cache.
 */
export function clearDomainCheckCache(): void {
  DOMAIN_CHECK_CACHE.clear();
  logger.debug("[domain-blocklist] Cache cleared");
}

/**
 * Add a domain to the local blocklist.
 */
export function addToBlocklist(domain: string): void {
  LOCAL_BLOCKLIST.add(domain.toLowerCase());
  logger.info(`[domain-blocklist] Added to blocklist: ${domain}`);
}

/**
 * Add a domain to the local allowlist.
 */
export function addToAllowlist(domain: string): void {
  LOCAL_ALLOWLIST.add(domain.toLowerCase());
  logger.info(`[domain-blocklist] Added to allowlist: ${domain}`);
}

/**
 * Remove a domain from the local blocklist.
 */
export function removeFromBlocklist(domain: string): void {
  LOCAL_BLOCKLIST.delete(domain.toLowerCase());
  logger.info(`[domain-blocklist] Removed from blocklist: ${domain}`);
}

/**
 * Check if a hostname is blocked by the local blocklist.
 */
function isLocallyBlocked(hostname: string): { blocked: boolean; reason?: string } {
  const lowerHostname = hostname.toLowerCase();

  // Check exact match
  if (LOCAL_BLOCKLIST.has(lowerHostname)) {
    return { blocked: true, reason: "Domain is in local blocklist" };
  }

  // Check subdomain match
  for (const blocked of LOCAL_BLOCKLIST) {
    if (lowerHostname.endsWith(`.${blocked}`)) {
      return { blocked: true, reason: `Subdomain of blocked domain: ${blocked}` };
    }
  }

  return { blocked: false };
}

/**
 * Check if a hostname is in the allowlist (when allowlist is enabled).
 */
function isInAllowlist(hostname: string): boolean {
  if (LOCAL_ALLOWLIST.size === 0) {
    return true; // No allowlist configured, allow all
  }

  const lowerHostname = hostname.toLowerCase();

  // Check exact match
  if (LOCAL_ALLOWLIST.has(lowerHostname)) {
    return true;
  }

  // Check subdomain match
  for (const allowed of LOCAL_ALLOWLIST) {
    if (lowerHostname === allowed || lowerHostname.endsWith(`.${allowed}`)) {
      return true;
    }
  }

  return false;
}

/**
 * Manage cache size by evicting oldest entries if needed.
 */
function manageCacheSize(): void {
  if (DOMAIN_CHECK_CACHE.size >= MAX_CACHE_SIZE) {
    // Clear first quarter of entries
    const entries = Array.from(DOMAIN_CHECK_CACHE.entries());
    const toRemove = Math.floor(entries.length / 4);
    for (let i = 0; i < toRemove; i++) {
      DOMAIN_CHECK_CACHE.delete(entries[i][0]);
    }
    logger.debug(`[domain-blocklist] Evicted ${toRemove} cache entries`);
  }
}

/**
 * Add a domain to the cache.
 */
function cacheDomain(domain: string): void {
  manageCacheSize();
  DOMAIN_CHECK_CACHE.set(domain, true);

  // Auto-clear after TTL
  setTimeout(() => {
    DOMAIN_CHECK_CACHE.delete(domain);
  }, CACHE_TTL_MS).unref();
}

/**
 * Check a domain against the blocklist.
 *
 * @param domain - Domain to check (hostname only, no protocol)
 * @returns Check result indicating if domain is allowed, blocked, or check failed
 */
export async function checkDomainBlocklist(
  domain: string,
): Promise<DomainCheckResult> {
  const lowerDomain = domain.toLowerCase();

  // Check cache first
  if (DOMAIN_CHECK_CACHE.has(lowerDomain)) {
    return { status: "allowed" };
  }

  // Check local blocklist
  const localCheck = isLocallyBlocked(lowerDomain);
  if (localCheck.blocked) {
    logger.warn(`[domain-blocklist] Domain blocked: ${domain}`);
    return {
      status: "blocked",
      reason: localCheck.reason || "Domain is blocked",
    };
  }

  // Check allowlist (if configured)
  if (LOCAL_ALLOWLIST.size > 0 && !isInAllowlist(lowerDomain)) {
    logger.warn(`[domain-blocklist] Domain not in allowlist: ${domain}`);
    return {
      status: "blocked",
      reason: "Domain is not in the configured allowlist",
    };
  }

  // Skip external API check if configured (for enterprise environments)
  if (process.env.SKIP_DOMAIN_BLOCKLIST_CHECK === "true") {
    logger.debug(`[domain-blocklist] Skipping external check for: ${domain}`);
    cacheDomain(lowerDomain);
    return { status: "allowed" };
  }

  // Optional: Add external blocklist API check here
  // For now, we'll just cache and allow the domain
  // In a production environment, you might want to integrate with:
  // - Google Safe Browsing API
  // - VirusTotal API
  // - Custom enterprise blocklist service
  // - Anthropic's domain info API (as in WebFetch)

  cacheDomain(lowerDomain);
  return { status: "allowed" };
}

/**
 * Check a URL against the blocklist.
 * Extracts the hostname and performs the check.
 */
export async function checkUrlBlocklist(url: string): Promise<DomainCheckResult> {
  try {
    const parsedUrl = new URL(url);
    return checkDomainBlocklist(parsedUrl.hostname);
  } catch (error) {
    return {
      status: "check_failed",
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Get blocklist statistics.
 */
export function getBlocklistStats(): {
  cacheSize: number;
  blocklistSize: number;
  allowlistSize: number;
} {
  return {
    cacheSize: DOMAIN_CHECK_CACHE.size,
    blocklistSize: LOCAL_BLOCKLIST.size,
    allowlistSize: LOCAL_ALLOWLIST.size,
  };
}
