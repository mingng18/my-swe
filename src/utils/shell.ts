/**
 * Safely embed an arbitrary string into a POSIX shell command.
 * Produces: 'foo'"'"'bar' style quoting.
 */
export function shellEscapeSingleQuotes(input: string): string {
  if (input.includes('\x00')) {
    throw new Error("Invalid input: contains null byte");
  }
  if (input.length > 4096) {
    throw new Error("Invalid input: too long");
  }
  const dangerousPatterns = [
    /\$\(.*?\)/,
    /`.*?`/,
    /\$\{.*?\}/,
    /\|/,
    /;/,
    /&/,
    /\n/,
    /\r/,
    /\\\$/
  ];
  if (dangerousPatterns.some(p => p.test(input))) {
    throw new Error("Invalid input: dangerous pattern");
  }
  return `'${input.replace(/'/g, `'\\''`)}'`;
}
