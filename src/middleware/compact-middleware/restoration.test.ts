import { describe, it, expect } from "bun:test";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import {
  extractFileReferences,
  extractPlanReferences,
  createFileRestorationMessages,
  calculateRestorationBudget,
  createPlanRestorationMessage,
  applyRestoration,
  getRestorationSummary
} from "./restoration";
import { DEFAULT_COMPACTION_CONFIG } from "./config";

describe("restoration", () => {
  describe("extractFileReferences", () => {
    it("should extract paths from tool_calls", () => {
      const messages = [
        new AIMessage({
          content: "",
          tool_calls: [
            { name: "read_file", args: { path: "src/a.ts" }, id: "c1", type: "tool_call" },
            { name: "edit_file", args: { file_path: "src/b.ts" }, id: "c2", type: "tool_call" }
          ]
        })
      ];
      const refs = extractFileReferences(messages);
      expect(refs.map(r => r.path)).toEqual(["src/a.ts", "src/b.ts"]);
    });

    it("should extract paths from tool results", () => {
      const messages = [
        new ToolMessage({
          content: "src/c.ts",
          name: "read_file",
          tool_call_id: "c1"
        })
      ];
      const refs = extractFileReferences(messages);
      expect(refs.map(r => r.path)).toEqual(["src/c.ts"]);
    });

    it("should ignore duplicates", () => {
      const messages = [
        new AIMessage({
          content: "",
          tool_calls: [
            { name: "read_file", args: { path: "src/a.ts" }, id: "c1", type: "tool_call" },
            { name: "read_file", args: { path: "src/a.ts" }, id: "c2", type: "tool_call" }
          ]
        })
      ];
      const refs = extractFileReferences(messages);
      expect(refs.map(r => r.path)).toEqual(["src/a.ts"]);
    });
  });

  describe("extractPlanReferences", () => {
    it("should extract plans from system messages", () => {
      const messages = [
        new SystemMessage("## Plan\n1. Do A")
      ];
      const plans = extractPlanReferences(messages);
      expect(plans.length).toBe(1);
      expect(plans[0].content).toContain("## Plan");
    });

    it("should extract plans from AI messages", () => {
      const longMessage = "This is a long message ".repeat(10) + "## Task list\n- [ ] Task 1";
      const messages = [
        new AIMessage({ content: longMessage })
      ];
      const plans = extractPlanReferences(messages);
      expect(plans.length).toBe(1);
      expect(plans[0].content).toContain("## Task list");
    });
  });

  describe("createFileRestorationMessages", () => {
    it("should create tool result messages with file content", () => {
      const files = [{ path: "a.ts", content: "file content" }];
      const messages = createFileRestorationMessages(files, DEFAULT_COMPACTION_CONFIG.restoration);

      expect(messages.length).toBe(1);
      expect(messages[0].type).toBe("tool");
      expect(messages[0].content).toBe("file content");
    });

    it("should truncate long files", () => {
      const files = [{ path: "a.ts", content: "a".repeat(15000) }];
      const config = { ...DEFAULT_COMPACTION_CONFIG.restoration, perFileChars: 10000 };
      const messages = createFileRestorationMessages(files, config);

      expect(messages[0].content.length).toBeLessThan(15000);
      expect(messages[0].content).toContain("truncated");
    });
  });

  describe("calculateRestorationBudget", () => {
    it("should limit max files and estimated chars", () => {
      const files = Array.from({ length: 10 }, (_, i) => ({ path: `f${i}.ts`, index: i, timestamp: Date.now() }));
      const config = { ...DEFAULT_COMPACTION_CONFIG.restoration, maxFiles: 5, perFileChars: 10000, fileBudgetChars: 30000 };
      const budget = calculateRestorationBudget(files, config);

      expect(budget.files.length).toBe(5);
      expect(budget.estimatedChars).toBe(30000); // Math.min(5 * 10000, 30000)
    });
  });

  describe("createPlanRestorationMessage", () => {
    it("should wrap plan content in a system message", () => {
      const plan = { content: "Plan content", index: 0 };
      const message = createPlanRestorationMessage(plan);

      expect(message.type).toBe("system");
      expect(message.content).toContain("[Active Plan Restored]");
      expect(message.content).toContain("Plan content");
    });
  });

  describe("getRestorationSummary", () => {
    it("should return empty string if nothing restored", () => {
      expect(getRestorationSummary([], false)).toBe("");
    });

    it("should format files and plan", () => {
      const summary = getRestorationSummary(["a.ts", "b.ts"], true);
      expect(summary).toContain("Restored 2 files: a.ts, b.ts");
      expect(summary).toContain("Restored active plan state");
    });
  });

  describe("applyRestoration", () => {
    it("should return the same messages if restoration is disabled", () => {
      const messages = [new HumanMessage("hello")];
      const result = applyRestoration(messages, { enabled: false });

      expect(result.messages).toEqual(messages);
      expect(result.restoredFiles).toEqual([]);
      expect(result.restoredPlan).toBe(false);
    });

    it("should restore files", () => {
      const config = DEFAULT_COMPACTION_CONFIG.restoration;

      const aiMessage = new AIMessage({
        content: "",
        tool_calls: [
          {
            name: "read_file",
            args: { path: "src/file1.ts" },
            id: "call_1",
            type: "tool_call"
          }
        ]
      });

      const messages = [aiMessage];
      const result = applyRestoration(messages, config);

      expect(result.messages.length).toBe(2);
      expect(result.messages[0]).toBe(aiMessage);
      expect(result.messages[1].type).toBe("tool");
      expect(result.messages[1].content).toContain("src/file1.ts");
      expect(result.restoredFiles).toEqual(["src/file1.ts"]);
    });

    it("should restore plans", () => {
      const config = { ...DEFAULT_COMPACTION_CONFIG.restoration, restorePlans: true };

      const systemMessage = new SystemMessage("## Plan\n1. Do this");
      const messages = [systemMessage];
      const result = applyRestoration(messages, config);

      expect(result.messages.length).toBe(2);
      expect(result.messages[0]).toBe(systemMessage);
      expect(result.messages[1].type).toBe("system");
      expect(result.messages[1].content).toContain("## Plan");
      expect(result.restoredPlan).toBe(true);
    });

    it("should handle missing config gracefully", () => {
      const messages = [new HumanMessage("test")];
      const result = applyRestoration(messages, { enabled: true });

      expect(result.messages).toEqual(messages);
      expect(result.restoredFiles).toEqual([]);
      expect(result.restoredPlan).toBe(false);
    });
  });
});
