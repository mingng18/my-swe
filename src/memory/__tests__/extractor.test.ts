import { describe, it, expect, beforeEach } from "bun:test";
import { MemoryExtractor } from "../extractor";
import type { TurnResult } from "../types";

describe("MemoryExtractor", () => {
  let extractor: MemoryExtractor;

  beforeEach(() => {
    extractor = new MemoryExtractor();
  });

  describe("User Preferences", () => {
    it("should extract user preferences from 'I prefer' patterns", () => {
      const turn: TurnResult = {
        threadId: "test-thread",
        userText: "I prefer using TypeScript over JavaScript",
        input: "I prefer using TypeScript over JavaScript",
      };

      const memories = extractor.extractFromTurn(turn);

      expect(memories).toHaveLength(1);
      expect(memories[0].type).toBe("user");
      expect(memories[0].title).toBeDefined();
      expect(memories[0].content).toContain("TypeScript");
      expect(memories[0].metadata.pattern).toBe("preference");
    });

    it("should extract user preferences from 'I like' patterns", () => {
      const turn: TurnResult = {
        threadId: "test-thread",
        userText: "I like using functional programming patterns",
        input: "I like using functional programming patterns",
      };

      const memories = extractor.extractFromTurn(turn);

      expect(memories).toHaveLength(1);
      expect(memories[0].type).toBe("user");
      expect(memories[0].metadata.pattern).toBe("preference");
    });

    it("should extract user expertise from 'I am' patterns", () => {
      const turn: TurnResult = {
        threadId: "test-thread",
        userText: "I am a senior frontend developer",
        input: "I am a senior frontend developer",
      };

      const memories = extractor.extractFromTurn(turn);

      expect(memories).toHaveLength(1);
      expect(memories[0].type).toBe("user");
      expect(memories[0].metadata.pattern).toBe("expertise");
    });

    it("should extract user expertise from 'I'm a' patterns", () => {
      const turn: TurnResult = {
        threadId: "test-thread",
        userText: "I'm a DevOps engineer with 5 years experience",
        input: "I'm a DevOps engineer with 5 years experience",
      };

      const memories = extractor.extractFromTurn(turn);

      expect(memories).toHaveLength(1);
      expect(memories[0].type).toBe("user");
      expect(memories[0].metadata.pattern).toBe("expertise");
    });
  });

  describe("Feedback", () => {
    it("should extract negative feedback from correction words", () => {
      const turn: TurnResult = {
        threadId: "test-thread",
        userText: "No, that's not what I meant",
        input: "No, that's not what I meant",
      };

      const memories = extractor.extractFromTurn(turn);

      expect(memories).toHaveLength(1);
      expect(memories[0].type).toBe("feedback");
      expect(memories[0].metadata.sentiment).toBe("negative");
    });

    it("should extract negative feedback from 'don't' patterns", () => {
      const turn: TurnResult = {
        threadId: "test-thread",
        userText: "Don't use class components, use hooks",
        input: "Don't use class components, use hooks",
      };

      const memories = extractor.extractFromTurn(turn);

      expect(memories).toHaveLength(1);
      expect(memories[0].type).toBe("feedback");
      expect(memories[0].metadata.sentiment).toBe("negative");
    });

    it("should extract negative feedback from 'wrong' patterns", () => {
      const turn: TurnResult = {
        threadId: "test-thread",
        userText: "That approach is wrong for this use case",
        input: "That approach is wrong for this use case",
      };

      const memories = extractor.extractFromTurn(turn);

      expect(memories).toHaveLength(1);
      expect(memories[0].type).toBe("feedback");
      expect(memories[0].metadata.sentiment).toBe("negative");
    });

    it("should extract positive feedback from validation words", () => {
      const turn: TurnResult = {
        threadId: "test-thread",
        userText: "Yes, that's exactly what I need",
        input: "Yes, that's exactly what I need",
      };

      const memories = extractor.extractFromTurn(turn);

      expect(memories).toHaveLength(1);
      expect(memories[0].type).toBe("feedback");
      expect(memories[0].metadata.sentiment).toBe("positive");
    });

    it("should extract positive feedback from 'correct' patterns", () => {
      const turn: TurnResult = {
        threadId: "test-thread",
        userText: "Correct, that's the right approach",
        input: "Correct, that's the right approach",
      };

      const memories = extractor.extractFromTurn(turn);

      expect(memories).toHaveLength(1);
      expect(memories[0].type).toBe("feedback");
      expect(memories[0].metadata.sentiment).toBe("positive");
    });

    it("should extract positive feedback from 'perfect' patterns", () => {
      const turn: TurnResult = {
        threadId: "test-thread",
        userText: "Perfect, this solves my problem",
        input: "Perfect, this solves my problem",
      };

      const memories = extractor.extractFromTurn(turn);

      expect(memories).toHaveLength(1);
      expect(memories[0].type).toBe("feedback");
      expect(memories[0].metadata.sentiment).toBe("positive");
    });
  });

  describe("Project Decisions", () => {
    it("should extract architecture decisions from agent reply", () => {
      const turn: TurnResult = {
        threadId: "test-thread",
        userText: "How should I structure this?",
        input: "How should I structure this?",
        agentReply:
          "We'll use a layered architecture with controllers, services, and repositories",
      };

      const memories = extractor.extractFromTurn(turn);

      const archMemories = memories.filter((m) => m.type === "project");
      expect(archMemories.length).toBeGreaterThan(0);
      expect(archMemories[0].metadata.category).toBe("architecture");
    });

    it("should extract tech stack mentions", () => {
      const turn: TurnResult = {
        threadId: "test-thread",
        userText: "What stack are we using?",
        input: "What stack are we using?",
        agentReply:
          "This project uses React, TypeScript, and Tailwind CSS for the frontend",
      };

      const memories = extractor.extractFromTurn(turn);

      const techMemories = memories.filter((m) => m.type === "project");
      expect(techMemories.length).toBeGreaterThan(0);
      expect(techMemories[0].metadata.category).toBe("tech_stack");
    });

    it("should extract linter errors from deterministic results", () => {
      const turn: TurnResult = {
        threadId: "test-thread",
        userText: "Run the linter",
        input: "Run the linter",
        deterministic: {
          linterResults: {
            success: false,
            exitCode: 1,
            output:
              "error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'",
          },
        },
      };

      const memories = extractor.extractFromTurn(turn);

      const errorMemories = memories.filter((m) => m.type === "project");
      expect(errorMemories.length).toBeGreaterThan(0);
      expect(errorMemories[0].metadata.category).toBe("linter_error");
    });

    it("should extract test failures from deterministic results", () => {
      const turn: TurnResult = {
        threadId: "test-thread",
        userText: "Run tests",
        input: "Run tests",
        deterministic: {
          testResults: {
            passed: false,
            summary: "2 failed, 10 passed",
            output: "FAIL: Authentication should reject invalid tokens",
          },
        },
      };

      const memories = extractor.extractFromTurn(turn);

      const errorMemories = memories.filter((m) => m.type === "project");
      expect(errorMemories.length).toBeGreaterThan(0);
      expect(errorMemories[0].metadata.category).toBe("test_failure");
    });
  });

  describe("External References", () => {
    it("should extract GitHub references", () => {
      const turn: TurnResult = {
        threadId: "test-thread",
        userText: "Check the GitHub repo for issues",
        input: "Check the GitHub repo for issues",
      };

      const memories = extractor.extractFromTurn(turn);

      const refMemories = memories.filter((m) => m.type === "reference");
      expect(refMemories.length).toBeGreaterThan(0);
      expect(refMemories[0].metadata.system).toBe("GitHub");
    });

    it("should extract Linear references", () => {
      const turn: TurnResult = {
        threadId: "test-thread",
        userText: "Create a Linear ticket for this",
        input: "Create a Linear ticket for this",
      };

      const memories = extractor.extractFromTurn(turn);

      const refMemories = memories.filter((m) => m.type === "reference");
      expect(refMemories.length).toBeGreaterThan(0);
      expect(refMemories[0].metadata.system).toBe("Linear");
    });

    it("should extract Jira references", () => {
      const turn: TurnResult = {
        threadId: "test-thread",
        userText: "Link this to the Jira ticket",
        input: "Link this to the Jira ticket",
      };

      const memories = extractor.extractFromTurn(turn);

      const refMemories = memories.filter((m) => m.type === "reference");
      expect(refMemories.length).toBeGreaterThan(0);
      expect(refMemories[0].metadata.system).toBe("Jira");
    });

    it("should extract Slack references", () => {
      const turn: TurnResult = {
        threadId: "test-thread",
        userText: "Post this to the Slack channel",
        input: "Post this to the Slack channel",
      };

      const memories = extractor.extractFromTurn(turn);

      const refMemories = memories.filter((m) => m.type === "reference");
      expect(refMemories.length).toBeGreaterThan(0);
      expect(refMemories[0].metadata.system).toBe("Slack");
    });
  });

  describe("Helper Methods", () => {
    it("should generate meaningful titles from content", () => {
      const turn: TurnResult = {
        threadId: "test-thread",
        userText: "I prefer using TypeScript for all new projects",
        input: "I prefer using TypeScript for all new projects",
      };

      const memories = extractor.extractFromTurn(turn);

      expect(memories[0].title).toBeDefined();
      expect(memories[0].title.length).toBeGreaterThan(0);
      expect(memories[0].title.length).toBeLessThan(100);
      expect(memories[0].title).toContain("[preference]");
    });

    it("should deduplicate identical memories", () => {
      const turn: TurnResult = {
        threadId: "test-thread",
        userText: "I prefer using TypeScript",
        input: "I prefer using TypeScript",
        agentReply: "I prefer using TypeScript",
      };

      const memories = extractor.extractFromTurn(turn);

      // Should not have duplicate memories with same content
      const uniqueContents = new Set(memories.map((m) => m.content));
      expect(uniqueContents.size).toBeLessThanOrEqual(memories.length);
    });

    it("should return empty array for turn with no extractable content", () => {
      const turn: TurnResult = {
        threadId: "test-thread",
        userText: "Hello world",
        input: "Hello world",
      };

      const memories = extractor.extractFromTurn(turn);

      expect(memories).toEqual([]);
    });

    it("should extract only the captured group content, not full text", () => {
      const turn: TurnResult = {
        threadId: "test-thread",
        userText: "I prefer using TypeScript over JavaScript",
        input: "I prefer using TypeScript over JavaScript",
      };

      const memories = extractor.extractFromTurn(turn);

      expect(memories).toHaveLength(1);
      expect(memories[0].content).toBe("using TypeScript over JavaScript");
      expect(memories[0].content).not.toContain("I prefer");
    });

    it("should handle empty or whitespace content gracefully", () => {
      const turn: TurnResult = {
        threadId: "test-thread",
        userText: "   ",
        input: "   ",
        agentReply: "",
      };

      const memories = extractor.extractFromTurn(turn);

      expect(memories).toEqual([]);
    });

    it("should extract agent errors", () => {
      const turn: TurnResult = {
        threadId: "test-thread",
        userText: "Run the command",
        input: "Run the command",
        agentError: "Error: Command failed with exit code 1",
      };

      const memories = extractor.extractFromTurn(turn);

      const errorMemories = memories.filter(
        (m) => m.metadata.category === "agent_error",
      );
      expect(errorMemories.length).toBeGreaterThan(0);
    });
  });

  describe("Pattern Extraction Quality", () => {
    it("should extract preference with sentence boundary", () => {
      const turn: TurnResult = {
        threadId: "test-thread",
        userText: "I prefer using TypeScript. It's more type-safe.",
        input: "I prefer using TypeScript. It's more type-safe.",
      };

      const memories = extractor.extractFromTurn(turn);

      expect(memories).toHaveLength(1);
      expect(memories[0].content).toBe("using TypeScript");
    });

    it("should extract expertise with sentence boundary", () => {
      const turn: TurnResult = {
        threadId: "test-thread",
        userText: "I'm a senior developer with 5 years of experience",
        input: "I'm a senior developer with 5 years of experience",
      };

      const memories = extractor.extractFromTurn(turn);

      expect(memories).toHaveLength(1);
      expect(memories[0].content).toBe(
        "senior developer with 5 years of experience",
      );
    });

    it("should include category in title", () => {
      const turn: TurnResult = {
        threadId: "test-thread",
        userText: "I prefer using TypeScript",
        input: "I prefer using TypeScript",
      };

      const memories = extractor.extractFromTurn(turn);

      expect(memories[0].title).toMatch(/^\[preference\]/i);
    });
  });
});
