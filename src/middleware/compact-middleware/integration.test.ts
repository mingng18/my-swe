/**
 * Integration tests for compaction middleware.
 *
 * These tests verify the overall behavior of the compaction system,
 * particularly timing and threshold behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createCompactionMiddleware, cleanupThreadState } from "./index";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, AIMessage } from "@langchain/core/messages";

describe("Compaction Integration", () => {
  let originalLog: typeof console.info;
  let compactionRan = false;

  beforeEach(() => {
    // Mock console.info to detect when compaction runs
    compactionRan = false;
    originalLog = console.info;
    console.info = (...args: any[]) => {
      if (args[0]?.includes?.("Running compaction cascade")) {
        compactionRan = true;
      }
      originalLog(...args);
    };
  });

  afterEach(() => {
    // Restore console.info and clean up thread state
    console.info = originalLog;
    cleanupThreadState("test-thread");
  });

  it("should not run compaction on conversations with only 3 turns", async () => {
    const model = new ChatOpenAI({
      model: "gpt-4o",
      apiKey: "test",
    });

    // Set cascade trigger to 70%
    const middleware = createCompactionMiddleware({
      model,
      config: {
        cascadeTrigger: { type: "fraction", value: 0.7 },
        trigger: { type: "fraction", value: 0.85 },
      },
    });

    const handler = (() => {
      let callCount = 0;
      return async () => {
        callCount++;
        return { content: `response ${callCount}` };
      };
    })();

    // Simulate 3 turns (each has user message + AI response)
    for (let i = 0; i < 3; i++) {
      const messages: any[] = [];
      for (let j = 0; j <= i; j++) {
        messages.push(new HumanMessage(`turn ${j}`));
        messages.push(new AIMessage(`response ${j}`));
      }

      await middleware.wrapModelCall!(
        {
          messages,
          configurable: { thread_id: "test-thread" },
        },
        handler,
      );
    }

    // Compaction should NOT have run (only 3 turns, well below 70% threshold)
    expect(compactionRan).toBe(false);
  });
});
