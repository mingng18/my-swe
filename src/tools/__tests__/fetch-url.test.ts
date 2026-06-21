import { describe, expect, test, mock, afterEach, beforeEach } from "bun:test";

const mockUndiciFetch = mock();

mock.module("undici", () => ({
  fetch: mockUndiciFetch,
  Agent: class {
    destroy() { return Promise.resolve(); }
  },
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

    // Fetched content is externally-sourced, so it is defanged (envelope-wrapped).
    expect(result).toMatchObject({
      url: "https://example.com",
      status_code: 200,
      content_length: 30,
    });
    const markdown = (result as any).markdown_content;
    expect(markdown).toContain("<untrusted_data source=\"fetch-url\">");
    expect(markdown).toContain("# Hello World\n\nThis is a test.");
    expect(markdown).toContain("</untrusted_data>");
  });

  test("handles fetch throwing an error", async () => {
    const { fetchUrl } = await import("../fetch-url");

    const result = await fetchUrl("https://example.com/error");

    expect(result).toEqual({
      error: "Fetch URL error: Network Error",
      url: "https://example.com/error",
    });
  });

  test("handles blocklist check failed", async () => {
    const { spyOn } = await import("bun:test");

    const domainBlocklist = await import("../../utils/domain-blocklist");

    const dns = await import("node:dns");
    const dnsSpy = spyOn(dns, "lookup").mockImplementation((((...args: any[]) => {
        const callback = args[args.length - 1];
        callback(null, "93.184.215.14", 4);
    }) as unknown) as any);

    // We mock checkDomainBlocklist to return 'check_failed'
    const spy = spyOn(domainBlocklist, "checkDomainBlocklist").mockResolvedValue({
        status: "check_failed",
        error: new Error("Mock check failed error")
    });

    const consoleSpy = spyOn(console, "warn").mockImplementation(() => {});

    const { fetchUrl } = await import("../fetch-url");

    const testUrl = "https://example.org";
    const result = await fetchUrl(testUrl);

    expect(spy).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
        `[fetch-url] Domain check failed for example.org:`,
        expect.any(Error)
    );
    expect((result as any).error).toBeUndefined();
    expect(result).toMatchObject({
      url: testUrl,
      status_code: 200,
    });

    spy.mockRestore();
    consoleSpy.mockRestore();
    dnsSpy.mockRestore();
  });

  test("fetchUrlTool returns stringified result", async () => {
    const { fetchUrlTool } = await import("../fetch-url");

    const result = await fetchUrlTool.invoke({
      url: "https://example.com/tool",
    });

    // Result should be a JSON string
    expect(typeof result).toBe("string");

    const parsed = JSON.parse(result);
    expect(parsed).toMatchObject({
      url: "https://example.com/tool",
      status_code: 200,
      content_length: 9,
    });
    // Externally-sourced markdown is wrapped in the untrusted-data envelope.
    expect(parsed.markdown_content).toContain("<untrusted_data source=\"fetch-url\">");
    expect(parsed.markdown_content).toContain("Tool Test");
    expect(parsed.markdown_content).toContain("</untrusted_data>");
  });
});
