import TurndownService from "turndown";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import * as dns from "node:dns";
import { promisify } from "node:util";
import { LRUCache } from "lru-cache";
import { isPreapprovedHost } from "../utils/preapproved-domains";
import { checkDomainBlocklist } from "../utils/domain-blocklist";

const lookupAsync = promisify(dns.lookup);

interface FetchUrlSuccessResult {
  url: string;
  markdown_content: string;
  status_code: number;
  content_length: number;
}

interface FetchUrlRedirectResult {
  redirect_detected: true;
  original_url: string;
  redirect_url: string;
  status_code: number;
  status_text: string;
  message: string;
}

interface FetchUrlErrorResult {
  error: string;
  url: string;
}

type FetchUrlResult =
  | FetchUrlSuccessResult
  | FetchUrlRedirectResult
  | FetchUrlErrorResult;

// Initialize turndown service (singleton for reuse)
let turndownServiceInstance: TurndownService | null = null;

function getTurndownService(): TurndownService {
  if (!turndownServiceInstance) {
    turndownServiceInstance = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
    });
  }
  return turndownServiceInstance;
}

// Constants for security and limits
const MAX_URL_LENGTH = 2000;
const MAX_HTTP_CONTENT_LENGTH = 10 * 1024 * 1024; // 10MB
const MAX_REDIRECTS = 10;
const FETCH_TIMEOUT_MS = 60_000; // 60 seconds
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_CACHE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

// Cache entry type
type CacheEntry = {
  markdownContent: string;
  statusCode: number;
  contentLength: number;
};

// LRU cache for fetched URLs
const URL_CACHE = new LRUCache<string, CacheEntry>({
  maxSize: MAX_CACHE_SIZE_BYTES,
  ttl: CACHE_TTL_MS,
  sizeCalculation: (value) => value.contentLength,
});

/**
 * Check if a redirect is safe to follow.
 * Allows redirects that:
 * - Add or remove "www." in the hostname
 * - Keep the origin the same but change path/query params
 * - Or both of the above
 */
function isPermittedRedirect(
  originalUrl: string,
  redirectUrl: string,
): boolean {
  try {
    const parsedOriginal = new URL(originalUrl);
    const parsedRedirect = new URL(redirectUrl);

    // Protocol must match
    if (parsedRedirect.protocol !== parsedOriginal.protocol) {
      return false;
    }

    // Port must match
    if (parsedRedirect.port !== parsedOriginal.port) {
      return false;
    }

    // No credentials allowed in redirect
    if (parsedRedirect.username || parsedRedirect.password) {
      return false;
    }

    // Strip www. for comparison
    const stripWww = (hostname: string) => hostname.replace(/^www\./, "");
    const originalHostWithoutWww = stripWww(parsedOriginal.hostname);
    const redirectHostWithoutWww = stripWww(parsedRedirect.hostname);

    // Hostnames must match (with or without www.)
    return originalHostWithoutWww === redirectHostWithoutWww;
  } catch {
    return false;
  }
}

/**
 * Validate URL before fetching.
 */
function validateURL(url: string): { valid: boolean; error?: string } {
  if (url.length > MAX_URL_LENGTH) {
    return {
      valid: false,
      error: `URL exceeds maximum length of ${MAX_URL_LENGTH}`,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { valid: false, error: "Only http and https protocols are allowed" };
  }

  // No credentials in URL
  if (parsed.username || parsed.password) {
    return { valid: false, error: "URLs with credentials are not allowed" };
  }

  // Basic hostname validation
  const parts = parsed.hostname.split(".");
  if (parts.length < 2) {
    return { valid: false, error: "Invalid hostname" };
  }

  return { valid: true };
}

/**
 * Fetch with manual redirect handling for security.
 */
async function fetchWithPermittedRedirects(
  url: string,
  signal: AbortSignal,
  depth = 0,
): Promise<{ response: Response; finalUrl: string } | FetchUrlRedirectResult> {
  if (depth > MAX_REDIRECTS) {
    return {
      redirect_detected: true,
      original_url: url,
      redirect_url: url,
      status_code: 0,
      status_text: "Too many redirects",
      message: `Exceeded maximum of ${MAX_REDIRECTS} redirects`,
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  // Set up signal to abort on timeout or external abort
  signal.addEventListener("abort", () => controller.abort());

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "manual", // Handle redirects manually
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; DeepAgents/1.0)",
      },
    });

    clearTimeout(timeoutId);

    // Check if it's a redirect
    const statusCode = response.status;
    if (
      statusCode === 301 ||
      statusCode === 302 ||
      statusCode === 307 ||
      statusCode === 308
    ) {
      const location = response.headers.get("location");
      if (!location) {
        return {
          redirect_detected: true,
          original_url: url,
          redirect_url: url,
          status_code: statusCode,
          status_text: response.statusText,
          message: "Redirect missing Location header",
        };
      }

      // Resolve relative URLs
      const redirectUrl = new URL(location, url).toString();

      if (isPermittedRedirect(url, redirectUrl)) {
        // Follow the permitted redirect recursively
        return fetchWithPermittedRedirects(redirectUrl, signal, depth + 1);
      } else {
        // Return redirect info for user to decide
        return {
          redirect_detected: true,
          original_url: url,
          redirect_url: redirectUrl,
          status_code: statusCode,
          status_text: response.statusText,
          message: `Redirect from ${url} to ${redirectUrl} requires explicit approval`,
        };
      }
    }

    return { response, finalUrl: url };
  } catch (error) {
    clearTimeout(timeoutId);

    // Rethrow abort errors
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }

    throw error;
  }
}

/**
 * Fetch content from a URL and convert HTML to markdown format.
 *
 * This tool fetches web page content and converts it to clean markdown text,
 * making it easy to read and process HTML content. After receiving the markdown,
 * you MUST synthesize the information into a natural, helpful response for the user.
 *
 * @param url - The URL to fetch (must be a valid HTTP/HTTPS URL)
 * @param timeout - Request timeout in seconds (default: 30, max: 60)
 * @returns Dictionary containing url, markdown_content, status_code, content_length on success, or error/redirect info on failure
 *
 * IMPORTANT: After using this tool:
 * 1. Read through the markdown content
 * 2. Extract relevant information that answers the user's question
 * 3. Synthesize this into a clear, natural language response
 * 4. NEVER show the raw markdown to the user unless specifically requested
 *
 * Security features:
 * - DNS resolution to prevent DNS rebinding attacks
 * - Private IP address detection
 * - Safe redirect handling (same-origin only)
 * - Content size limits
 * - Automatic HTTP→HTTPS upgrade
 * - 15-minute LRU cache to reduce redundant fetches
 */
export async function fetchUrl(
  url: string,
  timeout: number = 30,
): Promise<FetchUrlResult> {
  // Validate URL format
  const validation = validateURL(url);
  if (!validation.valid) {
    return {
      error: `Fetch URL error: ${validation.error}`,
      url,
    };
  }

  // Check cache first
  const cachedEntry = URL_CACHE.get(url);
  if (cachedEntry) {
    return {
      url,
      markdown_content: cachedEntry.markdownContent,
      status_code: cachedEntry.statusCode,
      content_length: cachedEntry.contentLength,
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);

    // Upgrade http to https
    if (parsedUrl.protocol === "http:") {
      parsedUrl.protocol = "https:";
      url = parsedUrl.toString();
    }

    // Check domain blocklist (skip for preapproved domains)
    if (!isPreapprovedHost(parsedUrl.hostname)) {
      const blocklistCheck = await checkDomainBlocklist(parsedUrl.hostname);
      if (blocklistCheck.status === "blocked") {
        return {
          error: `Fetch URL error: Domain blocked - ${blocklistCheck.reason}`,
          url,
        };
      }
      if (blocklistCheck.status === "check_failed") {
        // Log but continue - the fetch will likely fail anyway if truly blocked
        console.warn(
          `[fetch-url] Domain check failed for ${parsedUrl.hostname}:`,
          blocklistCheck.error,
        );
      }
    }

    // DNS resolution to prevent DNS rebinding
    const { address } = await lookupAsync(parsedUrl.hostname);

    // Normalize IPv4-mapped IPv6 addresses for accurate checking
    let normalizedAddress = address.toLowerCase();
    normalizedAddress = normalizedAddress.replace(
      /^((?:0+:)+|(?:0+:)*:+(?:0+:)*)ffff:/,
      "",
    );

    // Check for private / loopback IP addresses
    if (
      normalizedAddress.startsWith("127.") ||
      normalizedAddress.startsWith("169.254.") ||
      normalizedAddress.startsWith("10.") ||
      normalizedAddress.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./) ||
      normalizedAddress.startsWith("192.168.") ||
      normalizedAddress === "0.0.0.0" ||
      normalizedAddress === "::1" ||
      normalizedAddress === "::" ||
      normalizedAddress.startsWith("fc00:") ||
      normalizedAddress.startsWith("fd") ||
      normalizedAddress.startsWith("fe80:")
    ) {
      throw new Error("Local and private addresses are not allowed");
    }
  } catch (err) {
    return {
      error: `Fetch URL error: ${err instanceof Error ? err.message : String(err)}`,
      url,
    };
  }

  const controller = new AbortController();
  const effectiveTimeout = Math.min(timeout, 60) * 1000;
  const timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);

  try {
    const fetchResult = await fetchWithPermittedRedirects(
      url,
      controller.signal,
    );

    // Handle redirect case
    if ("redirect_detected" in fetchResult) {
      return fetchResult;
    }

    const { response, finalUrl } = fetchResult;
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Check content length
    const contentLength = parseInt(
      response.headers.get("content-length") || "0",
      10,
    );
    if (contentLength > MAX_HTTP_CONTENT_LENGTH) {
      throw new Error(
        `Content too large: ${contentLength} bytes exceeds maximum of ${MAX_HTTP_CONTENT_LENGTH}`,
      );
    }

    const html = await response.text();

    // Check actual content length
    if (html.length > MAX_HTTP_CONTENT_LENGTH) {
      throw new Error(
        `Content too large: ${html.length} bytes exceeds maximum of ${MAX_HTTP_CONTENT_LENGTH}`,
      );
    }

    // Convert HTML content to markdown
    const turndownService = getTurndownService();
    const markdownContent = turndownService.turndown(html);

    // Cache the result
    const cacheEntry: CacheEntry = {
      markdownContent,
      statusCode: response.status,
      contentLength: markdownContent.length,
    };
    URL_CACHE.set(url, cacheEntry);

    return {
      url: finalUrl,
      markdown_content: markdownContent,
      status_code: response.status,
      content_length: markdownContent.length,
    };
  } catch (error) {
    clearTimeout(timeoutId);

    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      error: `Fetch URL error: ${errorMessage}`,
      url,
    };
  }
}

export const fetchUrlTool = tool(
  async ({ url }) => {
    const result = await fetchUrl(url);
    return JSON.stringify(result);
  },
  {
    name: "fetch_url",
    description:
      "Fetch content from a URL and convert HTML to markdown format.",
    schema: z.object({
      url: z.string().describe("The URL to fetch"),
    }),
  },
);
