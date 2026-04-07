import TurndownService from "turndown";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import * as dns from "node:dns";
import { promisify } from "node:util";

const lookupAsync = promisify(dns.lookup);

interface FetchUrlSuccessResult {
  url: string;
  markdown_content: string;
  status_code: number;
  content_length: number;
}

interface FetchUrlErrorResult {
  error: string;
  url: string;
}

type FetchUrlResult = FetchUrlSuccessResult | FetchUrlErrorResult;

// Initialize turndown service (singleton for reuse)
const turndownService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

/**
 * Fetch content from a URL and convert HTML to markdown format.
 *
 * This tool fetches web page content and converts it to clean markdown text,
 * making it easy to read and process HTML content. After receiving the markdown,
 * you MUST synthesize the information into a natural, helpful response for the user.
 *
 * @param url - The URL to fetch (must be a valid HTTP/HTTPS URL)
 * @param timeout - Request timeout in seconds (default: 30)
 * @returns Dictionary containing url, markdown_content, status_code, content_length on success, or error and url on failure
 *
 * IMPORTANT: After using this tool:
 * 1. Read through the markdown content
 * 2. Extract relevant information that answers the user's question
 * 3. Synthesize this into a clear, natural language response
 * 4. NEVER show the raw markdown to the user unless specifically requested
 */
export async function fetchUrl(
  url: string,
  timeout: number = 30,
): Promise<FetchUrlResult> {

  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error("Invalid protocol: only http and https are allowed");
    }

    // Resolve IP address to prevent DNS rebinding and IP obfuscation SSRF
    const { address } = await lookupAsync(parsedUrl.hostname);

    // Check for private / loopback IP addresses
    // Match common local/private IPv4 and IPv6 ranges
    if (
      address.startsWith("127.") ||
      address.startsWith("169.254.") ||
      address.startsWith("10.") ||
      address.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./) ||
      address.startsWith("192.168.") ||
      address === "0.0.0.0" ||
      address === "::1" ||
      address.toLowerCase().startsWith("fc00:") ||
      address.toLowerCase().startsWith("fd") ||
      address.toLowerCase().startsWith("fe80:")
    ) {
      throw new Error("Invalid hostname: local and private addresses are not allowed");
    }
  } catch (err) {
    return {
      error: `Fetch URL error: ${err instanceof Error ? err.message : String(err)}`,
      url,
    };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout * 1000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; DeepAgents/1.0)",
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();

    // Convert HTML content to markdown
    const markdownContent = turndownService.turndown(html);

    return {
      url: response.url,
      markdown_content: markdownContent,
      status_code: response.status,
      content_length: markdownContent.length,
    };
  } catch (error) {
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
    description: "Fetch content from a URL and convert HTML to markdown format.",
    schema: z.object({
      url: z.string().describe("The URL to fetch"),
    }),
  }
);
