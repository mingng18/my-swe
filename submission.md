🔒 Security: Prevent Command Injection in Blueprint Actions

🎯 **What:** Fixes a command injection vulnerability via `execFile` in the `run_linters` and `run_tests` blueprint actions.

⚠️ **Risk:** An attacker could theoretically modify the `LINTER_COMMAND` or `TEST_COMMAND` environment variables to execute arbitrary system commands via `child_process.execFile` (e.g., executing `rm -rf /` instead of the linter/test runner).

🛡️ **Solution:** Implemented an explicit allowlist (`ALLOWED_EXECUTABLES`) to restrict the executable binaries that can be run through the blueprint action runner, mitigating the vulnerability.
