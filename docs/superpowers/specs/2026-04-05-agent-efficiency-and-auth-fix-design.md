# Agent Efficiency & Push Auth Fix

Post-mortem driven improvements to the SWE agent. Two independent change clusters
address the root causes of slow agent execution (scope creep, bad search, full-file
reads, git history distraction) and broken PR submission (git push auth failure in
Daytona sandboxes).

## Problem Summary

### Cluster 1: Push Authentication Failure

`commit_and_open_pr` fails with `"Push verification failed: origin/<branch> does not
exist after push"`. The underlying cause is `gitPush()` writing a `/tmp/.git-credentials`
file with `git` as the username — GitHub tokens require `x-access-token`. Git ignores
the credential file and prompts interactively, which fails in a headless sandbox.
The agent then receives a generic verification error with no diagnostic information,
causing it to make random edits (e.g. touching `README.md`) trying to create new
commits, rather than diagnosing the auth problem.

### Cluster 2: Agent Wandering

For a simple "change icon color to black" task, the agent:
- Used `grep` with absolute paths, causing `No such file or directory` errors
- Read entire 400-line component files instead of searching for the relevant symbol
- Browsed `git log` and `.git/logs/HEAD` to find historical context
- Opened unrelated `Recipe.ts`, `RecipeRepository.ts`, `DatabaseFacade.ts`, and
  `recipeApi.ts` files because the system prompt doesn't prevent scope creep for
  UI-only tasks

## Proposed Changes

### Cluster 1: Push Auth

---

#### [MODIFY] github.ts (`src/utils/github/github.ts`)

Rewrite `gitPush()` to use URL-embedded token authentication instead of the
credential-file approach.

**New flow:**
1. `git remote get-url origin` → save original URL
2. Build token URL: `https://x-access-token:<TOKEN>@github.com/<owner>/<repo>.git`
3. `git remote set-url origin <tokenUrl>`
4. `git push origin <branch>`
5. `git remote set-url origin <originalUrl>` ← always runs in `finally` block
6. On error: strip token from message via `sanitizeTokenFromString()` before throwing

Add helper `sanitizeTokenFromString(msg: string, token: string): string` that
replaces all occurrences of the raw token with `***` in error messages and log
output, preventing accidental token leakage.

`setupGitCredentials` and `cleanupGitCredentials` remain exported for backward
compatibility but are no longer called by `gitPush`.

---

#### [MODIFY] commit-and-open-pr.ts (`src/tools/commit-and-open-pr.ts`)

Surface real push errors to the agent. Currently the catch block swallows the stderr.
After the `gitPush` rewrite, the error thrown will contain the actual git stderr
(e.g. `"fatal: Authentication failed"`, `"remote: Permission denied"`). The
`commit_and_open_pr` tool must pass this through as-is in the returned JSON `error`
field so the agent reads the real reason instead of guessing.

---

### Cluster 2: Agent Wandering

---

#### [NEW] code-search.ts (`src/tools/code-search.ts`)

A unified code search tool with two modes, selected by which parameters are provided.

**Search mode** (when `pattern` is given):

Runs ripgrep under the hood:
```
rg --json -n [--ignore-case] [-C context_lines] [-g file_glob] <pattern> <resolved_path>
```

- `path` is always joined with `workspaceDir` from `config.configurable` — agent can
  never cause a "No such file or directory" error with a wrong absolute path
- Returns structured results: `{ file, line, content, context_before[], context_after[] }`
- Capped at 50 matches to protect context window
- If `rg` is not installed, returns a clear actionable error — never silently falls
  back to `grep`

**Slice mode** (when `file_path` + `start_line` + `end_line` are given, no pattern):

Reads a specific line range without searching:
```
sed -n '<start>,<end>p' <resolved_file_path>
```

- `end_line` is clamped to `start_line + 200` maximum to prevent context blowout
- Returns: `{ line_number, content }[]` with line numbers intact
- `file_path` is resolved relative to `workspaceDir` if not an absolute path

**Schema:**
```typescript
z.object({
  // Search mode
  pattern: z.string().optional(),
  path: z.string().optional().default("."),
  file_glob: z.string().optional(),
  case_insensitive: z.boolean().optional().default(false),
  context_lines: z.number().optional().default(0),

  // Slice mode
  file_path: z.string().optional(),
  start_line: z.number().optional(),
  end_line: z.number().optional(),
})
```

**Validation:** At least one of `pattern` or (`file_path` + `start_line` + `end_line`)
must be provided, enforced at runtime with a clear error message.

---

#### [MODIFY] index.ts (`src/tools/index.ts`)

Export `codeSearchTool` alongside the existing tools.

---

#### Sandbox grep aliasing (sandbox init in `src/integrations/`)

In the sandbox initialization sequence (wherever the first `execute` call is made for
a new session), add a one-time setup command:

```bash
command -v rg > /dev/null 2>&1 \
  && echo 'alias grep="rg --color=never"' >> ~/.bashrc \
  || apt-get install -y ripgrep > /dev/null 2>&1
```

This ensures that even if the agent calls raw `grep` via `sandbox_shell` out of habit,
it gets ripgrep behavior (relative paths, fast search, no path errors). If `rg` is
not present it is installed silently.

---

#### [MODIFY] prompt.ts (`src/prompt.ts`)

**1. Add `code_search` to `TOOL_USAGE_SECTION`:**

```
#### `code_search`
Search for patterns across the codebase or read a specific line range from a file.
- **Search mode**: provide `pattern` and optionally `path`, `file_glob`, `context_lines`
- **Slice mode**: provide `file_path` + `start_line` + `end_line` (max 200 lines)
Paths are always resolved relative to the workspace. Prefer this over sandbox_shell
grep for all code search tasks.
```

**2. Tighten two lines in `TOOL_BEST_PRACTICES_SECTION`:**

| Before | After |
|---|---|
| `Search: Use \`execute\` to run search commands (\`grep\`, \`find\`, etc.) in the sandbox.` | `Search: Use \`code_search\` for all file searches. Never call \`grep\` or \`find\` via \`sandbox_shell\` for code search.` |
| `History: Use \`git log\` and \`git blame\` via \`execute\` for additional context when needed.` | `History: Only use \`git log\` or \`git blame\` when the task **explicitly** asks for historical analysis. Never read \`.git/\` directories.` |

**3. Add new `CODE_INVESTIGATION_SECTION`** (inserted after `TOOL_BEST_PRACTICES_SECTION`
in the `SYSTEM_PROMPT` concatenation):

```
### Code Investigation Rules

1. **Search first, read second.** Use \`code_search\` to find the exact file and line
   before opening anything. Read only the relevant slice, not the whole file.

2. **Stay in scope.** For UI/styling/color tasks, only open component and style files.
   Do NOT open database, API, repository, or state management files unless explicitly
   required by the task description.

3. **No git history browsing.** Do not run \`git log\`, \`git blame\`, or read anything
   under \`.git/\` unless the task explicitly asks for historical analysis.

4. **Stop when done.** Once the change is made and verified, call \`commit_and_open_pr\`
   immediately. Do not continue reading unrelated files to "double-check" things out of scope.

5. **Read slices, not files.** Use \`code_search\` slice mode with \`start_line\`/\`end_line\`
   to inspect file sections. Never dump an entire file into context unless it is under 50 lines.
```

## Verification Plan

### Automated Tests
- `bunx tsc --noEmit` — confirm no type errors across all modified files
- `bun test` — run existing test suite

### Manual Verification

**Cluster 1:**
- Trigger a task on `recipe-rn` that requires a code change
- Confirm `commit_and_open_pr` returns `{ success: true, pr_url: "..." }`
- Confirm the branch appears on `github.com/mingng18/recipe-rn`
- Confirm logs show `***` in place of the raw token if push fails

**Cluster 2:**
- Trigger a "change icon color" task
- Confirm agent uses `code_search` on first search attempt (no grep path errors)
- Confirm agent reads only the relevant component file (verify via trace)
- Confirm agent does not open `git log` or any non-UI files
- Confirm agent calls `commit_and_open_pr` directly after verifying the change
