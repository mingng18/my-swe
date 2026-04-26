import { describe, expect, test, mock, afterEach, beforeEach } from "bun:test";

const mockUndiciFetch = mock();

mock.module("undici", () => ({
  fetch: mockUndiciFetch,
  Agent: class {},
}));

// Import dynamically so the mock applies
describe("fetchUrl", () => {
  beforeEach(() => {
    mockUndiciFetch.mockReset();
    mockUndiciFetch.mockImplementation(async (url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes("not-found")) {
        return {
          ok: false,
          status: 404,
          statusText: "Not Found",
          url: urlStr,
        } as any;
      }
      if (urlStr.includes("error")) {
        throw new Error("Network Error");
      }
      if (urlStr.includes("tool")) {
        return {
          ok: true,
          status: 200,
          url: urlStr,
          text: async () => "<p>Tool Test</p>",
          headers: { get: () => "0" },
        } as any;
      }
      // default success
      return {
        ok: true,
        status: 200,
        url: urlStr,
        text: async () => "<h1>Hello World</h1><p>This is a test.</p>",
        headers: { get: () => "0" },
      } as any;
    });
  });

  test("handles non-OK HTTP responses", async () => {
    const { fetchUrl } = await import("../fetch-url");

    const result = await fetchUrl("https://example.com/not-found");

    expect(result).toEqual({
      error: "Fetch URL error: HTTP 404: Not Found",
      url: "https://example.com/not-found",
    });
  });

  test("fetches and converts HTML to markdown on success", async () => {
    const { fetchUrl } = await import("../fetch-url");

    const result = await fetchUrl("https://example.com");

    expect(result).toEqual({
      url: "https://example.com",
      markdown_content: "# Hello World\n\nThis is a test.",
      status_code: 200,
      content_length: 30,
    });
  });

  test("handles fetch throwing an error", async () => {
    const { fetchUrl } = await import("../fetch-url");

    const result = await fetchUrl("https://example.com/error");

    expect(result).toEqual({
      error: "Fetch URL error: Network Error",
      url: "https://example.com/error",
    });
  });

  test("fetchUrlTool returns stringified result", async () => {
    const { fetchUrlTool } = await import("../fetch-url");

    const result = await fetchUrlTool.invoke({
      url: "https://example.com/tool",
    });

    // Result should be a JSON string
    expect(typeof result).toBe("string");

    const parsed = JSON.parse(result);
    expect(parsed).toEqual({
      url: "https://example.com/tool",
      markdown_content: "Tool Test",
      status_code: 200,
      content_length: 9,
    });
  });
});
