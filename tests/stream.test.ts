// @ts-nocheck
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { streamRegistry } from "../src/stream";

const BULLHORSE_PORT = parseInt(process.env.BULLHORSE_TEST_PORT || "7861");
const BULLHORSE_URL = `http://localhost:${BULLHORSE_PORT}`;

describe("SSE Endpoint", () => {
  let server: any;

  beforeAll(async () => {
    // Start test server
    const { default: app } = await import("../src/webapp");
    server = Bun.serve({
      port: BULLHORSE_PORT,
      fetch: app.fetch,
    });
  });

  afterAll(() => {
    server?.stop();
  });

  it("should accept SSE connections", async () => {
    const controller = new AbortController();

    // Start the request with a timeout
    const responsePromise = fetch(
      `${BULLHORSE_URL}/stream?threadId=test-thread`,
      {
        headers: {
          Accept: "text/event-stream",
        },
        signal: controller.signal,
      },
    );

    // Wait for connection to establish
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Abort the request to close the stream
    controller.abort();

    try {
      const response = await responsePromise;
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/event-stream");
      expect(response.headers.get("Cache-Control")).toBe("no-cache");
      expect(response.headers.get("Connection")).toBe("keep-alive");
    } catch (error) {
      // AbortError is expected when we abort the request
      if ((error as Error).name !== "AbortError") {
        throw error;
      }
    }
  });

  it("should require authentication when enabled", async () => {
    // This test only runs if API_SECRET_KEY is set
    if (!process.env.API_SECRET_KEY) {
      return; // Skip test
    }

    const response = await fetch(
      `${BULLHORSE_URL}/stream?threadId=test-thread`,
    );

    expect(response.status).toBe(401);
  });

  it("should emit events to the stream", async () => {
    const threadId = "test-emission";

    // Start stream connection in background
    const streamPromise = fetch(
      `${BULLHORSE_URL}/stream?threadId=${threadId}`,
      {
        headers: {
          Accept: "text/event-stream",
        },
      },
    );

    // Wait a bit for connection to establish
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Get emitter and emit event
    const emitter = streamRegistry.getEmitter(threadId);
    expect(emitter).toBeDefined();

    emitter?.emit({
      type: "test_event",
      timestamp: Date.now(),
    } as any);

    // Close emitter
    emitter?.end();

    // Get response
    const response = await streamPromise;
    const text = await response.text();

    expect(text).toContain("data:");
  });

  it("should use default threadId when not provided", async () => {
    const controller = new AbortController();

    // Start the request with a timeout
    const responsePromise = fetch(`${BULLHORSE_URL}/stream`, {
      headers: {
        Accept: "text/event-stream",
      },
      signal: controller.signal,
    });

    // Wait for connection to establish
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Abort the request to close the stream
    controller.abort();

    try {
      const response = await responsePromise;
      expect(response.status).toBe(200);
    } catch (error) {
      // AbortError is expected when we abort the request
      if ((error as Error).name !== "AbortError") {
        throw error;
      }
    }
  });

  it("should handle multiple concurrent streams", async () => {
    const threadIds = ["test-stream-1", "test-stream-2", "test-stream-3"];

    const streams = threadIds.map((threadId) =>
      fetch(`${BULLHORSE_URL}/stream?threadId=${threadId}`, {
        headers: {
          Accept: "text/event-stream",
        },
      }),
    );

    // Wait for connections to establish
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify all streams are active
    for (const threadId of threadIds) {
      const emitter = streamRegistry.getEmitter(threadId);
      expect(emitter).toBeDefined();
      expect(emitter?.isActive()).toBe(true);
    }

    // Close all streams
    for (const threadId of threadIds) {
      const emitter = streamRegistry.getEmitter(threadId);
      emitter?.end();
    }

    // Wait for connections to establish
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Close all streams
    for (const threadId of threadIds) {
      const emitter = streamRegistry.getEmitter(threadId);
      emitter?.end();
    }

    // Wait for responses
    const responses = await Promise.all(streams);

    for (const response of responses) {
      expect(response.status).toBe(200);
      response.body?.cancel();
    }
  });

  it("should cleanup old streams", async () => {
    // This test verifies the cleanup mechanism
    const threadId = "test-cleanup";

    const controller = new AbortController();

    // Create a stream
    const streamPromise = fetch(`${BULLHORSE_URL}/stream?threadId=${threadId}`, {
      headers: {
        Accept: "text/event-stream",
      },
      signal: controller.signal,
    });

    // Wait for connection to establish
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify emitter exists
    const emitter = streamRegistry.getEmitter(threadId);
    expect(emitter).toBeDefined();

    // Close the stream
    emitter?.end();
    controller.abort();

    try {
      await streamPromise;
    } catch (error) {
      // AbortError is expected
      if ((error as Error).name !== "AbortError") {
        throw error;
      }
    }

    // Wait a bit for cleanup
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Emitter should still be in registry but inactive
    const afterEmitter = streamRegistry.getEmitter(threadId);
    expect(afterEmitter).toBeDefined();
    expect(afterEmitter?.isActive()).toBe(false);
  });
});
