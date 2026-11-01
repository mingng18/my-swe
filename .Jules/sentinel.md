## 2024-07-25 - XSS Vulnerability from Disabled Protection
**Vulnerability:** The `X-XSS-Protection` header was explicitly disabled (`0`) on the webapp's catch-all route, contrary to the standard `1; mode=block` specified in the repository's `SECURITY.md` and other middleware configurations.
**Learning:** Sometimes developers disable security protections globally (e.g. to solve issues with specific browser extensions or legacy behaviors) or simply copy-paste bad practices, which creates attack vectors for older browsers without adequate CSP support.
**Prevention:** Always enforce consistent security headers across all routes and align with documented security standards (e.g., `SECURITY.md`) and modern best practices unless a specific exception is securely justified and heavily documented.
