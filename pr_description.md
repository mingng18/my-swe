🚨 Severity: Medium
💡 Vulnerability: The `X-XSS-Protection` header was explicitly disabled (`0`) on the Hono webapp catch-all route, contrary to the `SECURITY.md` specifications which required `1; mode=block`.
🎯 Impact: In older browsers that don't support Content-Security-Policy (CSP) fully, disabling this legacy header could allow reflected Cross-Site Scripting (XSS) attacks.
🔧 Fix: Changed the `X-XSS-Protection` header value from `0` to `1; mode=block` in `src/webapp.ts`.
✅ Verification: Ran the build and tests (`tests/stream.test.ts`, `src/utils/github/security.test.ts`) to ensure nothing broke, specifically confirming the SSE streams are unaffected.
