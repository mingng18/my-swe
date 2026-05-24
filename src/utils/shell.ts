const MAX_SHELL_ARG_LENGTH = 4096;

const DANGEROUS_SHELL_PATTERNS = [
  /\$\(/,
  /`/,
  /\$\{/,
  /\|/,
  /;/,
  /&&/,
  /\|\|/,
  /\r/,
  /\n/,
  /\\\$/,
];

/**
 * Safely embed an arbitrary string into a POSIX shell single-quoted argument.
 * Rejects null bytes, oversized input, and shell metacharacters.
 */
export function shellEscapeSingleQuotes(input: string): string {
  if (input.includes("\0")) {
    throw new Error("null byte");
  }

  if (input.length > MAX_SHELL_ARG_LENGTH) {
    throw new Error("too long");
  }

  for (const pattern of DANGEROUS_SHELL_PATTERNS) {
    if (pattern.test(input)) {
      throw new Error("dangerous pattern");
    }
  }

  return `'${input.replace(/'/g, `'\\''`)}'`;
}
