## 2026-11-02 - GitHub Webhook Signature Bypass
**Vulnerability:** The GitHub webhook verification allowed an empty secret to bypass authentication if GITHUB_WEBHOOK_SECRET was not set.
**Learning:** Defaulting an environment variable to an empty string (e.g., `process.env.SECRET || ""`) can unintentionally enable authentication bypasses if the crypto logic treats an empty string as a valid signing key for an empty or spoofed signature.
**Prevention:** Always explicitly check if a required security secret is falsy (e.g., `if (!secret)`) and throw an error or reject the request early, rather than letting the crypto pipeline process it with an empty key.
