/**
 * Estimate token count for a string (rough approximation).
 * Uses ~4 characters per token for English text.
 */
export function estimateTokens(str: string): number {
  return Math.ceil(str.length / 4);
}

/**
 * Strip ANSI escape codes from terminal output.
 * Removes colors, cursor movements, and other terminal formatting.
 */
export function stripAnsiCodes(input: string): string {
  // Remove ANSI escape sequences
  const ansiEscape = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
  let cleaned = input.replace(ansiEscape, "");

  // Remove carriage returns used for progress bars
  cleaned = cleaned.replace(/\r+\n/g, "\n");
  cleaned = cleaned.replace(/\r(?!\n)/g, "");

  return cleaned;
}
