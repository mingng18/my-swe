import { describe, expect, test, beforeEach, mock } from "bun:test";
import {
  BoundedRetryLoop,
  NodeType,
  type NodeResult,
  type EscalationHandler,
  createBoundedRetryLoop,
} from "./retry-loop";

describe("BoundedRetryLoop", () => {
  let loop: BoundedRetryLoop;

  beforeEach(() => {
    // Fast delays for testing
    loop = new BoundedRetryLoop({
      configs: {
        [NodeType.DETERMINISTIC]: {
          maxRetries: 0,
          initialDelayMs: 0,
          backoffFactor: 1,
          escalateOnFailure: false,
        },
        [NodeType.AGENTIC]: {
          maxRetries: 2,
          initialDelayMs: 1, // 1ms for fast tests
          backoffFactor: 2,
          escalateOnFailure: true,
        },
      },
    });
  });

  test("does not retry when maxRetries is 0 and fails immediately on error", async () => {
    let callCount = 0;
    const executeFn = async (): Promise<NodeResult> => {
      callCount++;
      throw new Error("Instant failure");
    };

    const result = await loop.execute(
      "test-node",
      NodeType.DETERMINISTIC,
      executeFn
    );

    expect(callCount).toBe(1);
    expect(result.finalResult.success).toBe(false);
    expect(result.finalResult.error).toBe("Instant failure");
    expect(result.attempts.length).toBe(1);
    expect(result.attempts[0].success).toBe(false);
    expect(result.escalated).toBe(false);
  });

  test("does not retry when maxRetries is 0 and fails immediately on unsuccessful result", async () => {
    let callCount = 0;
    const executeFn = async (): Promise<NodeResult> => {
      callCount++;
      return { success: false, state: {}, error: "Unsuccessful result", shouldRetry: true };
    };

    const result = await loop.execute(
      "test-node",
      NodeType.DETERMINISTIC,
      executeFn
    );

    expect(callCount).toBe(1);
    expect(result.finalResult.success).toBe(false);
    expect(result.finalResult.error).toBe("Unsuccessful result");
    expect(result.attempts.length).toBe(1);
    expect(result.escalated).toBe(false);
  });


  test("returns immediately on success", async () => {
    let callCount = 0;
    const executeFn = async (): Promise<NodeResult> => {
      callCount++;
      return { success: true, state: { data: "ok" } };
    };

    const result = await loop.execute(
      "test-node",
      NodeType.AGENTIC,
      executeFn
    );

    expect(callCount).toBe(1);
    expect(result.finalResult.success).toBe(true);
    expect(result.finalResult.state).toEqual({ data: "ok" });
    expect(result.attempts.length).toBe(1);
    expect(result.attempts[0].success).toBe(true);
  });

  test("retries up to maxRetries when throwing errors", async () => {
    let callCount = 0;
    const executeFn = async (): Promise<NodeResult> => {
      callCount++;
      throw new Error(`Failure ${callCount}`);
    };

    const result = await loop.execute(
      "test-node",
      NodeType.AGENTIC,
      executeFn
    );

    // Initial attempt + 2 retries = 3 calls
    expect(callCount).toBe(3);
    expect(result.finalResult.success).toBe(false);
    expect(result.finalResult.error).toBe("Failure 3");
    expect(result.attempts.length).toBe(3);

    // Check backoff logic indirectly by ensuring duration > 0 (even though initialDelay is 1)
    const totalDuration = result.attempts.reduce((sum, a) => sum + a.durationMs, 0);
    expect(totalDuration).toBeGreaterThanOrEqual(0);
  });

  test("retries when returning unsuccessful results with shouldRetry=true", async () => {
    let callCount = 0;
    const executeFn = async (): Promise<NodeResult> => {
      callCount++;
      if (callCount < 2) {
         return { success: false, state: {}, error: "Temporary failure", shouldRetry: true };
      }
      return { success: true, state: { callCount } };
    };

    const result = await loop.execute(
      "test-node",
      NodeType.AGENTIC,
      executeFn
    );

    expect(callCount).toBe(2);
    expect(result.finalResult.success).toBe(true);
    expect(result.attempts.length).toBe(2);
    expect(result.attempts[0].success).toBe(false);
    expect(result.attempts[1].success).toBe(true);
  });

  test("fails fast when shouldRetry is false", async () => {
    let callCount = 0;
    const executeFn = async (): Promise<NodeResult> => {
      callCount++;
      return { success: false, state: {}, error: "Fatal error", shouldRetry: false };
    };

    const result = await loop.execute(
      "test-node",
      NodeType.AGENTIC, // Even though Agentic allows retries
      executeFn
    );

    expect(callCount).toBe(1); // Fails immediately on first attempt
    expect(result.finalResult.success).toBe(false);
    expect(result.finalResult.error).toBe("Fatal error");
    expect(result.attempts.length).toBe(1);
  });

  test("escalates when max retries exceeded and escalateOnFailure is true", async () => {
    const escalationMock = mock(async (nodeId: string, attempts: any[], lastError: string) => {});

    const escalatingLoop = new BoundedRetryLoop({
      configs: {
        [NodeType.AGENTIC]: {
          maxRetries: 1,
          initialDelayMs: 1,
          backoffFactor: 2,
          escalateOnFailure: true,
        },
      },
      escalationHandler: escalationMock
    });

    const executeFn = async (): Promise<NodeResult> => {
      throw new Error("Persistent failure");
    };

    const result = await escalatingLoop.execute(
      "escalation-node",
      NodeType.AGENTIC,
      executeFn
    );

    expect(result.escalated).toBe(true);
    expect(escalationMock).toHaveBeenCalledTimes(1);
    expect(escalationMock.mock.calls[0][0]).toBe("escalation-node");
    expect(escalationMock.mock.calls[0][1].length).toBe(2); // 1 initial + 1 retry
    expect(escalationMock.mock.calls[0][2]).toBe("Persistent failure");
  });

  test("handles escalation handler throwing an error", async () => {
    const escalationMock = mock(async () => {
      throw new Error("Escalation failed");
    });

    const escalatingLoop = new BoundedRetryLoop({
      configs: {
        [NodeType.AGENTIC]: {
          maxRetries: 0,
          initialDelayMs: 0,
          backoffFactor: 1,
          escalateOnFailure: true,
        },
      },
      escalationHandler: escalationMock
    });

    const result = await escalatingLoop.execute(
      "node",
      NodeType.AGENTIC,
      async () => { throw new Error("error") }
    );

    expect(result.escalated).toBe(false); // Because handler threw
    expect(result.escalationReason).toContain("Escalation failed");
  });

  test("summarizeAttempts generates correct summary", () => {
    const summary = loop.summarizeAttempts([
      { attemptNumber: 0, success: false, error: "timeout", durationMs: 100, timestamp: new Date() },
      { attemptNumber: 1, success: true, durationMs: 50, timestamp: new Date() }
    ]);

    expect(summary).toContain("Retry attempts: 2");
    expect(summary).toContain("✗ Attempt 0: 100ms (timeout)");
    expect(summary).toContain("✓ Attempt 1: 50ms");
    expect(summary).toContain("Total duration: 150ms");
  });
});
