import { fetch as undiciFetch } from "undici";
import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";
import { buildBlocksFromPayload, fetchImageBlock } from "../multimodal";

describe("multimodal benchmark", () => {
  const mockUndiciFetch = mock();
mock.module("undici", () => ({
  fetch: mockUndiciFetch,
  Agent: class {}
}));

  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // We now use undici for fetching in multimodal, so we need to mock undici fetch
    mock.module("undici", () => ({
      fetch: async (url: string) => {
        // Simulate 100ms network latency
        await new Promise((resolve) => setTimeout(resolve, 100));
        return {
          ok: true,
          arrayBuffer: async () => new ArrayBuffer(0),
          headers: {
            get: () => "image/png",
          },
        } as any;
      },
      Agent: class {
        destroy() {}
      },
    }));

    // We also need to mock dns.lookup to return a valid IP address for the tests
    mock.module("node:dns", () => ({
      lookup: (hostname: string, callback: any) => {
        callback(null, "8.8.8.8", 4);
      },
    }));
  });

  afterEach(() => {
    mock.restore();
  });

  test("benchmark buildBlocksFromPayload with multiple images", async () => {
    const urls = Array.from(
      { length: 5 },
      (_, i) => `http://example.com/image${i}.png`,
    );

    const start = performance.now();
    const blocks = await buildBlocksFromPayload({
      text: "Test",
      image_urls: urls,
    });
    const end = performance.now();

    const duration = end - start;

    expect(blocks.length).toBe(6); // 1 text + 5 images
    // Currently sequential, so 5 * 100ms = ~500ms
    // We expect it to be around 500ms before optimization
  });
});
