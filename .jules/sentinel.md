## 2024-04-03 - [Command Injection Risks]
**Vulnerability:** Shell execution tools in `src/tools/sandbox-files.ts` are vulnerable to command injection because user input (`path`, `pattern`, etc.) is directly interpolated into shell commands. A malicious input would execute unintended shell commands.
**Learning:** Directly concatenating inputs into shell strings inside `backend.execute` is a known anti-pattern. Memory tells me to use `shellEscapeSingleQuotes` centralized in `src/utils/shell.ts`.
**Prevention:** Create `src/utils/shell.ts` exporting `shellEscapeSingleQuotes`, and import it across all files performing shell executions.
