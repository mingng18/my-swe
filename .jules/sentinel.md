## 2026-07-05 - Fix Command Injection in Git Execution
**Vulnerability:** A command injection vulnerability existed in `src/utils/github/git.ts` where the `runGit` function accepted arbitrary shell command strings and appended them directly to a `backend.execute()` call without escaping. This allowed attackers to execute arbitrary shell commands if user input reached the `command` string.
**Learning:** Shell commands constructed by concatenating strings are inherently unsafe and prone to injection. Converting functions to accept arrays of arguments (like `args: string[]`) ensures all individual arguments can be robustly escaped before shell interpolation.
**Prevention:** Avoid executing arbitrary shell strings where possible. Always define APIs that take an array of executable arguments, mapping each argument through a safe shell escaping function (e.g., `shellEscapeSingleQuotes`) before being joined and executed. Reimplement complex shell features (`||`, `&&`, redirects) with application-level control flow (`try/catch`) instead of relying on bash syntax.
## 2024-07-09 - Fix Broken Allowlist Check and Prevent Command Injection Bypasses
**Vulnerability:** The `parseCommandArgs` in `src/blueprints/actions.ts` modified commands matching "bun" or "bunx" to their absolute `process.execPath` to mitigate PATH manipulation. However, the `ALLOWED_COMMANDS` whitelist check in `runLintersAction`, `runTestsAction`, and `runTypecheckAction` occurred *after* this transformation. Because the whitelist did not contain the absolute path, legitimate and necessary builtin commands were erroneously blocked.
**Learning:** Security controls can create functional regressions if validation checks happen out-of-sync with input transformations. In this case, sanitizing input before validating it against an exact-match allowlist caused a self-inflicted denial of service for critical deterministic actions.
**Prevention:** When transforming input for security (like resolving to an absolute path), always perform allowlist validation against the *original* command intent or explicitly include the transformed safe values in the allowlist.
## 2025-02-28 - Cross-Site Scripting (XSS) via Unescaped Template Interpolation
**Vulnerability:** Reflected XSS in `src/utils/trace-dashboard.ts` due to directly interpolating the user-controlled `threadId` into an HTML template string.
**Learning:** Raw string interpolation in template literals (`${variable}`) bypasses any framework-level auto-escaping when generating raw HTML. This is a common pitfall when building lightweight dashboards or email templates outside of a React/JSX context.
**Prevention:** Always wrap untrusted variables in an explicit HTML escaping function (like `escapeHTML`) before injecting them into raw HTML strings.
## 2024-11-20 - Command Injection Fix in eval/harness.ts
**Vulnerability:** Use of `execFile("sh", ["-c", cmd])` with user-provided commands allows for command injection.
**Learning:** Command runners that execute arbitrary task configurations using shell wrappers are inherently prone to command injection if left unescaped.
**Prevention:** Avoid shell wrappers completely (e.g. `sh -c`) when executing untrusted configurations. Always parse command strings into explicit arrays of arguments and execute the binary directly using `execFile(parsed[0], parsed.slice(1))`.
## 2024-07-16 - Trace Dashboard XSS Vulnerability
**Vulnerability:** Cross-Site Scripting (XSS) in `src/utils/trace-dashboard.ts` where `span.name` was directly rendered into HTML output without escaping.
**Learning:** Even internal developer tools and dashboards must sanitize data, as telemetry attributes can originate from untrusted sources or inputs. The file already contained a handy `escapeHTML` function that wasn't being used consistently.
**Prevention:** Always use `escapeHTML` (or safe templating) when dynamically inserting variables into HTML template literals, regardless of the perceived trust level of the data source.
## 2026-04-29 - Prevent Git Clone Credential Leakage
**Vulnerability:** Git clone commands with embedded credentials (https://token@github.com/...) can leak the token in `stderr`/`stdout` when the command fails (e.g., repo not found, network error), resulting in exposed credentials in logs or UI.
**Learning:** Sandboxed shell command outputs must always be sanitized when the command string itself contains secrets, as underlying tools (like git) may echo parts of the original command or the URL in their failure output.
**Prevention:** Always use a sanitization utility (like `sanitizeTokenFromString`) to scrub raw output streams from subprocesses that were executed with embedded secrets before throwing errors or logging.
## 2024-05-15 - Command Injection in Execution Nodes
**Vulnerability:** Deterministic execution nodes (`LinterNode` and `TestRunnerNode`) were vulnerable to command injection because they interpolated unescaped `repoDir` arguments directly into shell commands passed to `sandbox.execute`.
**Learning:** Even internal tool calls or deterministic fallback paths can be attack vectors if they accept externally-controlled paths without sanitization. `sandbox.execute` runs arbitrary commands, making string interpolation highly dangerous.
**Prevention:** Always use a dedicated escaping utility like `shellEscapeSingleQuotes` when interpolating variables into shell commands.
## 2026-08-11 - Secure Shell Command Interpolation
**Vulnerability:** The `sandboxShellTool` interpolated unescaped user commands directly into double quotes when a shell was specified (`shell -c "<command>"`), allowing for command injection and syntax escapes via nested execution like ``.
**Learning:** External variables (even full commands intended for execution) must be safely quoted before being passed as arguments to another shell to prevent premature evaluation.
**Prevention:** Use `shellEscapeSingleQuotes` when constructing shell execution strings to safely quote variables passed to `-c`.
## 2026-04-26 - Timing Attack via Early Return on Length Mismatch
**Vulnerability:** A `timingSafeEqual` comparison returned early if the lengths of the two buffers didn't match. This defeats constant-time execution by leaking the expected length to an attacker.
**Learning:** Security linters and best practices require ensuring both inputs to a constant-time comparison are of equal length without conditional short-circuits. Even when one length is constant (like a SHA-256 HMAC), early returns on length mismatch break the constant-time guarantee and get flagged by tooling.
**Prevention:** Always normalize the lengths of the inputs before the comparison. A common and robust way to achieve this for string comparisons is to run both the expected and provided strings through a fixed-length hashing algorithm (like SHA-256) first. The resulting digests will always be identically sized (32 bytes), removing the need for any length checks before passing them to `timingSafeEqual`.
