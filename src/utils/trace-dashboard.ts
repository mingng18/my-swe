import { createLogger } from "./logger";
import { getThreadTelemetry, getThreadMetrics } from "./telemetry";
import { getTokenUsage } from "./token-tracker";

const logger = createLogger("trace-dashboard");

/**
 * Generate HTML for trace analysis dashboard.
 */
export function generateTraceDashboardHTML(threadId: string): string {
  const telemetry = getThreadTelemetry(threadId);
  const metrics = getThreadMetrics(threadId);
  const tokenUsage = getTokenUsage(threadId);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Trace Dashboard - ${threadId}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #1a1a2e; color: #eee; line-height: 1.6; }
    .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
    h1 { font-size: 1.8rem; margin-bottom: 20px; color: #4ade80; }
    h2 { font-size: 1.3rem; margin: 30px 0 15px; color: #60a5fa; border-bottom: 1px solid #333; padding-bottom: 8px; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px; }
    .stat-card { background: #16213e; padding: 15px; border-radius: 8px; border: 1px solid #334155; }
    .stat-label { font-size: 0.85rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
    .stat-value { font-size: 1.8rem; font-weight: 700; color: #f8fafc; margin-top: 5px; }
    .stat-value.success { color: #4ade80; }
    .stat-value.warning { color: #fbbf24; }
    .stat-value.error { color: #f87171; }
    .table-container { background: #16213e; border-radius: 8px; overflow: hidden; border: 1px solid #334155; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #1e293b; padding: 12px 15px; text-align: left; font-weight: 600; color: #94a3b8; font-size: 0.85rem; }
    td { padding: 12px 15px; border-bottom: 1px solid #334155; }
    tr:last-child td { border-bottom: none; }
    tr:hover { background: #1e293b; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; }
    .badge.success { background: #166534; color: #86efac; }
    .badge.error { background: #991b1b; color: #fca5a5; }
    .badge.warning { background: #92400e; color: #fcd34d; }
    .progress-bar { height: 6px; background: #334155; border-radius: 3px; overflow: hidden; margin-top: 8px; }
    .progress-fill { height: 100%; background: linear-gradient(90deg, #4ade80, #60a5fa); transition: width 0.3s; }
    .metric-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .metric-name { font-size: 0.9rem; }
    .metric-value { font-weight: 600; }
    .timeline-item { padding: 10px 15px; border-left: 3px solid #334155; margin-left: 10px; position: relative; }
    .timeline-item::before { content: ''; position: absolute; left: -7px; top: 15px; width: 11px; height: 11px; background: #60a5fa; border-radius: 50%; }
    .timeline-item.error { border-left-color: #f87171; }
    .timeline-item.error::before { background: #f87171; }
    .timestamp { font-size: 0.8rem; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔍 Trace Dashboard</h1>
    <p style="color: #94a3b8; margin-bottom: 20px;">Thread ID: <code style="background: #334155; padding: 4px 8px; border-radius: 4px;">${threadId}</code></p>

    <h2>📊 Token Usage</h2>
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Total Tokens</div>
        <div class="stat-value">${tokenUsage?.totalTokens.toLocaleString() || 0}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Input Tokens</div>
        <div class="stat-value">${tokenUsage?.totalInputTokens.toLocaleString() || 0}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Output Tokens</div>
        <div class="stat-value">${tokenUsage?.totalOutputTokens.toLocaleString() || 0}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Cost</div>
        <div class="stat-value">$${tokenUsage?.totalCost.toFixed(4) || "0.0000"}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">LLM Calls</div>
        <div class="stat-value">${metrics.llmCalls.count}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Avg Latency</div>
        <div class="stat-value">${metrics.llmCalls.avgLatency.toFixed(0)}ms</div>
      </div>
    </div>

    <h2>🗜️ Compression Metrics</h2>
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Original Tokens</div>
        <div class="stat-value">${getCompressionMetric(telemetry.metrics, "compression.original_tokens").toLocaleString()}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Compressed Tokens</div>
        <div class="stat-value success">${getCompressionMetric(telemetry.metrics, "compression.compressed_tokens").toLocaleString()}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Tokens Saved</div>
        <div class="stat-value success">${(getCompressionMetric(telemetry.metrics, "compression.original_tokens") - getCompressionMetric(telemetry.metrics, "compression.compressed_tokens")).toLocaleString()}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Avg Savings</div>
        <div class="stat-value">${getCompressionAvgSavings(telemetry.metrics).toFixed(1)}%</div>
      </div>
    </div>

    <h2>🔧 Tool Statistics</h2>
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Tool</th>
            <th>Calls</th>
            <th>Success Rate</th>
            <th>Avg Duration</th>
            <th>Avg Output Size</th>
            <th>Compression</th>
          </tr>
        </thead>
        <tbody>
          ${Object.entries(metrics.tools)
            .map(
              ([tool, stats]) => `
            <tr>
              <td><code>${tool}</code></td>
              <td>${stats.count}</td>
              <td>
                <span class="badge ${stats.successRate > 0.8 ? "success" : stats.successRate > 0.5 ? "warning" : "error"}">
                  ${(stats.successRate * 100).toFixed(0)}%
                </span>
              </td>
              <td>${stats.avgDuration.toFixed(0)}ms</td>
              <td>${stats.avgOutputSize.toFixed(0)} chars</td>
              <td>${getToolCompressionSavings(telemetry.metrics, tool)}</td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    </div>

    <h2>⚡ Performance Metrics</h2>
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Total Duration</div>
        <div class="stat-value">${(metrics.totalDuration / 1000).toFixed(2)}s</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Spans Recorded</div>
        <div class="stat-value">${telemetry.spans.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Metrics Recorded</div>
        <div class="stat-value">${telemetry.metrics.length}</div>
      </div>
    </div>

    <h2>📈 Recent Activity</h2>
    <div class="table-container">
      <div style="padding: 15px;">
        ${telemetry.spans
          .slice(-10)
          .reverse()
          .map(
            (span) => `
          <div class="timeline-item ${span.status === "error" ? "error" : ""}">
            <div style="font-weight: 600; margin-bottom: 4px;">${span.name}</div>
            <div class="timestamp">${new Date(span.startTime).toISOString()}</div>
            ${span.endTime ? `<div style="font-size: 0.85rem; color: #94a3b8; margin-top: 4px;">Duration: ${span.endTime - span.startTime}ms</div>` : ""}
          </div>
        `,
          )
          .join("")}
        ${telemetry.spans.length === 0 ? '<p style="color: #94a3b8; text-align: center; padding: 20px;">No spans recorded yet</p>' : ""}
      </div>
    </div>

    <p style="text-align: center; color: #94a3b8; margin-top: 40px; font-size: 0.85rem;">
      Generated by Bullhorse Agent Performance Dashboard
    </p>
  </div>
</body>
</html>
  `;
}

/**
 * Generate a JSON summary of trace data.
 */
export function generateTraceSummaryJSON(threadId: string): string {
  const metrics = getThreadMetrics(threadId);
  const tokenUsage = getTokenUsage(threadId);
  const telemetry = getThreadTelemetry(threadId);

  return JSON.stringify(
    {
      threadId,
      timestamp: Date.now(),
      summary: {
        totalTokens: tokenUsage?.totalTokens || 0,
        totalCost: tokenUsage?.totalCost || 0,
        llmCalls: metrics.llmCalls.count,
        totalDuration: metrics.totalDuration,
        toolCalls: Object.values(metrics.tools).reduce(
          (sum, t) => sum + t.count,
          0,
        ),
      },
      llmCalls: metrics.llmCalls,
      tools: metrics.tools,
      anomalies: detectAnomalies(telemetry, metrics),
    },
    null,
    2,
  );
}

/**
 * Detect performance anomalies in trace data.
 */
function detectAnomalies(
  telemetry: { spans: any[]; metrics: any[] },
  metrics: any,
): string[] {
  const anomalies: string[] = [];

  // Check for high token usage
  if (metrics.llmCalls.totalTokens > 100000) {
    anomalies.push(
      `High token usage: ${metrics.llmCalls.totalTokens.toLocaleString()} tokens`,
    );
  }

  // Check for slow tool calls
  for (const [tool, stats] of Object.entries(metrics.tools)) {
    if ((stats as any).avgDuration > 10000) {
      anomalies.push(
        `Slow tool: ${tool} avg ${(stats as any).avgDuration.toFixed(0)}ms`,
      );
    }
    if ((stats as any).successRate < 0.5 && (stats as any).count > 3) {
      anomalies.push(
        `High failure rate: ${tool} only ${((stats as any).successRate * 100).toFixed(0)}% success`,
      );
    }
  }

  // Check for error spans
  const errorSpans = telemetry.spans.filter((s: any) => s.status === "error");
  if (errorSpans.length > 0) {
    anomalies.push(`${errorSpans.length} error spans detected`);
  }

  return anomalies;
}

/**
 * Get the sum of all values for a given metric name.
 */
function getCompressionMetric(metrics: any[], name: string): number {
  return metrics
    .filter((m) => m.name === name)
    .reduce((sum, m) => sum + (m.value || 0), 0);
}

/**
 * Get the average compression savings ratio as a percentage.
 */
function getCompressionAvgSavings(metrics: any[]): number {
  const savingsMetrics = metrics.filter(
    (m) => m.name === "compression.savings_ratio",
  );
  if (savingsMetrics.length === 0) return 0;
  const total = savingsMetrics.reduce((sum, m) => sum + (m.value || 0), 0);
  return total / savingsMetrics.length;
}

/**
 * Get compression savings display string for a specific tool.
 */
function getToolCompressionSavings(metrics: any[], toolName: string): string {
  const savingsMetrics = metrics.filter(
    (m) =>
      m.name === "compression.savings_ratio" && m.attributes?.tool === toolName,
  );
  if (savingsMetrics.length === 0)
    return '<span style="color: #64748b;">N/A</span>';

  const avgSavings =
    savingsMetrics.reduce((sum, m) => sum + (m.value || 0), 0) /
    savingsMetrics.length;

  const savingsClass =
    avgSavings > 50 ? "success" : avgSavings > 20 ? "warning" : "error";
  return `<span class="badge ${savingsClass}">${avgSavings.toFixed(0)}%</span>`;
}
