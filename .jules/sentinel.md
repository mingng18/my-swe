## $(date +%Y-%m-%d) - Fix fail-open authentication bypass
**Vulnerability:** The webapp authentication middleware failed open when `API_SECRET_KEY` was missing/undefined, bypassing token verification entirely and proceeding via `await next()`.
**Learning:** Checking `if (secret !== undefined)` is dangerous if the intent is to require the secret. An undefined secret should result in rejection, not an environment where all requests are allowed.
**Prevention:** Ensure authentication checks fail closed. Always reject requests if mandatory security configuration (like secrets) is absent.
## $(date +%Y-%m-%d) - Fix fail-open authentication bypass
**Vulnerability:** The webapp authentication middleware failed open when `API_SECRET_KEY` was missing/undefined, bypassing token verification entirely and proceeding via `await next()`.
**Learning:** Checking `if (secret !== undefined)` is dangerous if the intent is to require the secret. An undefined secret should result in rejection, not an environment where all requests are allowed.
**Prevention:** Ensure authentication checks fail closed. Always reject requests if mandatory security configuration (like secrets) is absent.
