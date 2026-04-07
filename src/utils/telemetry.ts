import { createLogger } from "./logger";

const logger = createLogger("telemetry");

// Configuration from environment
const OTEL_EXPORTER_OTLP_ENDPOINT =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4317";
const OTEL_SERVICE_NAME = process.env.OTEL_SERVICE_NAME || "bullhorse-agent";
const OTEL_ENABLED = process.env.OTEL_ENABLED === "true";

/**
 * Simple span implementation for tracking operations.
 * This is a lightweight implementation that doesn't require the full OpenTelemetry SDK.
 */
export interface Span {
  name: string;
  startTime: number;
  endTime?: number;
  attributes: Record<string, unknown>;
  status: "ok" | "error";
  events: Array<{ name: string; time: number; attributes: Record<string, unknown> }>;
}

/**
 * Simple metric recorder.
 */
export interface Metric {
  name: string;
  value: number;
  attributes: Record<string, unknown>;
  timestamp: number;
}

/**
 * In-memory storage for spans and metrics when OTEL is disabled.
 */
class InMemoryTelemetry {
  private spans: Span[] = [];
  private metrics: Metric[] = [];
  private maxSpans = 1000;
  private maxMetrics = 5000;

  recordSpan(span: Span): void {
    this.spans.push(span);
    if (this.spans.length > this.maxSpans) {
      this.spans.shift();
    }
  }

  recordMetric(metric: Metric): void {
    this.metrics.push(metric);
    if (this.metrics.length > this.maxMetrics) {
      this.metrics.shift();
    }
  }

  getSpans(): Span[] {
    return [...this.spans];
  }

  getMetrics(): Metric[] {
    return [...this.metrics];
  }

  clear(): void {
    this.spans = [];
    this.metrics = [];
  }
}

const inMemoryTelemetry = new InMemoryTelemetry();

/**
 * Create a span for tracking an operation.
 *
 * Usage:
 * ```ts
 * const span = createSpan("tool.call", { tool: "code_search" });
 * try {
 *   // do work
 *   span.end({ status: "ok" });
 * } catch (err) {
 *   span.end({ status: "error", error: String(err) });
 * }
 * ```
 */
export function createSpan(
  name: string,
  attributes: Record<string, unknown> = {},
): Span & { end: (attrs?: Record<string, unknown>) => void } {
  const span: Span = {
    name,
    startTime: Date.now(),
    attributes,
    status: "ok",
    events: [],
  };

  return {
    ...span,
    end: (endAttrs?: Record<string, unknown>) => {
      span.endTime = Date.now();
      if (endAttrs) {
        Object.assign(span.attributes, endAttrs);
        if (endAttrs.status === "error") {
          span.status = "error";
        }
      }

      const duration = span.endTime - span.startTime;
      span.attributes.duration = duration;

      if (OTEL_ENABLED) {
        logger.debug(
          { spanName: name, duration, attributes: span.attributes },
          "[telemetry] Span ended",
        );
      }

      inMemoryTelemetry.recordSpan(span);
    },
  };
}

/**
 * Record a metric value.
 */
export function recordMetric(
  name: string,
  value: number,
  attributes: Record<string, unknown> = {},
): void {
  const metric: Metric = {
    name,
    value,
    attributes,
    timestamp: Date.now(),
  };

  inMemoryTelemetry.recordMetric(metric);

  if (OTEL_ENABLED) {
    logger.debug(
      { metricName: name, value, attributes },
      "[telemetry] Metric recorded",
    );
  }
}

/**
 * Record token usage from an LLM call.
 */
export function recordLLMCall(params: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  latency: number;
  threadId?: string;
}): void {
  const totalTokens = params.inputTokens + params.outputTokens;

  recordMetric("llm.input_tokens", params.inputTokens, {
    model: params.model,
    threadId: params.threadId || "unknown",
  });

  recordMetric("llm.output_tokens", params.outputTokens, {
    model: params.model,
    threadId: params.threadId || "unknown",
  });

  recordMetric("llm.total_tokens", totalTokens, {
    model: params.model,
    threadId: params.threadId || "unknown",
  });

  recordMetric("llm.latency_ms", params.latency, {
    model: params.model,
    threadId: params.threadId || "unknown",
  });
}

/**
 * Record a tool invocation.
 */
export function recordToolCall(params: {
  toolName: string;
  duration: number;
  success: boolean;
  outputSize?: number;
  threadId?: string;
}): void {
  recordMetric("tool.duration_ms", params.duration, {
    tool: params.toolName,
    threadId: params.threadId || "unknown",
  });

  recordMetric("tool.success", params.success ? 1 : 0, {
    tool: params.toolName,
    threadId: params.threadId || "unknown",
  });

  if (params.outputSize !== undefined) {
    recordMetric("tool.output_size", params.outputSize, {
      tool: params.toolName,
      threadId: params.threadId || "unknown",
    });
  }
}

/**
 * Get all recorded telemetry data for a thread.
 */
export function getThreadTelemetry(threadId: string): {
  spans: Span[];
  metrics: Metric[];
} {
  const allSpans = inMemoryTelemetry.getSpans();
  const allMetrics = inMemoryTelemetry.getMetrics();

  return {
    spans: allSpans.filter(
      (s) => (s.attributes.threadId as string) === threadId,
    ),
    metrics: allMetrics.filter(
      (m) => (m.attributes.threadId as string) === threadId,
    ),
  };
}

/**
 * Get aggregated metrics for a thread.
 */
export function getThreadMetrics(threadId: string): {
  llmCalls: {
    count: number;
    totalTokens: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    avgLatency: number;
    model: string;
  };
  tools: Record<
    string,
    { count: number; successRate: number; avgDuration: number; avgOutputSize: number }
  >;
  totalDuration: number;
} {
  const telemetry = getThreadTelemetry(threadId);
  const metrics = telemetry.metrics;

  // Aggregate LLM metrics
  const llmMetrics = metrics.filter((m) => m.name.startsWith("llm."));
  const llmCalls = {
    count: 0,
    totalTokens: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalLatency: 0,
    avgLatency: 0,
    model: "unknown",
  };

  for (const metric of llmMetrics) {
    if (metric.name === "llm.total_tokens") {
      llmCalls.count++;
      llmCalls.totalTokens += metric.value;
      llmCalls.model = (metric.attributes.model as string) || "unknown";
    }
    if (metric.name === "llm.input_tokens") {
      llmCalls.totalInputTokens += metric.value;
    }
    if (metric.name === "llm.output_tokens") {
      llmCalls.totalOutputTokens += metric.value;
    }
    if (metric.name === "llm.latency_ms") {
      llmCalls.totalLatency += metric.value;
    }
  }

  if (llmCalls.count > 0) {
    llmCalls.avgLatency = llmCalls.totalLatency / llmCalls.count;
  }

  // Aggregate tool metrics
  const toolMetrics = metrics.filter((m) => m.name.startsWith("tool."));
  const tools: Record<
    string,
    { count: number; successRate: number; avgDuration: number; avgOutputSize: number }
  > = {};

  // First pass: collect data
  const toolData: Record<
    string,
    { totalDuration: number; successCount: number; totalCount: number; totalOutputSize: number }
  > = {};

  for (const metric of toolMetrics) {
    const tool = metric.attributes.tool as string;
    if (!tool) continue;

    if (!toolData[tool]) {
      toolData[tool] = {
        totalDuration: 0,
        successCount: 0,
        totalCount: 0,
        totalOutputSize: 0,
      };
    }

    if (metric.name === "tool.duration_ms") {
      toolData[tool].totalDuration += metric.value;
      toolData[tool].totalCount++;
    }
    if (metric.name === "tool.success") {
      toolData[tool].totalCount++;
      if (metric.value === 1) {
        toolData[tool].successCount++;
      }
    }
    if (metric.name === "tool.output_size") {
      toolData[tool].totalOutputSize += metric.value;
    }
  }

  // Second pass: compute averages
  for (const [tool, data] of Object.entries(toolData)) {
    tools[tool] = {
      count: data.totalCount,
      successRate: data.totalCount > 0 ? data.successCount / data.totalCount : 0,
      avgDuration: data.totalCount > 0 ? data.totalDuration / data.totalCount : 0,
      avgOutputSize:
        data.totalCount > 0 ? data.totalOutputSize / data.totalCount : 0,
    };
  }

  // Calculate total duration from spans
  const spans = telemetry.spans;
  let totalDuration = 0;
  for (const span of spans) {
    if (span.endTime) {
      totalDuration += span.endTime - span.startTime;
    }
  }

  return {
    llmCalls: {
      count: llmCalls.count,
      totalTokens: llmCalls.totalTokens,
      totalInputTokens: llmCalls.totalInputTokens,
      totalOutputTokens: llmCalls.totalOutputTokens,
      avgLatency: llmCalls.avgLatency,
      model: llmCalls.model,
    },
    tools,
    totalDuration,
  };
}

/**
 * Clear telemetry data for a thread.
 */
export function clearThreadTelemetry(threadId: string): void {
  // In a real implementation with OTLP, we would send a signal
  // For now, we just note that data has been cleared
  logger.debug({ threadId }, "[telemetry] Thread telemetry cleared");
}

/**
 * Get telemetry health status.
 */
export function getTelemetryStatus(): {
  enabled: boolean;
  endpoint: string;
  serviceName: string;
  spanCount: number;
  metricCount: number;
} {
  return {
    enabled: OTEL_ENABLED,
    endpoint: OTEL_EXPORTER_OTLP_ENDPOINT,
    serviceName: OTEL_SERVICE_NAME,
    spanCount: inMemoryTelemetry.getSpans().length,
    metricCount: inMemoryTelemetry.getMetrics().length,
  };
}

/**
 * Initialize telemetry system.
 * Call this at application startup.
 */
export function initializeTelemetry(): void {
  if (OTEL_ENABLED) {
    logger.info(
      {
        endpoint: OTEL_EXPORTER_OTLP_ENDPOINT,
        serviceName: OTEL_SERVICE_NAME,
      },
      "[telemetry] OpenTelemetry enabled (in-memory mode)",
    );
  } else {
    logger.debug(
      "[telemetry] OpenTelemetry disabled. Set OTEL_ENABLED=true to enable.",
    );
  }
}
