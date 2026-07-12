import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";
import { buildBlocksFromPayload } from "../multimodal";

describe("multimodal", () => {
  const mockUndiciFetch = mock();
  mock.module("undici", () => ({
    fetch: mockUndiciFetch,
    Agent: class {
      destroy() {}
    },
  }));

  beforeEach(() => {
    // Reset fetch mock
    mockUndiciFetch.mockReset();

    // We also need to mock dns.lookup to return a valid IP address for the tests
    mock.module("node:dns", () => ({
      lookup: (hostname: string, callback: any) => {
        // Return a valid external IP to bypass private IP block checks
        callback(null, "8.8.8.8", 4);
      },
    }));
  });

  afterEach(() => {
    mock.restore();
  });

  describe("buildBlocksFromPayload", () => {
    test("should return empty array for empty payload", async () => {
      const blocks = await buildBlocksFromPayload({});
      expect(blocks).toEqual([]);
    });

    test("should return only text block when payload has only text", async () => {
      const blocks = await buildBlocksFromPayload({ text: "Hello world" });
      expect(blocks).toEqual([{ type: "text", text: "Hello world" }]);
    });

    test("should process base64 images without network calls", async () => {
      const payload = {
        text: "Here is an image",
        image_urls: ["data:image/png;base64,iVBORw0KGgo"],
      };

      const blocks = await buildBlocksFromPayload(payload);

      expect(blocks).toEqual([
        { type: "text", text: "Here is an image" },
        {
          type: "image",
          image_url: { url: "data:image/png;base64,iVBORw0KGgo" },
        },
      ]);
      expect(mockUndiciFetch).not.toHaveBeenCalled();
    });

    test("should fetch external images and convert them to base64", async () => {
      // Mock successful fetch
      mockUndiciFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8), // Mock some buffer data
        headers: {
          get: (name: string) =>
            name === "content-type" ? "image/jpeg" : null,
        },
      });

      const payload = {
        image_urls: ["https://example.com/image.jpg"],
      };

      const blocks = await buildBlocksFromPayload(payload);

      expect(blocks.length).toBe(1);
      expect(blocks[0].type).toBe("image");
      expect(blocks[0].image_url?.url).toMatch(/^data:image\/jpeg;base64,/);
      expect(mockUndiciFetch).toHaveBeenCalledTimes(1);
    });

    test("should filter out failed image fetches", async () => {
      // Mock failed fetch
      mockUndiciFetch.mockResolvedValue({
        ok: false,
        statusText: "Not Found",
      });

      const payload = {
        text: "Failed image",
        image_urls: ["https://example.com/bad.jpg"],
      };

      const blocks = await buildBlocksFromPayload(payload);

      // Should only contain the text block, the failed image should be filtered out
      expect(blocks).toEqual([{ type: "text", text: "Failed image" }]);
      expect(mockUndiciFetch).toHaveBeenCalledTimes(1);
    });

    test("should process >5 images in chunks", async () => {
      // Create 7 image URLs
      const urls = Array.from(
        { length: 7 },
        (_, i) => `https://example.com/img${i}.png`,
      );

      mockUndiciFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(4),
        headers: {
          get: () => "image/png",
        },
      });

      const blocks = await buildBlocksFromPayload({
        text: "Many images",
        image_urls: urls,
      });

      // 1 text + 7 images = 8 blocks
      expect(blocks.length).toBe(8);
      expect(blocks[0].type).toBe("text");

      for (let i = 1; i < 8; i++) {
        expect(blocks[i].type).toBe("image");
      }

      expect(mockUndiciFetch).toHaveBeenCalledTimes(7);
    });
  });
});
