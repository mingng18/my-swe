/**
 * Regular expression used to match characters that need to be escaped in a regex.
 * Extracts regex to module scope to avoid recompilation.
 */
export const ESCAPE_REGEX_PATTERN = /[.*+?^${}()|[\]\\]/g;

/**
 * Escapes characters in a string so it can be safely used as a literal in a regular expression.
 */
export function escapeRegex(text: string): string {
  return text.replace(ESCAPE_REGEX_PATTERN, "\\$&");
}
