# Open SWE: After the agent successfully edits code

Handoff doc for **what the agent is supposed to do once implementation is done**, and **what the code does** (`commit_and_open_pr` + `open_pr_if_needed`). No LangGraph/Deep Agents architecture here.

---

## 1. When this applies

This flow is for **tasks that change the codebase**. The model has already used file/shell tools and the edits are in the **sandbox git working tree** (or committed locally but not yet pushed).

**Source of truth for agent instructions:** [`agent/prompt.py`](../agent/prompt.py) — *Task Execution*.

---

## 2. What the agent must do (prompt contract)

Ordered steps the system prompt requires:

| Step | Action |
|------|--------|
| **Verify** | Run linters and **only tests tied to files you changed**. Do **not** run the full test suite. |
| **Submit** | Call **`commit_and_open_pr`** with PR title, body, and optional commit message. |
| **Comment** | Call **`linear_comment`**, **`slack_thread_reply`**, or **`github_comment`** (depending on how the task was triggered) with a short summary and the **PR URL**. |

**Hard rule:** Only say the PR was opened/updated if **`commit_and_open_pr`** returns `success: true` and a **`pr_url`**. If you get `"No changes detected"` or an error, say that explicitly—do not claim a PR.

---

## 3. Tool: `commit_and_open_pr`

**File:** [`agent/tools/commit_and_open_pr.py`](../agent/tools/commit_and_open_pr.py)

### 3.1 What it does (mechanically)

1. Loads **thread**, **repo** (`owner` / `name`), and **sandbox** from LangGraph config.
2. If there are **no** uncommitted changes **and** **no** unpushed commits → returns **failure** `"No changes detected"`.
3. Ensures checkout on the right branch:
   - If run metadata has **`branch_name`** → use that (e.g. existing PR branch).
   - Else → branch `open-swe/{thread_id}`.
4. Sets git **`user.name` / `user.email`** to the Open SWE bot.
5. **`git add` (all)** → **`git commit`** (if there are uncommitted changes). Commit message may get a **Co-authored-by** trailer for the human who triggered the run.
6. **`git push`** using the **GitHub App installation** token.
7. **`create_github_pr`** — opens a **draft** PR against the repo default branch, or aligns with an existing PR for that head branch (see implementation for `pr_existing`).

### 3.2 Example: happy-path tool call

```text
commit_and_open_pr(
  title="fix: null-check user profile before read [closes ENG-42]",
  body="""## Description
Prevents 500 when `getProfile` runs for users without a profile row.

Resolves ENG-42

## Test Plan
- [ ] Log in with test user that has no profile
""",
  commit_message="fix: guard missing profile in getProfile",
)
```

**Example success return:**

```json
{
  "success": true,
  "error": null,
  "pr_url": "https://github.com/acme/api/pull/99",
  "pr_existing": false
}
```

### 3.3 Example: nothing to ship

```json
{
  "success": false,
  "error": "No changes detected",
  "pr_url": null
}
```

The agent should **not** post “opened a PR” after this.

### 3.4 Title/body rules (enforced in docstring)

The tool’s docstring requires:

- **Title:** `<type>: <lowercase description> [closes PROJECT-ID-NUMBER]` under ~70 chars; `type` ∈ `fix` | `feat` | `chore` | `ci`.
- **Body:** `## Description` + `## Test Plan` with checkboxes only for **new** verification steps (not “run all tests”).

Another agent customizing behavior should keep prompt + tool docstring aligned.

---

## 4. Follow-up: channel comment

After a **successful** `commit_and_open_pr`, the agent should notify in the **same channel** that started the task:

| Trigger | Tool |
|---------|------|
| Linear | `linear_comment` |
| Slack | `slack_thread_reply` |
| GitHub issue/PR | `github_comment` |

**Prompt excerpt** ([`agent/prompt.py`](../agent/prompt.py)):

- Use `linear_comment` / `slack_thread_reply` / `github_comment` for updates during work **and** for the final summary **with PR link** after submit.

**Example final Linear comment (illustrative):**

```text
Implemented the null check in getProfile and added a regression test in test_auth.py.
Draft PR: https://github.com/acme/api/pull/99
```

---

## 5. Middleware safety net: `open_pr_if_needed`

**File:** [`agent/middleware/open_pr.py`](../agent/middleware/open_pr.py)

Runs **once after the agent run** finishes (`@after_agent`).

### 5.1 If `commit_and_open_pr` already succeeded

The middleware scans messages for a **`commit_and_open_pr`** tool result. If the parsed JSON includes the key **`"success"`**, it **exits immediately** — no second commit, no duplicate PR attempt.

So the **normal** path is: tool does everything → middleware is a **no-op**.

### 5.2 If the tool was invoked but success is not recorded that way

If there is a `commit_and_open_pr` tool message **without** `"success"` in the payload, **and** git still shows uncommitted or unpushed work, the middleware reuses **title / body / commit_message** from that tool call and tries **add → commit → push → create PR** itself.

### 5.3 If there was no `commit_and_open_pr` call

It **does not** create a PR (no title/body to use). Logs and skips.

---

## 6. Quick checklist for another agent

- [ ] After edits: **verify** (lint + targeted tests only).
- [ ] Call **`commit_and_open_pr`** with valid title/body shape.
- [ ] Read return value; only then claim PR opened.
- [ ] Call the right **comment** tool with **`pr_url`**.
- [ ] Do not rely on **`open_pr_if_needed`** for the happy path—it is a **backup** when the tool path is incomplete.

---

*Scope: post-edit workflow only. For sandbox/graph setup, see [`CUSTOMIZATION.md`](../CUSTOMIZATION.md) and [`agent/server.py`](../agent/server.py).*
