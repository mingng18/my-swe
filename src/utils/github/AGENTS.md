# AGENTS.md for `src/utils/github/`

## Package Identity

Git and GitHub helper layer for PR automation, branch operations, webhook/auth helpers, and API wrappers.
This is the only place that should know low-level GitHub API details.

## Setup & Run

- Typecheck: `bunx tsc --noEmit`
- Run app to exercise webhook + GitHub flows: `bun run start`
- Trace GitHub wrapper usage: `rg -n "from \\\"../utils/github|from \\\"./utils/github" src`

## Patterns & Conventions

- ✅ DO: Use wrapper functions (`gitAddAll`, `gitCommit`, `createGithubPr`, etc.) from `src/utils/github/index.ts`.
- ✅ DO: Keep shell command assembly sanitized (pattern in `src/utils/github/github.ts` branch/message escaping).
- ✅ DO: Handle API edge cases (422 existing PR fallback pattern in `createGithubPr`).
- ✅ DO: Keep auth/token handling minimal and short-lived.
- ✅ DO: Return predictable tuple/object contracts from wrappers.
- ❌ DON'T: Call Octokit directly from tool/node files when wrapper already exists.
- ❌ DON'T: Log credentials or token-bearing URLs.

## Touch Points / Key Files

- Main git/GitHub API wrappers: `src/utils/github/github.ts`
- Module exports: `src/utils/github/index.ts`
- GitHub App support: `src/utils/github/github-app.ts`
- Token utilities: `src/utils/github/github-token.ts`
- Webhook signature checks: `src/utils/github/github-comments.ts`
- Email mapping helper: `src/utils/github/github-user-email-map.ts`

## JIT Index Hints

- Find git command wrappers: `rg -n "export async function git" src/utils/github`
- Find Octokit usage: `rg -n "new Octokit|octokit\\.rest" src/utils/github`
- Find webhook verification: `rg -n "verify|signature|webhook" src/utils/github`
- Find PR lifecycle helpers: `rg -n "createGithubPr|listGithubPrs|mergeGithubPr" src/utils/github`

## Common Gotchas

- Git commands execute inside sandbox context; workspace paths must be valid there.
- Branch naming and PR title/body constraints are enforced by tool instructions.
- Existing-PR detection fallback is intentional; do not remove without replacement logic.

## Pre-PR Checks

`bunx tsc --noEmit && bun run start`
