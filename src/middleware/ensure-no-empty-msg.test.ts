import { describe, expect, test } from "bun:test";
import {
  getEveryMessageSinceLastHuman,
  type AgentState,
  type BaseMessage,
} from "./ensure-no-empty-msg";

describe("ensure-no-empty-msg", () => {
  describe("getEveryMessageSinceLastHuman", () => {
    test("returns all messages if there are no human messages", () => {
      const state: AgentState = {
        messages: [
          { type: "ai", content: "Hello" },
          { type: "tool", name: "some_tool", tool_calls: [] },
          { type: "ai", content: "World" },
        ],
      };

      const result = getEveryMessageSinceLastHuman(state);
      expect(result).toEqual(state.messages);
      expect(result.length).toBe(3);
    });

    test("returns only messages after the last human message", () => {
      const state: AgentState = {
        messages: [
          { type: "human", content: "First" },
          { type: "ai", content: "Hello" },
          { type: "human", content: "Second" },
          { type: "ai", content: "World" },
          { type: "tool", name: "some_tool", tool_calls: [] },
        ],
      };

      const result = getEveryMessageSinceLastHuman(state);
      expect(result.length).toBe(2);
      expect(result[0].type).toBe("ai");
      expect(result[0].content).toBe("World");
      expect(result[1].type).toBe("tool");
    });

    test("returns an empty array if the last message is a human message", () => {
      const state: AgentState = {
        messages: [
          { type: "ai", content: "Hello" },
          { type: "human", content: "Last human" },
        ],
      };

      const result = getEveryMessageSinceLastHuman(state);
      expect(result).toEqual([]);
      expect(result.length).toBe(0);
    });

    test("returns an empty array if there are no messages", () => {
      const state: AgentState = {
        messages: [],
      };

      const result = getEveryMessageSinceLastHuman(state);
      expect(result).toEqual([]);
      expect(result.length).toBe(0);
    });
  });
});
