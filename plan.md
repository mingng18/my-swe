1.  **Analyze the vulnerability:** The `sandboxShellTool` in `src/tools/sandbox-shell.ts` accepts an optional `shell` argument. When `shell` is provided, it executes the command via `${shell} -c "${fullCommand}"`.
    The problem is that the `shell` parameter is completely unvalidated and not escaped when interpolated into the command string.
    An attacker can pass malicious commands within the `shell` parameter itself, bypassing the regex checks on the `command` parameter.
    For example: `shell: "sh -c \"echo 'bypassed!' #\""` creates the execution string: `sh -c "echo 'bypassed!' #" -c "cd /tmp && ls"` which completely drops the `command` check.
    Worse, an attacker can specify `shell: "malicious_command; sh"` to execute any arbitrary command.

2.  **Fix:** We need to validate the `shell` parameter. Since it's supposed to specify a specific shell to use (e.g., 'bash', 'sh', 'python3'), it should not be allowed to contain arbitrary characters or spaces.
    A safe fix is to ensure `shell` only contains alphanumeric characters, underscores, and perhaps slashes for paths. Or better yet, we can restrict it to a specific allowlist of safe shells, or just reject any input containing spaces or shell metacharacters.
    Given the description `e.g., 'bash', 'sh', 'python3'`, a strict alphanumeric/path regex like `/^[a-zA-Z0-9_\-\/]+$/` is appropriate.

3.  **Update `src/tools/sandbox-shell.ts`:**
    Add validation for the `shell` parameter before using it.
    If `shell` is provided, test it against `/^[a-zA-Z0-9_\-\/]+$/`. If it fails, throw an error.

4.  **Update tests:**
    Add a test case in `src/tools/__tests__/sandbox-shell.test.ts` to verify that an invalid `shell` argument throws an error.

5.  **Pre-commit steps:**
    Run formatting, linting, and tests to verify.
    Add journal entry for Sentinel.
