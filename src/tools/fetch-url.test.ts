import { describe, expect, test, mock, afterEach } from "bun:test";
import { fetchUrl } from "./fetch-url";

describe("fetchUrl", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("handles non-OK HTTP responses", async () => {
    globalThis.fetch = mock().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      url: "https://example.com/not-found",
    }) as unknown as typeof fetch;

    const result = await fetchUrl("https://example.com/not-found");

    expect(result).toEqual({
      error: "Fetch URL error: HTTP 404: Not Found",
      url: "https://example.com/not-found",
    });
  });

  test("fetches and converts HTML to markdown on success", async () => {
    globalThis.fetch = mock().mockResolvedValue({
      ok: true,
      status: 200,
      url: "https://example.com",
      text: async () => "<h1>Hello World</h1><p>This is a test.</p>",
    }) as unknown as typeof fetch;

    const result = await fetchUrl("https://example.com");

    expect(result).toEqual({
      url: "https://example.com",
      markdown_content: "# Hello World\n\nThis is a test.",
      status_code: 200,
      content_length: 30,
    });
  });

  test("handles fetch throwing an error", async () => {
    globalThis.fetch = mock().mockRejectedValue(new Error("Network Error")) as unknown as typeof fetch;

    const result = await fetchUrl("https://example.com/error");

    expect(result).toEqual({
      error: "Fetch URL error: Network Error",
      url: "https://example.com/error",
    });
  });
});
