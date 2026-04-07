import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";
import { buildBlocksFromPayload, fetchImageBlock } from "./multimodal";

describe("multimodal benchmark", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // Mock fetch to simulate network delay
    globalThis.fetch = (mock(async (url: string) => {
      // Simulate 100ms network latency
      await new Promise(resolve => setTimeout(resolve, 100));
      return {
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(0),
        headers: {
          get: () => "image/png"
        }
      } as any;
    }) as unknown) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("benchmark buildBlocksFromPayload with multiple images", async () => {
    const urls = Array.from({ length: 5 }, (_, i) => `http://example.com/image${i}.png`);

    const start = performance.now();
    const blocks = await buildBlocksFromPayload({
      text: "Test",
      image_urls: urls
    });
    const end = performance.now();

    const duration = end - start;
    console.log(`\nBenchmark Result:`);
    console.log(`Duration for 5 images: ${duration.toFixed(2)}ms`);

    expect(blocks.length).toBe(6); // 1 text + 5 images
    // Currently sequential, so 5 * 100ms = ~500ms
    // We expect it to be around 500ms before optimization
  });
});
