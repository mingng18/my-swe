/**
 * Sandbox Snapshots Module
 *
 * Provides snapshot functionality for fast sandbox initialization.
 * Supports multiple profiles (Node.js, Python, Java, etc.) per repository.
 *
 * Usage:
 * ```ts
 * import { globalSnapshotManager, globalSnapshotStore } from './sandbox';
 *
 * // Create a snapshot
 * const result = await globalSnapshotManager.createSnapshot(sandbox, {
 *   repoOwner: 'facebook',
 *   repoName: 'react',
 *   profile: 'typescript',
 *   branch: 'main',
 * });
 *
 * // Restore from snapshot
 * const restored = await globalSnapshotManager.restoreSnapshot(key, () => acquireSandbox());
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
} from './snapshot-metadata';

// Snapshot store
export {
  FilesystemSnapshotStore,
  globalSnapshotStore,
  initializeSnapshotStore,
} from './snapshot-store';

// Snapshot manager
export {
  SnapshotManager,
  globalSnapshotManager,
  initializeSnapshotManager,
  type SnapshotResult,
  type RestoreResult,
} from './snapshot-manager';

// Snapshot scheduler
export {
  SnapshotScheduler,
  globalSnapshotScheduler,
  startSnapshotScheduler,
  stopSnapshotScheduler,
  type SchedulerConfig,
  DEFAULT_SCHEDULER_CONFIG,
} from './snapshot-scheduler';
