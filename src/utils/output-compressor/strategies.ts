import {
  RTK_FAILURE_FOCUS_THRESHOLD,
  RTK_DEDUP_THRESHOLD,
  RTK_TRUNCATE_HEAD_TOKENS,
  RTK_TRUNCATE_TAIL_TOKENS,
} from "./config";
import { estimateTokens } from "./utils";

/**
 * Apply failure focus compression to test/build output.
 * Only shows failures and summary, hides passing items.
 */
export function applyFailureFocus(input: string, command?: string): string {
  const lines = input.split("\n");

  // Detect test framework based on command patterns
  const isJest = command?.includes("jest") || command?.includes("npm test");
  const isPytest =
    command?.includes("pytest") || command?.includes("python -m pytest");
  const isGoTest = command?.includes("go test");
  const isCargo = command?.includes("cargo") || command?.includes("rustc");
  const isMaven = command?.includes("mvn") || command?.includes("maven");
  const isGradle = command?.includes("gradle");

  // Count pass/fail patterns
  let passCount = 0;
  let failCount = 0;
  const failures: string[] = [];
  const errors: string[] = [];

  for (const line of lines) {
    // Jest patterns
    if (isJest) {
      if (/^[\s●]*✓|PASS/.test(line)) passCount++;
      if (/^[\s●]*✗|FAIL/.test(line)) {
        failCount++;
        failures.push(line);
      }
    }
    // pytest patterns
    else if (isPytest) {
      if (/PASSED/.test(line)) passCount++;
      if (/FAILED/.test(line)) {
        failCount++;
        failures.push(line);
      }
    }
    // Go test patterns
    else if (isGoTest) {
      if (/--- PASS:/.test(line)) passCount++;
      if (/--- FAIL:/.test(line)) {
        failCount++;
        failures.push(line);
      }
    }
    // Cargo patterns
    else if (isCargo) {
      if (/Compiling|Finished|Checking/.test(line)) passCount++;
      if (/error\[E|warning:/.test(line)) {
        errors.push(line);
      }
    }
    // Maven patterns
    else if (isMaven) {
      if (/Tests run:.*Failures: 0.*Errors: 0/.test(line)) passCount++;
      if (/Tests run:.*(Failures: [1-9]|Errors: [1-9])/.test(line)) {
        failCount++;
        failures.push(line);
      }
    }
    // Gradle patterns
    else if (isGradle) {
      if (/BUILD SUCCESSFUL/.test(line)) passCount++;
      if (/BUILD FAILED|FAILED/.test(line)) {
        failCount++;
        failures.push(line);
      }
    }
    // Generic patterns
    else {
      if (/\[OK\]|\[PASS\]|passed/.test(line.toLowerCase())) passCount++;
      if (/\[FAIL\]|\[ERROR\]|failed|error:/i.test(line)) {
        if (/error:/i.test(line)) {
          errors.push(line);
        } else {
          failures.push(line);
        }
      }
    }
  }

  // If we have enough passing items to hide, apply failure focus
  if (passCount >= RTK_FAILURE_FOCUS_THRESHOLD) {
    const result: string[] = [];

    if (failCount === 0 && errors.length === 0) {
      return `Status: Success (${passCount} checks passed)`;
    }

    if (passCount > 0) {
      result.push(`Passed: ${passCount}`);
    }

    if (failCount > 0) {
      result.push(`Failed: ${failCount}`);
      // Include first few failures with context
      const contextLines: string[] = [];
      let inFailure = false;
      for (const line of lines) {
        if (/FAIL|error|Error|Exception/.test(line)) {
          inFailure = true;
        }
        if (inFailure) {
          contextLines.push(line);
          if (contextLines.length > 50) break; // Limit context per failure
        }
      }
      result.push(...failures.slice(0, 10));
      if (contextLines.length > 0) {
        result.push("\nFailure details:");
        result.push(...contextLines.slice(0, 20));
      }
    }

    if (errors.length > 0) {
      result.push(`\nErrors: ${errors.length}`);
      result.push(...errors.slice(0, 10));
    }

    return result.join("\n");
  }

  // Not enough to apply failure focus, return original
  return input;
}

/**
 * Deduplicate repeating log lines.
 * Groups identical lines (ignoring timestamps) and shows counts.
 */
export function applyDeduplication(input: string): string {
  const lines = input.split("\n");
  const counts = new Map<string, number>();

  // Timestamp regex patterns
  const timestampPatterns = [
    /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/, // ISO 8601
    /^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}/, // US date
    /^\d{2}:\d{2}:\d{2}/, // Time only
    /^\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}/, // Syslog format
  ];

  for (const line of lines) {
    let normalized = line.trim();
    if (!normalized) continue;

    // Strip timestamps
    for (const pattern of timestampPatterns) {
      normalized = normalized.replace(pattern, "").trim();
    }

    const key = normalized.substring(0, 200); // Limit key length
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  // Build deduplicated output
  const result: string[] = [];
  const sorted = Array.from(counts.entries())
    .filter(([_, count]) => count >= RTK_DEDUP_THRESHOLD)
    .sort((a, b) => b[1] - a[1]);

  // Show repeated lines with counts
  for (const [line, count] of sorted.slice(0, 20)) {
    if (count > RTK_DEDUP_THRESHOLD) {
      result.push(`[x${count}] ${line}`);
    } else {
      result.push(line);
    }
  }

  // Add lines that didn't repeat enough
  for (const [line, count] of sorted) {
    if (count < RTK_DEDUP_THRESHOLD) {
      result.push(line);
    }
  }

  return result.length > 0 ? result.join("\n") : input;
}

/**
 * Extract JSON schema from a JSON string.
 * Shows structure and types instead of full values.
 */
export function extractJsonSchema(input: string): string {
  try {
    const parsed = JSON.parse(input);

    function extractType(value: unknown, depth = 0, maxDepth = 3): string {
      if (depth > maxDepth) return "...";

      if (value === null) return "null";
      if (typeof value === "boolean") return "boolean";
      if (typeof value === "number") return "number";
      if (typeof value === "string") {
        // Truncate long strings
        return value.length > 50
          ? `string(${value.length} chars)`
          : `"${value}"`;
      }
      if (Array.isArray(value)) {
        if (value.length === 0) return "[]";
        const elemType = extractType(value[0], depth + 1, maxDepth);
        return `Array[${value.length}] of ${elemType}`;
      }
      if (typeof value === "object") {
        const fields: string[] = [];
        let count = 0;
        const record = value as Record<string, unknown>;

        // ⚡ Bolt: Replace Object.entries with for...in to avoid intermediate array allocations in hot path
        for (const k in record) {
          if (!Object.prototype.hasOwnProperty.call(record, k)) continue;
          count++;
          if (fields.length < 10) {
            const t = extractType(record[k], depth + 1, maxDepth);
            fields.push(`"${k}": ${t}`);
          }
        }

        if (count === 0) return "{}";
        if (count > 10) {
          fields.push(`... (${count - 10} more fields)`);
        }
        return `{ ${fields.join(", ")} }`;
      }
      return "unknown";
    }

    const schema = extractType(parsed);
    return JSON.stringify({ schema, itemCount: 1 }, null, 2);
  } catch {
    // Not valid JSON, return original
    return input;
  }
}

/**
 * Smart truncation that keeps the start and end of output.
 * Errors usually appear at the end, so we preserve both ends.
 */
export function smartTruncate(input: string, maxTokens: number): string {
  const estimated = estimateTokens(input);

  if (estimated <= maxTokens) {
    return input;
  }

  // Calculate character limits (rough approximation)
  const headChars = RTK_TRUNCATE_HEAD_TOKENS * 4;
  const tailChars = RTK_TRUNCATE_TAIL_TOKENS * 4;

  if (input.length <= headChars + tailChars + 100) {
    return input;
  }

  const head = input.substring(0, headChars);
  const tail = input.substring(input.length - tailChars);

  const omitted = input.length - headChars - tailChars;
  return `${head}\n\n... [ ${omitted.toLocaleString()} characters truncated to save tokens ] ...\n\n${tail}`;
}
