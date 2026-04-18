## 2024-05-24 - SSRF in multimodal utilities
**Vulnerability:** fetchImageBlock failed to mitigate SSRF when downloading external images
**Learning:** An attacker could supply internal loopback IPs or metadata IP addresses (e.g. 127.0.0.1, 169.254.x.x) which the server would fetch.
**Prevention:** Always validate protocols using URL constructor and use DNS lookup to resolve the actual IP address, explicitly blocking local, private, and metadata IP ranges.

## 2025-04-18 - Fix Command Injection in Exec
**Vulnerability:** Command injection via LINTER_COMMAND and TEST_COMMAND passed directly to exec.
**Learning:** exec defaults to executing via a shell which allows injecting arbitrary commands if the command string is user-influenced.
**Prevention:** Always use execFile and parse arguments to bypass the shell when executing dynamic commands.
