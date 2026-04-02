/**
 * Safely escapes a string to be used inside single quotes in a shell command.
 * Replaces each single quote with `'"'"'` (end single quote, insert literal single quote, start single quote).
 * E.g. `O'Reilly` -> `'O'"'"'Reilly'`
 * Note: the return value includes the surrounding single quotes.
 */
export function shellEscapeSingleQuotes(input: string): string {
  return `'${input.replace(/'/g, `'"'"'`)}'`;
}
