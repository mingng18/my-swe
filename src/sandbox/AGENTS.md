# AGENTS.md for `src/sandbox/`

## Package Identity

Snapshot management system for fast sandbox initialization.
Provides multi-profile support (Node.js, Python, Java, etc.) with automatic dependency detection and installation.
Integrates with Daytona and OpenSandbox providers for snapshot creation, storage, and restoration.

## Setup & Run

- Typecheck: `bunx tsc --noEmit`
- Run with snapshot manager: `bun run start`
- Initialize snapshot store: `bun run prewarm` (calls `initializeSnapshotStore()`)
- Test snapshot operations: `bun test src/sandbox/__tests__/`

## Patterns & Conventions

- ✅ DO: Use `SnapshotManager` class for all snapshot lifecycle operations (create, restore, delete).
- ✅ DO: Define profiles in `src/sandbox/snapshot-metadata.ts` using `SandboxProfile` type.
- ✅ DO: Store snapshot metadata in `SnapshotStore` interface (currently Supabase-backed).
- ✅ DO: Use `createSnapshotKey()` for consistent cache keys (repoOwner/repoName/profile/branch).
- ✅ DO: Implement provider-specific snapshot APIs in separate files (e.g., `daytona-snapshot-integration.ts`).
- ✅ DO: Detect dependencies from lockfiles (package.json, requirements.txt, pom.xml) before snapshotting.
- ❌ DON'T: Directly call provider snapshot APIs without going through `SnapshotManager`.
- ❌ DON'T: Assume all providers support snapshots; implement fallback to fresh sandbox.
- ❌ DON'T: Cache snapshots indefinitely; implement TTL and refresh logic.

## Touch Points / Key Files

- Snapshot manager: `src/sandbox/snapshot-manager.ts`
- Metadata and profiles: `src/sandbox/snapshot-metadata.ts`
- Snapshot store: `src/sandbox/snapshot-store.ts`
- Daytona integration: `src/sandbox/daytona-snapshot-integration.ts`
- Snapshot scheduler: `src/sandbox/snapshot-scheduler.ts`

## JIT Index Hints

- Find snapshot operations: `rg -n "createSnapshot|restoreSnapshot|deleteSnapshot" src/sandbox`
- Find profile definitions: `rg -n "PROFILE_|SandboxProfile|detectProfileFromFiles" src/sandbox/snapshot-metadata.ts`
- Find provider integration: `rg -n "daytona|opensandbox|getProvider" src/sandbox`
- Find snapshot store operations: `rg -n "save|get|delete" src/sandbox/snapshot-store.ts`

## Common Gotchas

- Daytona snapshot API is provider-specific; OpenSandbox may not have equivalent functionality.
- Snapshot size estimation is heuristic-based; provider-reported sizes vary by implementation.
- Dependency installation (npm install, pip install) can fail silently; log and continue.
- Pre-build steps (npm run build, mvn compile) are optional but improve snapshot readiness.
- Snapshot refresh should prevent concurrent refreshes of the same key (via `pendingRefreshes` Set).

## Pre-PR Checks

`bunx tsc --noEmit && bun run prewarm && bun run start`
