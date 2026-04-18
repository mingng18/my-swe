## 2024-05-24 - SSRF in multimodal utilities
**Vulnerability:** fetchImageBlock failed to mitigate SSRF when downloading external images
**Learning:** An attacker could supply internal loopback IPs or metadata IP addresses (e.g. 127.0.0.1, 169.254.x.x) which the server would fetch.
**Prevention:** Always validate protocols using URL constructor and use DNS lookup to resolve the actual IP address, explicitly blocking local, private, and metadata IP ranges.
## 2024-05-31 - Command Injection in SandboxService
**Vulnerability:** Command injection in `SandboxService.cloneRepo()` via unescaped shell string interpolation (e.g., `workDir`, `repoDir`, `cloneUrlWithCreds`, `defaultBranch`).
**Learning:** `execute()` command takes shell strings, so dynamically constructed strings require proper escaping before execution, even for seemingly safe inputs like branch names or repositories.
**Prevention:** Always use an escaping function like `escapeShellArg` to wrap parameters securely before interpolating them into shell commands.
