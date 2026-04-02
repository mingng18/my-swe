import { describe, expect, test, mock, afterEach, beforeEach } from "bun:test";
import { fetchUrl } from "./fetch-url";

describe("fetchUrl", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("successfully fetches and converts HTML to markdown", async () => {
    globalThis.fetch = mock().mockResolvedValue(
      new Response("<h1>Hello World</h1><p>This is a test.</p>", {
        status: 200,
        statusText: "OK",
        headers: { "Content-Type": "text/html" },
      })
    );

    const result = await fetchUrl("https://example.com");

    expect(result).toHaveProperty("url");
    expect(result).toHaveProperty("markdown_content");
    if ("markdown_content" in result) {
      expect(result.markdown_content).toContain("# Hello World");
      expect(result.markdown_content).toContain("This is a test.");
      expect(result.status_code).toBe(200);
    }
  });

  test("handles non-200 HTTP responses", async () => {
    globalThis.fetch = mock().mockResolvedValue(
      new Response("Not Found", {
        status: 404,
        statusText: "Not Found",
      })
    );

    const result = await fetchUrl("https://example.com/notfound");

    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect(result.error).toContain("HTTP 404: Not Found");
    }
  });

  test("handles timeout and aborts request", async () => {
    globalThis.fetch = mock().mockImplementation(async (url, options) => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          resolve(new Response("Too late") as any);
        }, 100);

        if (options && typeof options === "object" && "signal" in options) {
          const signal = options.signal as AbortSignal;
          signal.addEventListener("abort", () => {
            clearTimeout(timeout);
            reject(new Error("The operation was aborted."));
          });
        }
      });
    });

    // Use a very short timeout
    const result = await fetchUrl("https://example.com/slow", 0.01);

    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect(result.error).toContain("Fetch URL error: The operation was aborted.");
    }
  });

  test("handles arbitrary network errors", async () => {
    globalThis.fetch = mock().mockRejectedValue(new Error("Network Error"));

    const result = await fetchUrl("https://example.com/error");

    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect(result.error).toContain("Fetch URL error: Network Error");
    }
  });
});
