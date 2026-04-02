import { describe, expect, test } from "bun:test";
import {
  getEveryMessageSinceLastHuman,
  checkIfModelAlreadyCalledCommitAndOpenPr,
  checkIfModelMessagedUser,
  checkIfConfirmingCompletion,
  checkIfNoOp,
  ensureNoEmptyMsg,
  withEnsureNoEmptyMsg,
  type BaseMessage,
  type AgentState,
} from "./ensure-no-empty-msg";

describe("ensure-no-empty-msg middleware", () => {
  const createHumanMsg = (content = "human"): BaseMessage => ({ type: "human", content });
  const createAiMsg = (content = "ai", tool_calls: any[] = []): BaseMessage => ({ type: "ai", content, tool_calls });
  const createToolMsg = (name: string): BaseMessage => ({ type: "tool", name, tool_calls: [] });

  describe("getEveryMessageSinceLastHuman", () => {
    test("returns all messages if no human message exists", () => {
      const state: AgentState = {
        messages: [createAiMsg(), createToolMsg("test")],
      };
      const result = getEveryMessageSinceLastHuman(state);
      expect(result.length).toBe(2);
    });

    test("returns messages after the last human message", () => {
      const state: AgentState = {
        messages: [
          createHumanMsg("first"),
          createAiMsg(),
          createHumanMsg("last"),
          createToolMsg("after"),
          createAiMsg(),
        ],
      };
      const result = getEveryMessageSinceLastHuman(state);
      expect(result.length).toBe(2);
      expect(result[0].type).toBe("tool");
      expect(result[1].type).toBe("ai");
    });

    test("returns empty array if human message is last", () => {
      const state: AgentState = {
        messages: [createHumanMsg("first"), createAiMsg(), createHumanMsg("last")],
      };
      const result = getEveryMessageSinceLastHuman(state);
      expect(result.length).toBe(0);
    });
  });

  describe("checkIfModelAlreadyCalledCommitAndOpenPr", () => {
    test("returns true when tool was called", () => {
      const msgs: BaseMessage[] = [createToolMsg("commit_and_open_pr")];
      expect(checkIfModelAlreadyCalledCommitAndOpenPr(msgs)).toBe(true);
    });

    test("returns false when tool was not called", () => {
      const msgs: BaseMessage[] = [createToolMsg("other_tool")];
      expect(checkIfModelAlreadyCalledCommitAndOpenPr(msgs)).toBe(false);
    });
  });

  describe("checkIfModelMessagedUser", () => {
    test("returns true for slack_thread_reply", () => {
      expect(checkIfModelMessagedUser([createToolMsg("slack_thread_reply")])).toBe(true);
    });

    test("returns true for linear_comment", () => {
      expect(checkIfModelMessagedUser([createToolMsg("linear_comment")])).toBe(true);
    });

    test("returns true for github_comment", () => {
      expect(checkIfModelMessagedUser([createToolMsg("github_comment")])).toBe(true);
    });

    test("returns false for other tools", () => {
      expect(checkIfModelMessagedUser([createToolMsg("other_tool")])).toBe(false);
    });
  });

  describe("checkIfConfirmingCompletion", () => {
    test("returns true when called", () => {
      expect(checkIfConfirmingCompletion([createToolMsg("confirming_completion")])).toBe(true);
    });

    test("returns false when not called", () => {
      expect(checkIfConfirmingCompletion([createToolMsg("other_tool")])).toBe(false);
    });
  });

  describe("checkIfNoOp", () => {
    test("returns true when called", () => {
      expect(checkIfNoOp([createToolMsg("no_op")])).toBe(true);
    });

    test("returns false when not called", () => {
      expect(checkIfNoOp([createToolMsg("other_tool")])).toBe(false);
    });
  });

  describe("ensureNoEmptyMsg", () => {
    test("returns null for empty messages array", () => {
      const state: AgentState = { messages: [] };
      expect(ensureNoEmptyMsg(state)).toBeNull();
    });

    test("returns null if last message has tool calls", () => {
      const state: AgentState = {
        messages: [
          createAiMsg("content", [{ id: "1", name: "tool", args: {} }]),
        ],
      };
      expect(ensureNoEmptyMsg(state)).toBeNull();
    });

    describe("Case 1: No tool calls and no content", () => {
      test("injects no_op when none exist", () => {
        const lastMsg = createAiMsg("", []); // no content, no tools
        delete lastMsg.content;
        const state: AgentState = { messages: [lastMsg] };

        const result = ensureNoEmptyMsg(state);
        expect(result).not.toBeNull();
        expect(result?.messages.length).toBe(2);

        // First message should be updated lastMsg with no_op tool call
        const updatedLastMsg = result!.messages[0];
        expect(updatedLastMsg.tool_calls?.length).toBe(1);
        expect(updatedLastMsg.tool_calls![0].name).toBe("no_op");

        // Second message should be the tool message
        const injectedToolMsg = result!.messages[1];
        expect(injectedToolMsg.type).toBe("tool");
        expect(injectedToolMsg.name).toBe("no_op");
      });

      test("returns null if no_op was already called since last human", () => {
        const state: AgentState = {
          messages: [
            createHumanMsg(),
            createToolMsg("no_op"),
            createAiMsg("", []) // triggers case 1
          ]
        };
        // Remove content to ensure empty content is evaluated
        delete state.messages[2].content;

        expect(ensureNoEmptyMsg(state)).toBeNull();
      });

      test("returns null if commit AND message user were already called", () => {
        const state: AgentState = {
          messages: [
            createHumanMsg(),
            createToolMsg("commit_and_open_pr"),
            createToolMsg("slack_thread_reply"),
            createAiMsg("", [])
          ]
        };
        delete state.messages[3].content;

        expect(ensureNoEmptyMsg(state)).toBeNull();
      });

      test("injects no_op if ONLY commit was called", () => {
        const state: AgentState = {
          messages: [
            createHumanMsg(),
            createToolMsg("commit_and_open_pr"),
            createAiMsg("", [])
          ]
        };
        delete state.messages[2].content;

        const result = ensureNoEmptyMsg(state);
        expect(result).not.toBeNull();
        expect(result!.messages[1].name).toBe("no_op");
      });
    });

    describe("Case 2: Has content but no tool calls", () => {
      test("injects confirming_completion when none exist", () => {
        const state: AgentState = {
          messages: [createAiMsg("I am done", [])]
        };

        const result = ensureNoEmptyMsg(state);
        expect(result).not.toBeNull();
        expect(result?.messages.length).toBe(2);

        const updatedLastMsg = result!.messages[0];
        expect(updatedLastMsg.tool_calls?.length).toBe(1);
        expect(updatedLastMsg.tool_calls![0].name).toBe("confirming_completion");

        const injectedToolMsg = result!.messages[1];
        expect(injectedToolMsg.type).toBe("tool");
        expect(injectedToolMsg.name).toBe("confirming_completion");
      });

      test("returns null if confirming_completion was already called", () => {
        const state: AgentState = {
          messages: [
            createHumanMsg(),
            createToolMsg("confirming_completion"),
            createAiMsg("Still here", [])
          ]
        };
        expect(ensureNoEmptyMsg(state)).toBeNull();
      });

      test("returns null if commit_and_open_pr was already called", () => {
        const state: AgentState = {
          messages: [
            createHumanMsg(),
            createToolMsg("commit_and_open_pr"),
            createAiMsg("I committed", [])
          ]
        };
        expect(ensureNoEmptyMsg(state)).toBeNull();
      });

      test("returns null if messaged user already", () => {
        const state: AgentState = {
          messages: [
            createHumanMsg(),
            createToolMsg("github_comment"),
            createAiMsg("I commented", [])
          ]
        };
        expect(ensureNoEmptyMsg(state)).toBeNull();
      });
    });
  });

  describe("withEnsureNoEmptyMsg", () => {
    test("returns unmodified result if no intervention needed", async () => {
      const mockState: AgentState = {
        messages: [createAiMsg("content", [{ id: "1", name: "tool", args: {} }])]
      };

      const mockNodeFn = async (state: AgentState) => ({ messages: state.messages });
      const wrappedFn = withEnsureNoEmptyMsg(mockNodeFn);

      const result = await wrappedFn(mockState);
      expect(result.messages).toEqual(mockState.messages);
    });

    test("returns intervened messages if empty message detected", async () => {
      // Create state that triggers Case 2
      const mockState: AgentState = {
        messages: [createAiMsg("content", [])]
      };

      const mockNodeFn = async (state: AgentState) => ({ messages: state.messages });
      const wrappedFn = withEnsureNoEmptyMsg(mockNodeFn);

      const result = await wrappedFn(mockState);
      expect(result.messages?.length).toBe(2);
      expect(result.messages![0].tool_calls![0].name).toBe("confirming_completion");
    });
  });
});
