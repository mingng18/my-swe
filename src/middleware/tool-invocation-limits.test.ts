import { describe, it, expect, beforeEach } from "bun:test";
import { toolInvocationTracker, resetToolInvocationTracker, getTrackerStats } from "./tool-invocation-limits";

describe("Tool Invocation Tracker Utils", () => {
  beforeEach(() => {
    resetToolInvocationTracker();
  });

  describe("resetToolInvocationTracker", () => {
    it("should clear all tracked invocations across all threads", () => {
      // Add invocations to multiple threads
      toolInvocationTracker.trackToolCall("thread1", "toolA", {});
      toolInvocationTracker.trackToolCall("thread1", "toolB", {});
      toolInvocationTracker.trackToolCall("thread2", "toolA", {});

      // Verify stats before reset
      const statsBefore = getTrackerStats();
      expect(statsBefore.totalThreads).toBe(2);
      expect(statsBefore.totalInvocations).toBe(3);

      // Perform reset
      resetToolInvocationTracker();

      // Verify stats after reset
      const statsAfter = getTrackerStats();
      expect(statsAfter.totalThreads).toBe(0);
      expect(statsAfter.totalInvocations).toBe(0);
      expect(statsAfter.invocationsByThread).toEqual({});
      expect(statsAfter.invocationsByTool).toEqual({});
    });
  });

  describe("getTrackerStats", () => {
    it("should return empty stats initially", () => {
      const stats = getTrackerStats();
      expect(stats).toEqual({
        totalThreads: 0,
        totalInvocations: 0,
        invocationsByThread: {},
        invocationsByTool: {},
      });
    });

    it("should return correct stats after tracking calls", () => {
      // Track a few calls
      toolInvocationTracker.trackToolCall("thread1", "toolA", {});
      toolInvocationTracker.trackToolCall("thread1", "toolB", {});
      toolInvocationTracker.trackToolCall("thread1", "toolA", {});
      toolInvocationTracker.trackToolCall("thread2", "toolC", {});

      const stats = getTrackerStats();

      expect(stats.totalThreads).toBe(2);
      expect(stats.totalInvocations).toBe(4);

      expect(stats.invocationsByThread).toEqual({
        thread1: 3,
        thread2: 1,
      });

      expect(stats.invocationsByTool).toEqual({
        toolA: 2,
        toolB: 1,
        toolC: 1,
      });
    });
  });
});
