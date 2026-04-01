## 2025-02-23 - [Predictable Temp File Vulnerability in Git Credentials]
**Vulnerability:** Found a hardcoded, predictable temporary file path (`/tmp/.git-credentials`) being used for storing sensitive Git credentials (`githubToken`) during `git push` operations within sandboxes in `src/utils/github/github.ts`.
**Learning:** Hardcoded `/tmp/` file paths create a vulnerability to race conditions, file collisions, and potential credential leakage if multiple sandboxes or parallel operations exist on the same host, or if `/tmp` allows unauthorized access.
**Prevention:** Use dynamically generated temporary file paths (e.g., via `mktemp`) and pass the generated path to subsequent functions rather than relying on static constant strings.
