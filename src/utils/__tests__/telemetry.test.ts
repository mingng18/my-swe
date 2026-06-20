import { describe, expect, it } from "bun:test";
import { getThreadTelemetry, createSpan, recordMetric } from "../telemetry.js";

describe("getThreadTelemetry", () => {
  it("should return empty spans and metrics for an unknown thread", () => {
    const telemetry = getThreadTelemetry("unknown-thread-id");
    expect(telemetry.spans).toBeArray();
    expect(telemetry.spans).toBeEmpty();
    expect(telemetry.metrics).toBeArray();
    expect(telemetry.metrics).toBeEmpty();
  });

  it("should return spans and metrics matching the thread ID", () => {
    const THREAD_ID = "test-thread-123";
    const OTHER_THREAD_ID = "other-thread-456";

    // Create a span
    const span = createSpan("test.span", { threadId: THREAD_ID });
    span.end();

    // Create a metric
    recordMetric("test.metric", 1, { threadId: THREAD_ID });

    // Create span and metric for another thread
    const otherSpan = createSpan("other.span", { threadId: OTHER_THREAD_ID });
    otherSpan.end();
    recordMetric("other.metric", 1, { threadId: OTHER_THREAD_ID });

    const telemetry = getThreadTelemetry(THREAD_ID);

    expect(telemetry.spans).toBeArrayOfSize(1);
    expect(telemetry.spans[0].name).toBe("test.span");
    expect(telemetry.spans[0].attributes.threadId).toBe(THREAD_ID);

    expect(telemetry.metrics).toBeArrayOfSize(1);
    expect(telemetry.metrics[0].name).toBe("test.metric");
    expect(telemetry.metrics[0].attributes.threadId).toBe(THREAD_ID);
  });
});
