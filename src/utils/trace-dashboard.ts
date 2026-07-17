import { createLogger } from "./logger";
import { getThreadTelemetry, getThreadMetrics } from "./telemetry";
import { getTokenUsage } from "./token-tracker";

const logger = createLogger("trace-dashboard");

/**
 * Escape HTML special characters to prevent XSS.
 */
function escapeHTML(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Generate HTML for trace analysis dashboard.
 */
function generateStyles(): string {
  return `
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
    .table-container { background: #16213e; border-radius: 8px; overflow-x: auto; border: 1px solid #334155; }
    .table-container:focus-visible { outline: 2px solid #60a5fa; outline-offset: 2px; }
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
  `;
}

function generateTokenUsageHTML(tokenUsage: any, metrics: any): string {
  return `
    <h2>📊 Token Usage</h2>
    <dl class="stats-grid">
      <div class="stat-card" role="group">
        <dt class="stat-label">Total Tokens</dt>
        <dd class="stat-value">${tokenUsage?.totalTokens.toLocaleString() || 0}</dd>
      </div>
      <div class="stat-card" role="group">
        <dt class="stat-label">Input Tokens</dt>
        <dd class="stat-value">${tokenUsage?.totalInputTokens.toLocaleString() || 0}</dd>
      </div>
      <div class="stat-card" role="group">
        <dt class="stat-label">Output Tokens</dt>
        <dd class="stat-value">${tokenUsage?.totalOutputTokens.toLocaleString() || 0}</dd>
      </div>
      <div class="stat-card" role="group">
        <dt class="stat-label">Total Cost</dt>
        <dd class="stat-value">$${tokenUsage?.totalCost.toFixed(4) || "0.0000"}</dd>
      </div>
      <div class="stat-card" role="group">
        <dt class="stat-label">LLM Calls</dt>
        <dd class="stat-value">${metrics.llmCalls.count}</dd>
      </div>
      <div class="stat-card" role="group">
        <dt class="stat-label">Avg Latency</dt>
        <dd class="stat-value">${metrics.llmCalls.avgLatency.toFixed(0)}ms</dd>
      </div>
    </dl>`;
}

function generateCompressionMetricsHTML(telemetry: any): string {
  return `
    <h2>🗜️ Compression Metrics</h2>
    <dl class="stats-grid">
      <div class="stat-card" role="group">
        <dt class="stat-label">Original Tokens</dt>
        <dd class="stat-value">${getCompressionMetric(telemetry.metrics, "compression.original_tokens").toLocaleString()}</dd>
      </div>
      <div class="stat-card" role="group">
        <dt class="stat-label">Compressed Tokens</dt>
        <dd class="stat-value success">${getCompressionMetric(telemetry.metrics, "compression.compressed_tokens").toLocaleString()}</dd>
      </div>
      <div class="stat-card" role="group">
        <dt class="stat-label">Tokens Saved</dt>
        <dd class="stat-value success">${(getCompressionMetric(telemetry.metrics, "compression.original_tokens") - getCompressionMetric(telemetry.metrics, "compression.compressed_tokens")).toLocaleString()}</dd>
      </div>
      <div class="stat-card" role="group">
        <dt class="stat-label">Avg Savings</dt>
        <dd class="stat-value">${getCompressionAvgSavings(telemetry.metrics).toFixed(1)}%</dd>
      </div>
    </dl>`;
}

function generateToolStatsHTML(metrics: any, telemetry: any): string {
  const savingsByTool = new Map<string, { sum: number; count: number }>();

  // ⚡ Bolt: Pre-calculate tool compression savings in a single O(N) pass
  if (telemetry.metrics) {
    for (let i = 0; i < telemetry.metrics.length; i++) {
      const m = telemetry.metrics[i];
      if (m.name === "compression.savings_ratio" && m.attributes?.tool) {
        const tool = m.attributes.tool;
        const current = savingsByTool.get(tool) || { sum: 0, count: 0 };
        current.sum += m.value || 0;
        current.count++;
        savingsByTool.set(tool, current);
      }
    }
  }

  return `
    <h2>🔧 Tool Statistics</h2>
    <div class="table-container" tabindex="0">
      <table>
        <thead>
          <tr>
            <th scope="col">Tool</th>
            <th scope="col">Calls</th>
            <th scope="col">Success Rate</th>
            <th scope="col">Avg Duration</th>
            <th scope="col">Avg Output Size</th>
            <th scope="col">Compression</th>
          </tr>
        </thead>
        <tbody>
          ${Object.entries(metrics.tools)
            .map(([tool, stats]) => {
              const savings = savingsByTool.get(tool) || { sum: 0, count: 0 };
              return `
            <tr>
              <td><code>${escapeHTML(tool)}</code></td>
              <td>${(stats as any).count}</td>
              <td>
                <span class="badge ${(stats as any).successRate > 0.8 ? "success" : (stats as any).successRate > 0.5 ? "warning" : "error"}">
                  ${((stats as any).successRate * 100).toFixed(0)}%
                </span>
              </td>
              <td>${(stats as any).avgDuration.toFixed(0)}ms</td>
              <td>${(stats as any).avgOutputSize.toFixed(0)} chars</td>
              <td>${formatCompressionSavings(savings.sum, savings.count)}</td>
            </tr>
          `;
            })
            .join("")}
        </tbody>
      </table>
    </div>`;
}

function generatePerformanceMetricsHTML(metrics: any, telemetry: any): string {
  return `
    <h2>⚡ Performance Metrics</h2>
    <dl class="stats-grid">
      <div class="stat-card" role="group">
        <dt class="stat-label">Total Duration</dt>
        <dd class="stat-value">${(metrics.totalDuration / 1000).toFixed(2)}s</dd>
      </div>
      <div class="stat-card" role="group">
        <dt class="stat-label">Spans Recorded</dt>
        <dd class="stat-value">${telemetry.spans.length}</dd>
      </div>
      <div class="stat-card" role="group">
        <dt class="stat-label">Metrics Recorded</dt>
        <dd class="stat-value">${telemetry.metrics.length}</dd>
      </div>
    </dl>`;
}

function generateRecentActivityHTML(telemetry: any): string {
  return `
    <h2>📈 Recent Activity</h2>
    <div class="table-container" tabindex="0">
      <div style="padding: 15px;" role="list">
        ${telemetry.spans
          .slice(-10)
          .reverse()
          .map(
            (span: any) => `
          <div role="listitem" class="timeline-item ${span.status === "error" ? "error" : ""}">
            <div style="font-weight: 600; margin-bottom: 4px;">${escapeHTML(span.name)}</div>
            <div class="timestamp">${new Date(span.startTime).toISOString()}</div>
            ${span.endTime ? `<div style="font-size: 0.85rem; color: #94a3b8; margin-top: 4px;">Duration: ${span.endTime - span.startTime}ms</div>` : ""}
          </div>
        `,
          )
          .join("")}
        ${telemetry.spans.length === 0 ? '<p role="status" style="color: #94a3b8; text-align: center; padding: 20px;">No spans recorded yet</p>' : ""}
      </div>
    </div>`;
}

export function generateTraceDashboardHTML(threadId: string): string {
  const telemetry = getThreadTelemetry(threadId);
  const metrics = getThreadMetrics(threadId);
  const tokenUsage = getTokenUsage(threadId);

  const safeThreadId = escapeHTML(threadId);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Trace Dashboard - ${safeThreadId}</title>
  <style>
${generateStyles()}
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🔍 Trace Dashboard</h1>
      <p style="color: #94a3b8; margin-bottom: 20px;">Thread ID: <code style="background: #334155; padding: 4px 8px; border-radius: 4px;">${safeThreadId}</code></p>
    </header>
    <main>
${generateTokenUsageHTML(tokenUsage, metrics)}
${generateCompressionMetricsHTML(telemetry)}
${generateToolStatsHTML(metrics, telemetry)}
${generatePerformanceMetricsHTML(metrics, telemetry)}
${generateRecentActivityHTML(telemetry)}
    </main>
    <footer>
      <p style="text-align: center; color: #94a3b8; margin-top: 40px; font-size: 0.85rem;">
        Generated by Bullhorse Agent Performance Dashboard
      </p>
    </footer>
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
  let sum = 0;
  // ⚡ Bolt: Use a single O(N) pass to avoid multiple iteration over arrays
  for (let i = 0; i < metrics.length; i++) {
    const m = metrics[i];
    if (m.name === name) {
      sum += m.value || 0;
    }
  }
  return sum;
}

/**
 * Get the average compression savings ratio as a percentage.
 */
function getCompressionAvgSavings(metrics: any[]): number {
  let sum = 0;
  let count = 0;
  // ⚡ Bolt: Use a single O(N) pass to avoid multiple iteration over arrays
  for (let i = 0; i < metrics.length; i++) {
    const m = metrics[i];
    if (m.name === "compression.savings_ratio") {
      sum += m.value || 0;
      count++;
    }
  }
  if (count === 0) return 0;
  return sum / count;
}

/**
 * Get compression savings display string for a specific tool.
 */
function formatCompressionSavings(sum: number, count: number): string {
  if (count === 0)
    return '<span style="color: #64748b;" aria-label="Not available" title="Compression savings ratio not available for this tool">N/A</span>';

  const avgSavings = sum / count;

  const savingsClass =
    avgSavings > 50 ? "success" : avgSavings > 20 ? "warning" : "error";
  return `<span class="badge ${savingsClass}">${avgSavings.toFixed(0)}%</span>`;
}

function getToolCompressionSavings(metrics: any[], toolName: string): string {
  let sum = 0;
  let count = 0;
  // ⚡ Bolt: Use a single O(N) pass to avoid multiple iteration over arrays
  for (let i = 0; i < metrics.length; i++) {
    const m = metrics[i];
    if (
      m.name === "compression.savings_ratio" &&
      m.attributes?.tool === toolName
    ) {
      sum += m.value || 0;
      count++;
    }
  }

  if (count === 0)
    return '<span style="color: #64748b;" aria-label="Not available" title="Compression savings ratio not available for this tool">N/A</span>';

  const avgSavings = sum / count;

  const savingsClass =
    avgSavings > 50 ? "success" : avgSavings > 20 ? "warning" : "error";
  return `<span class="badge ${savingsClass}">${avgSavings.toFixed(0)}%</span>`;
}
