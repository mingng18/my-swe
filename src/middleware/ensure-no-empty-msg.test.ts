import { describe, it, expect } from "bun:test";
import { ensureNoEmptyMsg, AgentState, BaseMessage } from "./ensure-no-empty-msg";

describe("ensureNoEmptyMsg", () => {
  it("should return null when there are no messages", () => {
    const state: AgentState = { messages: [] };
    expect(ensureNoEmptyMsg(state)).toBeNull();
  });

  it("should return null when the last message has both tool calls and content", () => {
    const state: AgentState = {
      messages: [
        { type: "ai", content: "Here is the result.", tool_calls: [{ name: "my_tool", args: {}, id: "1" }] },
      ],
    };
    expect(ensureNoEmptyMsg(state)).toBeNull();
  });

  describe("Case 1: No tool calls and no content", () => {
    it("should inject no_op tool call and message", () => {
      const state: AgentState = {
        messages: [{ type: "ai", content: "", tool_calls: [] }],
      };
      const result = ensureNoEmptyMsg(state);
      expect(result).not.toBeNull();
      expect(result?.messages.length).toBe(2);
      expect(result?.messages[0].tool_calls?.[0].name).toBe("no_op");
      expect(result?.messages[1].name).toBe("no_op");
    });

    it("should return null if previous messages since last human message contain a no_op tool call", () => {
      const state: AgentState = {
        messages: [
          { type: "human", content: "do something" },
          { type: "tool", name: "no_op", tool_calls: [] },
          { type: "ai", content: "", tool_calls: [] },
        ],
      };
      expect(ensureNoEmptyMsg(state)).toBeNull();
    });

    it("should return null if previous messages contain both commit_and_open_pr and a communication tool", () => {
      const state: AgentState = {
        messages: [
          { type: "human", content: "do something" },
          { type: "tool", name: "commit_and_open_pr", tool_calls: [] },
          { type: "tool", name: "slack_thread_reply", tool_calls: [] },
          { type: "ai", content: "", tool_calls: [] },
        ],
      };
      expect(ensureNoEmptyMsg(state)).toBeNull();
    });

    it("should inject no_op if only commit_and_open_pr is present", () => {
      const state: AgentState = {
        messages: [
          { type: "human", content: "do something" },
          { type: "tool", name: "commit_and_open_pr", tool_calls: [] },
          { type: "ai", content: "", tool_calls: [] },
        ],
      };
      expect(ensureNoEmptyMsg(state)).not.toBeNull();
    });
  });

  describe("Case 2: Has content but no tool calls", () => {
    it("should inject confirming_completion tool call and message", () => {
      const state: AgentState = {
        messages: [{ type: "ai", content: "I am thinking...", tool_calls: [] }],
      };
      const result = ensureNoEmptyMsg(state);
      expect(result).not.toBeNull();
      expect(result?.messages.length).toBe(2);
      expect(result?.messages[0].tool_calls?.[0].name).toBe("confirming_completion");
      expect(result?.messages[1].name).toBe("confirming_completion");
    });

    it("should return null if previous messages contain commit_and_open_pr", () => {
      const state: AgentState = {
        messages: [
          { type: "human", content: "do something" },
          { type: "tool", name: "commit_and_open_pr", tool_calls: [] },
          { type: "ai", content: "I finished.", tool_calls: [] },
        ],
      };
      expect(ensureNoEmptyMsg(state)).toBeNull();
    });

    it("should return null if previous messages contain a communication tool", () => {
      const state: AgentState = {
        messages: [
          { type: "human", content: "do something" },
          { type: "tool", name: "github_comment", tool_calls: [] },
          { type: "ai", content: "I told the user.", tool_calls: [] },
        ],
      };
      expect(ensureNoEmptyMsg(state)).toBeNull();
    });

    it("should return null if previous messages contain confirming_completion", () => {
      const state: AgentState = {
        messages: [
          { type: "human", content: "do something" },
          { type: "tool", name: "confirming_completion", tool_calls: [] },
          { type: "ai", content: "I am really done.", tool_calls: [] },
        ],
      };
      expect(ensureNoEmptyMsg(state)).toBeNull();
    });
  });
});
