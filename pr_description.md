🎯 **What:**
Added unit tests for the `sanitizeUrl` function in `src/utils/sanitize.ts` to ensure that disallowed URL protocols correctly throw errors as intended by the sanitization logic.

📊 **Coverage:**
The new test file (`src/utils/__tests__/sanitize.test.ts`) covers:
- Valid `http:` and `https:` URLs (happy path).
- Disallowed protocols like `ftp:`, `javascript:`, `data:`, and `file:`, verifying the exact exception thrown.
- Completely invalid URL strings.

✨ **Result:**
Increased test coverage and confidence in the input sanitization utilities, ensuring unsafe URL protocols are reliably blocked.
