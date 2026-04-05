/**
 * Sandbox Snapshots Module
 *
 * Provides snapshot functionality for fast sandbox initialization.
 * Supports multiple profiles (Node.js, Python, Java, etc.) per repository.
 *
 * Provider Support:
 * - Daytona: Full snapshot API (create, list, delete, create from snapshot)
 * - OpenSandbox: Pause/resume for state preservation
 *
 * Usage:
 * ```ts
 * import { DaytonaSnapshotManager, createDaytonaSnapshot } from './sandbox';
 *
 * // Daytona: Create snapshot for TypeScript profile
 * const result = await createDaytonaSnapshot(daytona, repoDir, 'typescript', 'main');
 * const sandbox = await manager.createSandboxFromSnapshot(result.snapshotName);
 *
 * // Restore is automatic - snapshots are checked before creating new sandboxes
 * ```
 *
 * References:
 * - Internal enterprise transformation plan (Phase 2)
 */

// Metadata and types
export {
  type SnapshotKey,
  type SnapshotMetadata,
  type SnapshotOptions,
  type SnapshotStore,
  createSnapshotKey,
  snapshotKeyToString,
  parseSnapshotKey,
  isSnapshotExpired,
  detectProfileFromFiles,
  getDefaultBranch,
  PROFILE_SETUP_COMMANDS,
  PROFILE_DEPENDENCY_FILES,
} from "./snapshot-metadata";

// Snapshot store
export {
  FilesystemSnapshotStore,
  globalSnapshotStore,
  initializeSnapshotStore,
} from "./snapshot-store";

// Snapshot manager
export {
  SnapshotManager,
  globalSnapshotManager,
  initializeSnapshotManager,
  type SnapshotResult,
  type RestoreResult,
} from "./snapshot-manager";

// Snapshot scheduler
export {
  SnapshotScheduler,
  globalSnapshotScheduler,
  startSnapshotScheduler,
  stopSnapshotScheduler,
  type SchedulerConfig,
  DEFAULT_SCHEDULER_CONFIG,
} from "./snapshot-scheduler";

// Daytona snapshot integration
export {
  DaytonaSnapshotManager,
  ProfileImageBuilder,
  createDaytonaSnapshot,
  createImageFromRepo,
  type DaytonaSnapshotResult,
} from "./daytona-snapshot-integration";
