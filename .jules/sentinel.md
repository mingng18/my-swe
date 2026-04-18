## 2024-05-24 - SSRF in multimodal utilities
**Vulnerability:** fetchImageBlock failed to mitigate SSRF when downloading external images
**Learning:** An attacker could supply internal loopback IPs or metadata IP addresses (e.g. 127.0.0.1, 169.254.x.x) which the server would fetch.
**Prevention:** Always validate protocols using URL constructor and use DNS lookup to resolve the actual IP address, explicitly blocking local, private, and metadata IP ranges.
## 2025-05-20 - Fix Command Injection in Blueprint Actions
**Vulnerability:** Command injection vulnerability in `run_linters` and `run_tests` actions via `exec` allowing arbitrary code execution through environment variables.
**Learning:** Using `exec` directly with unsanitized environment variables creates a shell injection vector.
**Prevention:** Use `execFile` instead of `exec` to bypass shell parsing, and properly parse command strings into arrays of arguments.
