/**
 * Safely embed an arbitrary string into a POSIX shell command.
 * Produces: 'foo'"'"'bar' style quoting.
 */
export function shellEscapeSingleQuotes(input: string): string {
  return `'${input.replace(/'/g, `'"'"'`)}'`;
}
