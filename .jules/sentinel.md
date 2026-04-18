## 2024-05-24 - SSRF in multimodal utilities
**Vulnerability:** fetchImageBlock failed to mitigate SSRF when downloading external images
**Learning:** An attacker could supply internal loopback IPs or metadata IP addresses (e.g. 127.0.0.1, 169.254.x.x) which the server would fetch.
**Prevention:** Always validate protocols using URL constructor and use DNS lookup to resolve the actual IP address, explicitly blocking local, private, and metadata IP ranges.

## 2024-04-18 - JSON.parse Error Handling Missing
**Vulnerability:** The MCP client did not isolate `JSON.parse` in its own try/catch block when reading `mcp.json`.
**Learning:** Parsing JSON from user-controlled files must be explicitly wrapped in a targeted try/catch. Relying on a broad `catch` for file I/O and parsing can mask data corruption errors.
**Prevention:** Always wrap `JSON.parse()` of external files in a dedicated `try/catch` block to handle syntax errors gracefully.
