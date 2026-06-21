import { describe, it, expect, mock } from "bun:test";
import { checkMessageQueueBeforeModel, withMessageQueueCheck } from "./check-message-queue";
import { Client } from "@langchain/langgraph-sdk";

// Helper to create a mock client
function createMockClient(getItemResult: any) {
  return {
    store: {
      getItem: mock(async () => getItemResult),
      deleteItem: mock(async () => undefined),
    },
  } as unknown as Client;
}

describe("checkMessageQueueBeforeModel", () => {
  it("should return null if threadId is missing", async () => {
    const result = await checkMessageQueueBeforeModel("");
    expect(result).toBeNull();
  });

  it("should return null if client is missing", async () => {
    const result = await checkMessageQueueBeforeModel("thread-123");
    expect(result).toBeNull();
  });

  it("should return null if no pending messages in store", async () => {
    const mockClient = createMockClient(null);
    const result = await checkMessageQueueBeforeModel("thread-123", mockClient);
    expect(result).toBeNull();
    expect(mockClient.store.getItem).toHaveBeenCalledWith(
      ["queue", "thread-123"],
      "pending_messages"
    );
  });

  it("should return null if queuedItem has no messages array", async () => {
    const mockClient = createMockClient({ value: {} });
    const result = await checkMessageQueueBeforeModel("thread-123", mockClient);
    expect(result).toBeNull();
    expect(mockClient.store.deleteItem).toHaveBeenCalledWith(
      ["queue", "thread-123"],
      "pending_messages"
    );
  });

  it("should return null if queuedItem has empty messages array", async () => {
    const mockClient = createMockClient({ value: { messages: [] } });
    const result = await checkMessageQueueBeforeModel("thread-123", mockClient);
    expect(result).toBeNull();
    expect(mockClient.store.deleteItem).toHaveBeenCalledWith(
      ["queue", "thread-123"],
      "pending_messages"
    );
  });

  it("should inject plain text messages", async () => {
    const mockClient = createMockClient({
      value: {
        messages: [{ role: "user", content: "hello" }],
      },
    });
    const result = await checkMessageQueueBeforeModel("thread-123", mockClient);
    expect(result).not.toBeNull();
    expect(result?.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "hello" }] },
    ]);
    expect(mockClient.store.deleteItem).toHaveBeenCalledWith(
      ["queue", "thread-123"],
      "pending_messages"
    );
  });

  it("should inject array of content blocks", async () => {
    const contentBlocks = [{ type: "text", text: "block text" }];
    const mockClient = createMockClient({
      value: {
        messages: [{ role: "user", content: contentBlocks }],
      },
    });
    const result = await checkMessageQueueBeforeModel("thread-123", mockClient);
    expect(result).not.toBeNull();
    expect(result?.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "block text" }] },
    ]);
  });

  it("should inject payload with text + image URLs using buildBlocksFromPayload", async () => {
    const mockClient = createMockClient({
      value: {
        messages: [
          {
            role: "user",
            content: { text: "hello", image_urls: ["http://example.com/img.jpg"] },
          },
        ],
      },
    });
    const result = await checkMessageQueueBeforeModel("thread-123", mockClient);
    expect(result).not.toBeNull();
    expect(result?.messages[0].content).toBeInstanceOf(Array);
  });

  it("should ignore invalid message content", async () => {
    const mockClient = createMockClient({
      value: {
        messages: [{ role: "user", content: null }, { role: "user", content: 123 }],
      },
    });
    const result = await checkMessageQueueBeforeModel("thread-123", mockClient);
    expect(result).toBeNull();
  });

  it("should return null on getItem throw", async () => {
    const mockClient = {
      store: {
        getItem: mock(async () => {
          throw new Error("Store error");
        }),
      },
    } as unknown as Client;
    const result = await checkMessageQueueBeforeModel("thread-123", mockClient);
    expect(result).toBeNull();
  });
});

describe("withMessageQueueCheck", () => {
  it("should return state untouched and call nodeFn if no thread_id in configurable", async () => {
    const nodeFn = mock(async (state) => ({ ...state, changed: true }));
    const wrapped = withMessageQueueCheck(nodeFn);
    const result = await wrapped({ configurable: {} });
    expect(result).toEqual({ configurable: {}, changed: true });
    expect(nodeFn).toHaveBeenCalled();
  });

  it("should return state untouched and call nodeFn if no queued messages", async () => {
    const nodeFn = mock(async (state) => ({ ...state, changed: true }));
    const mockClient = createMockClient(null);
    const wrapped = withMessageQueueCheck(nodeFn, { client: mockClient });
    const result = await wrapped({ configurable: { thread_id: "thread-123" } });
    expect(result).toEqual({ configurable: { thread_id: "thread-123" }, changed: true });
    expect(nodeFn).toHaveBeenCalled();
  });

  it("should merge queued messages into state and NOT call nodeFn", async () => {
    const nodeFn = mock(async (state) => ({ ...state }));
    const mockClient = createMockClient({
      value: {
        messages: [{ role: "user", content: "hello" }],
      },
    });
    const wrapped = withMessageQueueCheck(nodeFn, { client: mockClient });
    const result = await wrapped({
      configurable: { thread_id: "thread-123" },
      messages: [{ role: "system", content: "hi" }],
    });
    expect((result as any).messages).toEqual([
      { role: "system", content: "hi" },
      { role: "user", content: [{ type: "text", text: "hello" }] },
    ]);
    expect(nodeFn).not.toHaveBeenCalled();
  });
});
