## 2025-04-18 - SSRF Vulnerability via IPv4-mapped IPv6 Addresses
**Vulnerability:** The application attempts to prevent SSRF by blocking local/private IP ranges (127.0.0.0/8, 169.254.0.0/16, etc.) using `dns.lookup`. However, it fails to account for IPv4-mapped IPv6 addresses like `::ffff:127.0.0.1` and `::ffff:169.254.169.254`. Since `dns.lookup` returns the mapped format directly when queried, an attacker could resolve an IPv6 address pointing to a protected IPv4 range and bypass the blocklist checks. Also `::` is equivalent to `0.0.0.0`/`localhost` in some contexts but isn't checked properly.
**Learning:** Basic string matching for IP prefixes is insufficient when dealing with dual-stack IPv4/IPv6 environments. The `::ffff:` prefix (and related mapped formats) can effectively tunnel an IPv4 payload past naive regex/string blocking.
**Prevention:** Always normalize IP addresses to strip the `::ffff:` prefix before applying blocklist checks, and expand the blocklist to catch edge cases like `::` which functions similarly to `0.0.0.0`.
## 2025-04-21 - SSRF bypass via uncompressed IPv4-mapped IPv6 addresses
**Vulnerability:** The SSRF protection used a naive `.startsWith("::ffff:")` check to normalize IPv4-mapped IPv6 addresses. This could be bypassed using uncompressed or partially compressed explicit zero groups, like `0:0:0:0:0:ffff:127.0.0.1`.
**Learning:** Checking for standard prefix-only representations of IPv6 is insufficient because attackers can supply differently compressed but semantically identical IPv6 representations that standard Node DNS will still parse but naive string checks miss.
**Prevention:** Always use regex to strip out variants of `(?:0+:)+ffff:` and `::ffff:` explicitly to reveal the underlying IPv4 address before validating it against blocklists.
## 2025-02-24 - Timing Attack Vulnerability in Webhook Verification

**Vulnerability:** Found `timingSafeEqual` used with buffers of potentially different lengths in `src/webapp.ts` and `src/utils/github/github-comments.ts`. While the code checks `expectedBuffer.length !== signatureBuffer.length` and returns early, this early return still leaks the length of the expected secret via timing side channels.
**Learning:** `timingSafeEqual` requires buffers of the exact same length. If lengths differ, it throws an error in Node.js. To safely handle variable length inputs without leaking length via early returns, one must use an HMAC with a constant length, or pad buffers. However, the most secure pattern for string comparison is to hash both strings using a strong algorithm (like SHA-256) and then compare the hashes using `timingSafeEqual`.
**Prevention:** When comparing secrets (like API tokens) of variable or unknown length against a known secret, hash both the user-provided token and the expected secret using `crypto.createHash('sha256')`, then compare the resulting fixed-length hashes (which will always be 32 bytes) using `crypto.timingSafeEqual`.
## 2026-05-01 - Prevent Command Injection via execFile
**Vulnerability:** Potential Command Injection in `src/blueprints/actions.ts` where `execFile` executed commands derived directly from `process.env.TEST_COMMAND` and `process.env.LINTER_COMMAND` without validation.
**Learning:** Even though `execFile` avoids spawning a shell by default, executing an unvalidated binary name passed by user-controlled environment variables allows attackers to run arbitrary executables on the system.
**Prevention:** Always validate user-provided executable commands against a strict allowlist (e.g., `ALLOWED_COMMANDS`) before passing them to `execFile` or similar process creation APIs.
## 2023-10-27 - [Undici Agent Resource Leak in SSRF Mitigation]
**Vulnerability:** Resource Exhaustion (DoS) due to un-destroyed undici Agents
**Learning:** When mitigating SSRF using custom DNS lookup via `undici.Agent`, failing to explicitly call `await agent.destroy()` leaks socket connections and file descriptors because custom Agents bypass global connection pooling.
**Prevention:** Always destroy custom networking Agents in a `finally` block immediately after the response is fully consumed.
## 2025-02-28 - Fix Timing Attack Vulnerability in Webhook Verification
**Vulnerability:** Double-hashing of variable-length user input during GitHub webhook verification could leak timing information and the length mismatch check was non-standard.
**Learning:** Using `crypto.timingSafeEqual` directly on Buffers after validating their lengths are identical is the standard, secure way to compare signatures without leaking timing info or throwing errors on mismatched lengths.
**Prevention:** Always compare known-length hashes directly using Buffers and length checks, avoiding HMAC updates on untrusted user signatures.
## 2026-05-02 - Fix XSS Vulnerability in Schema Display Component
**Vulnerability:** The `SchemaDisplayPath` component used `dangerouslySetInnerHTML` to render an API path string into the DOM after performing a naive `.replaceAll` string replacement to inject formatting tags.
**Learning:** Using `dangerouslySetInnerHTML` with user-supplied or schema-derived string data exposes the frontend to Cross-Site Scripting (XSS) if the string contains unescaped HTML characters. Even if the intent is just to highlight specific parts of the string, raw HTML injection must be avoided.
**Prevention:** Never use `dangerouslySetInnerHTML` for simple string formatting or highlighting. Instead, parse the string (e.g., using `String.prototype.split` with a capturing regex) to map segments into safe React element arrays, allowing React to automatically escape text nodes while applying formatting correctly.
