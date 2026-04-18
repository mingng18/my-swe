🚨 Severity: HIGH

💡 Vulnerability: Command injection vulnerability in `run_linters` and `run_tests` actions via `exec` allowing arbitrary code execution through environment variables.

🎯 Impact: An attacker who controls the `LINTER_COMMAND` or `TEST_COMMAND` environment variables could execute arbitrary shell commands on the server running the blueprint engine.

🔧 Fix: Replaced `exec` with `execFile` from `child_process` to bypass shell parsing. Wrote a `parseCommandArgs` utility function to properly parse command strings into an executable and an array of arguments, handling both single and double quotes correctly.

✅ Verification: Unit tests were written for `parseCommandArgs` and all existing and new tests pass correctly.
