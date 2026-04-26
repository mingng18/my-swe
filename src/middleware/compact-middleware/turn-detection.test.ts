/**
 * Tests for turn detection in compaction middleware.
 *
 * This test ensures that compaction only runs once per turn (when a user message is received)
 * rather than on every model call within a turn.
 */

import { describe, it, expect } from "bun:test";
import { createCompactionMiddleware, cleanupThreadState, getThreadMetadata } from "./index";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";

// Import the isNewTurn function for unit testing
// Note: This function is not exported, so we'll test it indirectly through integration behavior

describe("Turn Detection", () => {
  it("should only run compaction once per turn, not on every model call", async () => {
    const model = new ChatOpenAI({
      model: "gpt-4o",
      apiKey: "test",
    });

    const middleware = createCompactionMiddleware({ model });

    // Create messages that will trigger the 10-message threshold
    const initialMessages: any[] = [];
    for (let i = 0; i < 50; i++) {
      initialMessages.push(new HumanMessage(`message ${i}`));
      initialMessages.push(new AIMessage(`response ${i}`));
    }

    const threadId = "test-turn-detection";
    cleanupThreadState(threadId);

    // First call - ends with user message, should trigger compaction
    const firstCallMessages = [...initialMessages, new HumanMessage("new turn")];

    await middleware.wrapModelCall!(
      {
        messages: firstCallMessages,
        configurable: { thread_id: threadId },
      } as any,
      (async (req: any) => {
        return { content: "response" };
      }) as any,
    );

    const metadata1 = getThreadMetadata(threadId);

    // Second call - ends with tool message, should NOT trigger compaction
    // (even though it has 10+ more messages than last check)
    const secondCallMessages = [
      ...initialMessages,
      new HumanMessage("new turn"),
      new AIMessage("tool call"),
      ...Array.from({ length: 15 }, (_, i) =>
        new ToolMessage({ content: `result ${i}`, tool_call_id: `tool${i}` }),
      ),
    ];

    await middleware.wrapModelCall!(
      {
        messages: secondCallMessages,
        configurable: { thread_id: threadId },
      } as any,
      (async (req: any) => {
        return { content: "response" };
      }) as any,
    );

    const metadata2 = getThreadMetadata(threadId);

    // With the fix: first call should trigger (user message), second should not (tool message)
    // The metadata should remain the same (from first call) after second call
    // If the second call had triggered, the metadata might be different
    expect(metadata2).toEqual(metadata1);

    cleanupThreadState(threadId);
  });

  it("should trigger compaction when last message is from user", async () => {
    const model = new ChatOpenAI({
      model: "gpt-4o",
      apiKey: "test",
    });

    const middleware = createCompactionMiddleware({ model });

    // Create enough messages to trigger the 10-message threshold
    const messages: any[] = [];
    for (let i = 0; i < 50; i++) {
      messages.push(new HumanMessage(`message ${i}`));
      messages.push(new AIMessage(`response ${i}`));
    }

    const threadId = "test-user-message";
    cleanupThreadState(threadId);

    // End with user message - should trigger
    const userEndedMessages = [...messages, new HumanMessage("new user message")];

    await middleware.wrapModelCall!(
      {
        messages: userEndedMessages,
        configurable: { thread_id: threadId },
      } as any,
      (async (req: any) => {
        return { content: "response" };
      }) as any,
    );

    const metadata = getThreadMetadata(threadId);

    // Compaction should have been triggered (metadata should exist, even if level is "none")
    expect(metadata).toBeDefined();

    cleanupThreadState(threadId);
  });

  it("should not trigger compaction when last message is from tool", async () => {
    const model = new ChatOpenAI({
      model: "gpt-4o",
      apiKey: "test",
    });

    const middleware = createCompactionMiddleware({ model });

    // Create base messages
    const messages: any[] = [];
    for (let i = 0; i < 50; i++) {
      messages.push(new HumanMessage(`message ${i}`));
      messages.push(new AIMessage(`response ${i}`));
    }

    const threadId = "test-tool-message";
    cleanupThreadState(threadId);

    // First call to establish lastMessageCount
    await middleware.wrapModelCall!(
      {
        messages: [...messages, new HumanMessage("user message")],
        configurable: { thread_id: threadId },
      } as any,
      (async (req: any) => {
        return { content: "response" };
      }) as any,
    );

    const metadata1 = getThreadMetadata(threadId);

    // Second call - end with tool message, should NOT trigger
    const toolEndedMessages = [
      ...messages,
      new HumanMessage("user message"),
      new AIMessage("tool call"),
      new ToolMessage({ content: "result", tool_call_id: "tool1" }),
      new ToolMessage({ content: "result", tool_call_id: "tool2" }),
      new ToolMessage({ content: "result", tool_call_id: "tool3" }),
      new ToolMessage({ content: "result", tool_call_id: "tool4" }),
      new ToolMessage({ content: "result", tool_call_id: "tool5" }),
      new ToolMessage({ content: "result", tool_call_id: "tool6" }),
      new ToolMessage({ content: "result", tool_call_id: "tool7" }),
      new ToolMessage({ content: "result", tool_call_id: "tool8" }),
      new ToolMessage({ content: "result", tool_call_id: "tool9" }),
      new ToolMessage({ content: "result", tool_call_id: "tool10" }),
    ];

    await middleware.wrapModelCall!(
      {
        messages: toolEndedMessages,
        configurable: { thread_id: threadId },
      } as any,
      (async (req: any) => {
        return { content: "response" };
      }) as any,
    );

    const metadata2 = getThreadMetadata(threadId);

    // Metadata should be the same (second call shouldn't have triggered)
    expect(metadata2).toEqual(metadata1);

    cleanupThreadState(threadId);
  });
});
