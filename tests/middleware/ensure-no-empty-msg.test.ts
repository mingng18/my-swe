import { expect, test, describe } from "bun:test";
import {
  getEveryMessageSinceLastHuman,
  checkIfModelAlreadyCalledCommitAndOpenPr,
  checkIfModelMessagedUser,
  checkIfConfirmingCompletion,
  checkIfNoOp,
  ensureNoEmptyMsg,
  BaseMessage,
  AgentState,
} from "../../src/middleware/ensure-no-empty-msg";

describe("ensure-no-empty-msg middleware", () => {
  describe("getEveryMessageSinceLastHuman", () => {
    test("returns all messages since the last human message", () => {
      const state: AgentState = {
        messages: [
          { type: "system", content: "system prompt" },
          { type: "human", content: "hello" },
          { type: "ai", content: "hi" },
          { type: "human", content: "do task" },
          { type: "ai", content: "working" },
          { type: "tool", name: "some_tool", content: "result" },
        ],
      };
      const result = getEveryMessageSinceLastHuman(state);
      expect(result).toHaveLength(2);
      expect(result[0].content).toBe("working");
      expect(result[1].type).toBe("tool");
    });

    test("returns all messages if no human message exists", () => {
      const state: AgentState = {
        messages: [
          { type: "system", content: "system prompt" },
          { type: "ai", content: "hi" },
        ],
      };
      const result = getEveryMessageSinceLastHuman(state);
      expect(result).toHaveLength(2);
    });
  });

  describe("checkIfModelAlreadyCalledCommitAndOpenPr", () => {
    test("returns true if commit_and_open_pr tool call exists", () => {
      const messages: BaseMessage[] = [
        { type: "ai", content: "working" },
        { type: "tool", name: "commit_and_open_pr", content: "success" },
      ];
      expect(checkIfModelAlreadyCalledCommitAndOpenPr(messages)).toBeTrue();
    });

    test("returns false if commit_and_open_pr tool call does not exist", () => {
      const messages: BaseMessage[] = [
        { type: "ai", content: "working" },
        { type: "tool", name: "some_tool", content: "success" },
      ];
      expect(checkIfModelAlreadyCalledCommitAndOpenPr(messages)).toBeFalse();
    });
  });

  describe("checkIfModelMessagedUser", () => {
    test("returns true if slack_thread_reply tool call exists", () => {
      const messages: BaseMessage[] = [
        { type: "tool", name: "slack_thread_reply", content: "msg" },
      ];
      expect(checkIfModelMessagedUser(messages)).toBeTrue();
    });

    test("returns true if linear_comment tool call exists", () => {
      const messages: BaseMessage[] = [
        { type: "tool", name: "linear_comment", content: "msg" },
      ];
      expect(checkIfModelMessagedUser(messages)).toBeTrue();
    });

    test("returns true if github_comment tool call exists", () => {
      const messages: BaseMessage[] = [
        { type: "tool", name: "github_comment", content: "msg" },
      ];
      expect(checkIfModelMessagedUser(messages)).toBeTrue();
    });

    test("returns false if no communication tool call exists", () => {
      const messages: BaseMessage[] = [
        { type: "tool", name: "other_tool", content: "msg" },
      ];
      expect(checkIfModelMessagedUser(messages)).toBeFalse();
    });
  });

  describe("checkIfConfirmingCompletion", () => {
    test("returns true if confirming_completion tool call exists", () => {
      const messages: BaseMessage[] = [
        { type: "tool", name: "confirming_completion", content: "msg" },
      ];
      expect(checkIfConfirmingCompletion(messages)).toBeTrue();
    });

    test("returns false if confirming_completion tool call does not exist", () => {
      const messages: BaseMessage[] = [
        { type: "tool", name: "other_tool", content: "msg" },
      ];
      expect(checkIfConfirmingCompletion(messages)).toBeFalse();
    });
  });

  describe("checkIfNoOp", () => {
    test("returns true if no_op tool call exists", () => {
      const messages: BaseMessage[] = [
        { type: "tool", name: "no_op", content: "msg" },
      ];
      expect(checkIfNoOp(messages)).toBeTrue();
    });

    test("returns false if no_op tool call does not exist", () => {
      const messages: BaseMessage[] = [
        { type: "tool", name: "other_tool", content: "msg" },
      ];
      expect(checkIfNoOp(messages)).toBeFalse();
    });
  });

  describe("ensureNoEmptyMsg", () => {
    test("returns null if no last message", () => {
      const state: AgentState = { messages: [] };
      expect(ensureNoEmptyMsg(state)).toBeNull();
    });

    test("Case 1: No tool calls and no content -> injects no_op", () => {
      const state: AgentState = {
        messages: [
          { type: "human", content: "do task" },
          { type: "ai", tool_calls: [] }, // Empty message
        ],
      };
      const result = ensureNoEmptyMsg(state);
      expect(result).not.toBeNull();
      expect(result?.messages).toHaveLength(2);
      expect(result?.messages[0].tool_calls?.[0].name).toBe("no_op");
      expect(result?.messages[1].name).toBe("no_op");
    });

    test("Case 1: Returns null if no_op already injected recently", () => {
      const state: AgentState = {
        messages: [
          { type: "human", content: "do task" },
          { type: "tool", name: "no_op", content: "injected earlier" },
          { type: "ai", tool_calls: [] },
        ],
      };
      expect(ensureNoEmptyMsg(state)).toBeNull();
    });

    test("Case 1: Returns null if model already called commit and messaged user", () => {
      const state: AgentState = {
        messages: [
          { type: "human", content: "do task" },
          { type: "tool", name: "commit_and_open_pr", content: "pr" },
          { type: "tool", name: "slack_thread_reply", content: "msg" },
          { type: "ai", tool_calls: [] },
        ],
      };
      expect(ensureNoEmptyMsg(state)).toBeNull();
    });

    test("Case 2: Has content but no tool calls -> injects confirming_completion", () => {
      const state: AgentState = {
        messages: [
          { type: "human", content: "do task" },
          { type: "ai", content: "I am done.", tool_calls: [] },
        ],
      };
      const result = ensureNoEmptyMsg(state);
      expect(result).not.toBeNull();
      expect(result?.messages).toHaveLength(2);
      expect(result?.messages[0].tool_calls?.[0].name).toBe("confirming_completion");
      expect(result?.messages[1].name).toBe("confirming_completion");
    });

    test("Case 2: Returns null if confirming_completion already injected recently", () => {
      const state: AgentState = {
        messages: [
          { type: "human", content: "do task" },
          { type: "tool", name: "confirming_completion", content: "injected earlier" },
          { type: "ai", content: "I am done.", tool_calls: [] },
        ],
      };
      expect(ensureNoEmptyMsg(state)).toBeNull();
    });

    test("Case 2: Returns null if model already called commit", () => {
      const state: AgentState = {
        messages: [
          { type: "human", content: "do task" },
          { type: "tool", name: "commit_and_open_pr", content: "pr" },
          { type: "ai", content: "I am done.", tool_calls: [] },
        ],
      };
      expect(ensureNoEmptyMsg(state)).toBeNull();
    });

    test("Returns null if valid message (tool call + content)", () => {
      const state: AgentState = {
        messages: [
          { type: "human", content: "do task" },
          { type: "ai", content: "working", tool_calls: [{ name: "some_tool", args: {}, id: "1" }] },
        ],
      };
      expect(ensureNoEmptyMsg(state)).toBeNull();
    });
  });

  describe("ensure-no-empty-msg edge cases", () => {
    test("ensureNoEmptyMsg handles text() method on BaseMessage", () => {
      const state: AgentState = {
        messages: [
          { type: "human", content: "do task" },
          { type: "ai", text: () => "I am done via text()", tool_calls: [] },
        ],
      };
      const result = ensureNoEmptyMsg(state);
      expect(result).not.toBeNull(); // Still Case 2
      expect(result?.messages).toHaveLength(2);
      expect(result?.messages[0].tool_calls?.[0].name).toBe("confirming_completion");
    });
  });
});
