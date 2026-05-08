/**
 * Safely embed an arbitrary string into a POSIX shell command.
 * Produces: 'foo'"'"'bar' style quoting.
 */
export function shellEscapeSingleQuotes(input: string): string {
  if (input.includes('\x00')) {
    throw new Error("Input contains null byte");
  }
  if (input.length > 4096) {
    throw new Error("Input is too long");
  }
  if (
    input.includes('$(') ||
    input.includes('`') ||
    input.includes('${') ||
    input.includes('|') ||
    input.includes(';') ||
    input.includes('&&') ||
    input.includes('\n') ||
    input.includes('\r') ||
    input.includes('\\$')
  ) {
    throw new Error("Input contains dangerous pattern");
  }

  return `'${input.replace(/'/g, `'"'"'`)}'`;
}
