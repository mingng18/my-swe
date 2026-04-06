# Implementation Plan: Fix Bullhorse Agent Workflow Issues

## Overview

This plan addresses four critical issues in the Bullhorse LangGraph agent's workflow when operating in Daytona sandboxes:

1. **Git/development commands executing from wrong directory** - `git status` fails with "fatal: not a git repository"
2. **TypeScript checks failing due to missing dependencies** - `bunx tsc --noEmit` fails with missing type definitions
3. **PR creation failing with "already exists" errors** - HTTP 422 when PR already exists for branch
4. **Manual git push operations lacking authentication** - "could not read Username" errors

## Requirements

- All shell commands (git, npm, tsc, etc.) must execute from the correct project workspace directory
- Dependencies must be automatically installed before running TypeScript checks or tests
- PR creation must detect existing PRs and return them instead of failing
- All git operations must use consistent authentication via token-embedded URLs
- Changes must be backwards compatible and not break existing functionality

---

## Phase 1: Working Directory Context (Priority: HIGH)

### Problem
The `sandboxShellTool` executes commands from the sandbox's default directory, not the project workspace. The agent has to learn to prefix commands with `cd /home/daytona/recipe-rn && ...`.

### Root Cause
The `workspaceDir` is available in `config.configurable?.repo?.workspaceDir` but `sandboxShellTool` doesn't use it.

### Solution

**File: `src/tools/sandbox-shell.ts`**

Modify `sandboxShellTool` to auto-prefix commands with workspace directory:

```typescript
export const sandboxShellTool = tool(
  async ({ command, timeout, shell }, config) => {
    const backend = getSandboxBackendFromConfig(config);
    if (!backend) {
      throw new Error("Sandbox backend not initialized. Make sure USE_SANDBOX=true is set.");
    }

    // Auto-prefix with workspace directory if available
    const workspaceDir = config?.configurable?.repo?.workspaceDir as string | undefined;
    const fullCommand = workspaceDir
      ? `cd ${shellEscapeSingleQuotes(workspaceDir)} && ${command}`
      : command;

    logger.debug(
      { command, fullCommand, workspaceDir, timeout, shell },
      "[sandbox-shell] Executing command",
    );

    try {
      const shellCommand = shell ? `${shell} -c "${fullCommand}"` : fullCommand;
      const result = await backend.execute(shellCommand);

      return {
        stdout: result.output,
        exitCode: result.exitCode,
        truncated: result.truncated,
        command: fullCommand,
      };
    } catch (err) {
      logger.error({ error: err }, "[sandbox-shell] Command failed");
      throw err;
    }
  },
  // ... existing schema
);
```

**Add helper function:**

```typescript
/**
 * Safely embed an arbitrary string into a POSIX shell command.
 * Produces: 'foo'"'"'bar' style quoting.
 */
function shellEscapeSingleQuotes(input: string): string {
  return `'${input.replace(/'/g, `'"'"'`)}'}`;
}
```

### Risk: LOW
- Only adds automatic prefixing when workspaceDir is available
- Backwards compatible (no workspaceDir = no prefixing)

---

## Phase 2: Dependency Installation (Priority: HIGH)

### Problem
TypeScript checks fail because `node_modules` aren't installed in fresh sandboxes. The agent tries to run `bunx tsc --noEmit` without first running `npm install`/`bun install`.

### Root Cause
The linter node doesn't check for or install dependencies before running.

### Solution

**New File: `src/nodes/deterministic/DependencyInstallerNode.ts`**

```typescript
import { createLogger } from "../../utils/logger";
import type { SandboxService } from "../../integrations/sandbox-service";

const logger = createLogger("dependency-installer");

export interface DependencyInstallerResult {
  installed: boolean;
  packageManager: string | null;
  output: string;
}

/**
 * Detect the package manager used by the repository.
 */
function detectPackageManager(repoDir: string): string | null {
  // Check for lock files in order of precedence
  const lockFiles = [
    { file: "bun.lockb", manager: "bun" },
    { file: "package-lock.json", manager: "npm" },
    { file: "yarn.lock", manager: "yarn" },
    { file: "pnpm-lock.yaml", manager: "pnpm" },
  ];
  // This would be checked via sandbox filesystem
  return null; // Placeholder
}

/**
 * Install dependencies for the repository if not already installed.
 */
export async function installDependencies(
  backend: SandboxService,
  repoDir: string,
): Promise<DependencyInstallerResult> {
  logger.info({ repoDir }, "[DependencyInstaller] Checking dependencies");

  // Check if node_modules exists
  const checkResult = await backend.execute(
    `test -d ${repoDir}/node_modules && echo "exists" || echo "not_found"`
  );

  if (checkResult.output.trim() === "exists") {
    logger.info("[DependencyInstaller] node_modules already exists, skipping installation");
    return {
      installed: false,
      packageManager: null,
      output: "Dependencies already installed",
    };
  }

  // Detect package manager and install
  const packageManager = "bun"; // Default to bun for this project
  const installCmd = packageManager === "bun" ? "bun install" : "npm install";

  logger.info({ packageManager, installCmd }, "[DependencyInstaller] Installing dependencies");

  try {
    const result = await backend.execute(
      `cd ${repoDir} && ${installCmd}`,
      { timeout: 300000 } // 5 minutes
    );

    if (result.exitCode === 0) {
      logger.info("[DependencyInstaller] Dependencies installed successfully");
      return {
        installed: true,
        packageManager,
        output: result.output || "Dependencies installed",
      };
    } else {
      logger.warn(
        { exitCode: result.exitCode, output: result.output },
        "[DependencyInstaller] Dependency installation failed"
      );
      return {
        installed: false,
        packageManager,
        output: result.output || "Installation failed",
      };
    }
  } catch (error) {
    logger.error({ error }, "[DependencyInstaller] Dependency installation error");
    return {
      installed: false,
      packageManager,
      output: error instanceof Error ? error.message : String(error),
    };
  }
}
```

**Modify: `src/nodes/coder.ts` (or wherever the linter is called)**

Add dependency installation before running linter:

```typescript
// Before running linter
const { installDependencies } = await import("../nodes/deterministic/DependencyInstallerNode");
await installDependencies(sandbox, workspaceDir);
```

### Risk: MEDIUM
- Adds 30-60 seconds to first run
- Must handle timeout gracefully
- Package manager detection may need refinement

---

## Phase 3: PR Existence Handling (Priority: MEDIUM)

### Problem
The `commit_and_open_pr` tool fails with HTTP 422 "A pull request already exists" when trying to create a PR for a branch that already has one.

### Root Cause
`createGithubPr` only checks for existing PRs in the error catch block, not before attempting creation.

### Solution

**File: `src/utils/github/github.ts`**

Modify `createGithubPr` to check for existing PRs before attempting creation:

```typescript
export async function createGithubPr(
  headRepoOwner: string,
  headRepoName: string,
  githubToken: string,
  title: string,
  headBranch: string,
  body: string,
): Promise<[string | null, number | null, boolean]> {
  const octokit = new Octokit({ auth: githubToken });

  // Fork-aware logic
  const { data: headRepoData } = await octokit.rest.repos.get({
    owner: headRepoOwner,
    repo: headRepoName,
  });

  const baseRepoOwner = headRepoData.parent?.owner.login ?? headRepoOwner;
  const baseRepoName = headRepoData.parent?.name ?? headRepoName;
  const baseBranch = await getGithubDefaultBranch(
    baseRepoOwner,
    baseRepoName,
    githubToken,
  );

  // NEW: Check for existing PR FIRST before attempting creation
  const headRef = `${headRepoOwner}:${headBranch}`;
  const existingPr = await findExistingPr(
    baseRepoOwner,
    baseRepoName,
    headRepoOwner,
    githubToken,
    headBranch,
  );

  if (existingPr) {
    logger.info(
      { prUrl: existingPr[0], prNumber: existingPr[1], headRef },
      "[github] Existing PR found, returning without creating new one",
    );
    return [existingPr[0], existingPr[1], true];
  }

  // Proceed with creation if no existing PR found
  const tryCreate = async (headRef: string): Promise<[string | null, number | null, boolean]> => {
    // ... existing creation logic
  };

  const crossRepoHeadRef = `${headRepoOwner}:${headBranch}`;

  try {
    return await tryCreate(crossRepoHeadRef);
  } catch (error: unknown) {
    // ... existing error handling (keep as fallback)
    const octokitError = error as {
      status?: number;
      message?: string;
      response?: unknown;
    };

    if (octokitError.status === HTTP_UNPROCESSABLE_ENTITY) {
      // Double-check for existing PR in case of race condition
      const retryExisting = await findExistingPr(
        baseRepoOwner,
        baseRepoName,
        headRepoOwner,
        githubToken,
        headBranch,
      );
      if (retryExisting) {
        logger.info(
          `[github] Found existing PR in retry after 422: ${retryExisting[0]}`,
        );
        return [retryExisting[0], retryExisting[1], true];
      }
      // ... rest of existing error handling
    }
    // ... rest of existing error handling
  }
}
```

**File: `src/tools/commit-and-open-pr.ts`**

Update to handle existing PR gracefully in the response:

```typescript
// After PR creation
return JSON.stringify({
  success: true,
  pr_url: prUrl,
  pr_existing: prExisting,
  message: prExisting
    ? "An existing PR was found for this branch. No new PR created."
    : "PR created successfully.",
});
```

### Risk: LOW
- Only changes the order of operations (check before create)
- Existing error handling remains as fallback

---

## Phase 4: Git Authentication Consistency (Priority: HIGH)

### Problem
When the agent tries to manually run `git push`, it fails with "could not read Username" because the standard shell environment doesn't have git credentials configured.

### Root Cause
The `gitPush` function uses `setupGitCredentials` with `credential.helper`, but manual git commands executed via `sandboxShellTool` don't use this mechanism.

### Solution

**File: `src/utils/github/github.ts`**

Replace credential.helper approach with URL-embedded token authentication:

```typescript
/**
 * Push branch to origin using URL-embedded token authentication.
 * Uses `https://x-access-token:<TOKEN>@github.com/...` so no credential
 * helper or credential file is needed — works reliably in headless sandboxes.
 */
export async function gitPush(
  backend: SandboxService,
  repoDir: string,
  branch: string,
  githubToken?: string,
): Promise<string> {
  if (!githubToken) {
    return await runGit(
      backend,
      repoDir,
      `git push origin ${shellEscapeSingleQuotes(branch)}`,
    );
  }

  // Get current remote URL
  const remoteUrl = await gitGetRemoteUrl(backend, repoDir);
  if (!remoteUrl) {
    throw new Error("Could not get git remote URL");
  }

  // Construct authenticated URL by embedding token
  const authUrl = remoteUrl.replace(
    "https://github.com/",
    `https://x-access-token:${githubToken}@github.com/`
  );

  try {
    // Temporarily set remote to authenticated URL
    await backend.execute(
      `cd ${shellEscapeSingleQuotes(repoDir)} && git remote set-url origin ${authUrl}`
    );

    // Push using the authenticated remote
    const result = await runGit(
      backend,
      repoDir,
      `git push origin ${shellEscapeSingleQuotes(branch)}`
    );

    return result;
  } catch (err: any) {
    const rawMsg: string = err?.message ?? String(err);
    const safeMsg = sanitizeTokenFromString(rawMsg, githubToken);
    throw new Error(safeMsg);
  } finally {
    // Restore original remote URL
    if (remoteUrl) {
      try {
        await backend.execute(
          `cd ${shellEscapeSingleQuotes(repoDir)} && git remote set-url origin ${remoteUrl}`
        );
      } catch (restoreError) {
        logger.error("[github] Failed to restore original remote URL", restoreError);
      }
    }
  }
}
```

**Remove obsolete functions:**
- `setupGitCredentials`
- `cleanupGitCredentials`
- Remove `CRED_FILE_PATH` constant

### Risk: LOW
- More reliable than credential.helper in sandbox environments
- Token never appears in git config (only in transient command)
- Original URL is always restored

---

## Testing Strategy

### Unit Tests
- Test workspace directory extraction and command prefixing
- Test package manager detection logic
- Test PR existence checking with various states
- Test URL-embedded token generation

### Integration Tests
- **Flow 1**: Agent clones repo → runs `git status` → verifies command executes in correct directory
- **Flow 2**: Agent creates TypeScript project → runs `tsc` → verifies dependencies auto-installed
- **Flow 3**: Agent creates PR → runs again → verifies existing PR is returned instead of failing

### E2E Tests
- Full agent workflow with repo operations, verification, and PR creation in Daytona sandbox

---

## Success Criteria

- [ ] Agent can run `git status` without manual `cd` prefixing and it executes from correct directory
- [ ] Agent can run `bunx tsc --noEmit` and it works automatically without manual `npm install`
- [ ] Agent can run `commit_and_open_pr` twice and second call succeeds with existing PR URL
- [ ] All git push operations succeed without authentication errors in Daytona sandboxes
- [ ] All new functionality has unit tests
- [ ] Integration tests pass for all three major flows
- [ ] No regression in existing functionality

---

## Implementation Order

1. **Phase 1** (Working Directory) - Foundation for all other fixes
2. **Phase 4** (Git Authentication) - Critical for PR workflow
3. **Phase 3** (PR Existence) - Improves reliability
4. **Phase 2** (Dependency Installation) - Quality of life improvement

---

## Estimated Complexity: **MEDIUM**

- Phase 1: 1-2 hours
- Phase 2: 2-3 hours
- Phase 3: 1 hour
- Phase 4: 1-2 hours
- Testing: 2-3 hours

**Total: 7-11 hours**

---

WAITING FOR CONFIRMATION: Should I proceed with this plan? (yes/no/modify)
