/**
 * Tests for compact-middleware.
 */

import { describe, it, expect } from "bun:test";
import {
  parseTrigger,
  estimateTokens,
  calculateTokenThreshold,
  shouldTriggerCompaction,
  type TriggerFormat,
} from "./index";
import type { BaseMessage } from "@langchain/core/messages";

describe("compact-middleware config", () => {
  describe("parseTrigger", () => {
    it("should parse token trigger", () => {
      const result = parseTrigger(["tokens", 100000]);
      expect(result).toEqual({ type: "tokens", value: 100000 });
    });

    it("should parse fraction trigger", () => {
      const result = parseTrigger(["fraction", 0.85]);
      expect(result).toEqual({ type: "fraction", value: 0.85 });
    });

    it("should parse messages trigger", () => {
      const result = parseTrigger(["messages", 50]);
      expect(result).toEqual({ type: "messages", value: 50 });
    });
  });
});

describe("compact-middleware tokens", () => {
  describe("estimateTokens", () => {
    it("should estimate tokens for short text", () => {
      const text = "Hello world";
      const tokens = estimateTokens(text);
      expect(tokens).toBe(Math.ceil(text.length / 4));
    });

    it("should estimate tokens for long text", () => {
      const text = "a".repeat(1000);
      const tokens = estimateTokens(text);
      expect(tokens).toBe(250);
    });
  });

  describe("calculateTokenThreshold", () => {
    it("should return absolute value for tokens trigger", () => {
      const trigger: TriggerFormat = { type: "tokens", value: 100000 };
      const threshold = calculateTokenThreshold(trigger, "gpt-4o");
      expect(threshold).toBe(100000);
    });

    it("should calculate fraction of context window", () => {
      const trigger: TriggerFormat = { type: "fraction", value: 0.5 };
      const threshold = calculateTokenThreshold(trigger, "gpt-4o");
      expect(threshold).toBe(64000); // 128000 * 0.5
    });

    it("should use default context size for unknown model", () => {
      const trigger: TriggerFormat = { type: "fraction", value: 0.5 };
      const threshold = calculateTokenThreshold(trigger, "unknown-model");
      expect(threshold).toBe(64000); // 128000 * 0.5
    });
  });

  describe("shouldTriggerCompaction", () => {
    it("should trigger when message count exceeds threshold", () => {
      const trigger: TriggerFormat = { type: "messages", value: 10 };
      const messages: BaseMessage[] = Array.from({ length: 15 }, () => ({
        type: "human" as const,
        content: "test",
      })) as any;
      const shouldTrigger = shouldTriggerCompaction(
        messages,
        trigger,
        "gpt-4o",
      );
      expect(shouldTrigger).toBe(true);
    });

    it("should not trigger when message count below threshold", () => {
      const trigger: TriggerFormat = { type: "messages", value: 10 };
      const messages: BaseMessage[] = Array.from({ length: 5 }, () => ({
        type: "human" as const,
        content: "test",
      })) as any;
      const shouldTrigger = shouldTriggerCompaction(
        messages,
        trigger,
        "gpt-4o",
      );
      expect(shouldTrigger).toBe(false);
    });
  });
});

describe("compact-middleware exports", () => {
  it("should export createCompactionMiddleware", () => {
    const { createCompactionMiddleware } = require("./index");
    expect(typeof createCompactionMiddleware).toBe("function");
  });

  it("should export utility functions", () => {
    const {
      getThreadMetadata,
      cleanupThreadState,
      getAllThreadStates,
    } = require("./index");
    expect(typeof getThreadMetadata).toBe("function");
    expect(typeof cleanupThreadState).toBe("function");
    expect(typeof getAllThreadStates).toBe("function");
  });
});
