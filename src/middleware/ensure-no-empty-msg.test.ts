import { describe, test, expect } from "bun:test";
import { getEveryMessageSinceLastHuman, AgentState, BaseMessage } from "./ensure-no-empty-msg";

describe("getEveryMessageSinceLastHuman", () => {
  test("returns all messages if there are no human messages", () => {
    const aiMessage: BaseMessage = { type: "ai", content: "hello" };
    const toolMessage: BaseMessage = { type: "tool", name: "my_tool", tool_calls: [] };
    const state: AgentState = {
      messages: [aiMessage, toolMessage],
    };

    const result = getEveryMessageSinceLastHuman(state);

    expect(result).toEqual([aiMessage, toolMessage]);
    expect(result.length).toBe(2);
  });

  test("returns messages after the last human message", () => {
    const humanMessage1: BaseMessage = { type: "human", content: "first human" };
    const aiMessage1: BaseMessage = { type: "ai", content: "first ai" };
    const humanMessage2: BaseMessage = { type: "human", content: "second human" };
    const aiMessage2: BaseMessage = { type: "ai", content: "second ai" };
    const toolMessage: BaseMessage = { type: "tool", name: "tool", tool_calls: [] };

    const state: AgentState = {
      messages: [humanMessage1, aiMessage1, humanMessage2, aiMessage2, toolMessage],
    };

    const result = getEveryMessageSinceLastHuman(state);

    expect(result).toEqual([aiMessage2, toolMessage]);
    expect(result.length).toBe(2);
  });

  test("returns empty array if the last message is a human message", () => {
    const aiMessage: BaseMessage = { type: "ai", content: "hello" };
    const humanMessage: BaseMessage = { type: "human", content: "last human" };

    const state: AgentState = {
      messages: [aiMessage, humanMessage],
    };

    const result = getEveryMessageSinceLastHuman(state);

    expect(result).toEqual([]);
    expect(result.length).toBe(0);
  });

  test("returns empty array if state has no messages", () => {
    const state: AgentState = {
      messages: [],
    };

    const result = getEveryMessageSinceLastHuman(state);

    expect(result).toEqual([]);
    expect(result.length).toBe(0);
  });
});
