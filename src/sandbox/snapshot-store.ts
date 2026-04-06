/**
 * Filesystem-based Snapshot Store
 *
 * Stores snapshot metadata as JSON files on the filesystem.
 * Simple and reliable for single-server deployments.
 *
 * For distributed deployments, consider implementing SnapshotStore
 * with a database (PostgreSQL, Redis) or object storage (S3).
 *
 * References:
 * - Internal enterprise transformation plan (Phase 2)
 */

import { createLogger } from "../utils/logger";
import {
  type SnapshotStore,
  type SnapshotMetadata,
  type SnapshotKey,
  snapshotKeyToString,
  isSnapshotExpired,
} from "./snapshot-metadata";
import { mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const logger = createLogger("snapshot-store");

/**
 * Storage directory for snapshot metadata.
 * Can be overridden via SNAPSHOT_STORAGE_DIR env var.
 */
const STORAGE_DIR = process.env.SNAPSHOT_STORAGE_DIR || "/tmp/snapshots";

/**
 * File extension for snapshot metadata files.
 */
const METADATA_EXT = ".json";

/**
 * Filesystem-based implementation of SnapshotStore.
 */
export class FilesystemSnapshotStore implements SnapshotStore {
  private storageDir: string;

  constructor(storageDir: string = STORAGE_DIR) {
    this.storageDir = storageDir;
  }

  /**
   * Get the file path for a snapshot key.
   */
  private getFilePath(key: SnapshotKey): string {
    const keyStr = snapshotKeyToString(key);
    return join(this.storageDir, `${keyStr}${METADATA_EXT}`);
  }

  /**
   * Initialize the storage directory.
   */
  async initialize(): Promise<void> {
    if (!existsSync(this.storageDir)) {
      logger.info(
        `[snapshot-store] Creating storage directory: ${this.storageDir}`,
      );
      await mkdir(this.storageDir, { recursive: true });
    }
  }

  /**
   * Get snapshot metadata by key.
   */
  async get(key: SnapshotKey): Promise<SnapshotMetadata | null> {
    const filePath = this.getFilePath(key);

    try {
      const data = await readFile(filePath, "utf-8");
      const metadata = JSON.parse(data) as SnapshotMetadata;

      // Parse date strings back to Date objects
      metadata.createdAt = new Date(metadata.createdAt);
      metadata.refreshedAt = new Date(metadata.refreshedAt);

      return metadata;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      logger.warn({ error, key }, `[snapshot-store] Failed to read snapshot`);
      return null;
    }
  }

  /**
   * Save snapshot metadata.
   */
  async save(metadata: SnapshotMetadata): Promise<void> {
    await this.initialize();

    const filePath = this.getFilePath(metadata.key);

    try {
      const data = JSON.stringify(metadata, null, 2);
      await writeFile(filePath, data, "utf-8");
      logger.debug(
        { snapshotId: metadata.snapshotId, key: metadata.key },
        `[snapshot-store] Saved snapshot metadata`,
      );
    } catch (error) {
      logger.error(
        { error, metadata },
        `[snapshot-store] Failed to save snapshot`,
      );
      throw error;
    }
  }

  /**
   * List all snapshots for a repo (all profiles and branches).
   */
  async listByRepo(
    repoOwner: string,
    repoName: string,
  ): Promise<SnapshotMetadata[]> {
    await this.initialize();

    const snapshots: SnapshotMetadata[] = [];
    const prefix = `${repoOwner.toLowerCase()}/${repoName.toLowerCase()}/`;

    try {
      const files = await readdir(this.storageDir);

      for (const file of files) {
        if (!file.startsWith(prefix) || !file.endsWith(METADATA_EXT)) {
          continue;
        }

        try {
          const filePath = join(this.storageDir, file);
          const data = await readFile(filePath, "utf-8");
          const metadata = JSON.parse(data) as SnapshotMetadata;
          metadata.createdAt = new Date(metadata.createdAt);
          metadata.refreshedAt = new Date(metadata.refreshedAt);
          snapshots.push(metadata);
        } catch (error) {
          logger.warn(
            { error, file },
            `[snapshot-store] Failed to read snapshot file`,
          );
        }
      }
    } catch (error) {
      logger.error({ error }, `[snapshot-store] Failed to list snapshots`);
    }

    return snapshots;
  }

  /**
   * List all snapshots for a specific profile (all branches).
   */
  async listByProfile(
    params: Omit<SnapshotKey, "branch">,
  ): Promise<SnapshotMetadata[]> {
    await this.initialize();

    const snapshots: SnapshotMetadata[] = [];
    const prefix = `${params.repoOwner.toLowerCase()}/${params.repoName.toLowerCase()}/${params.profile}/`;

    try {
      const files = await readdir(this.storageDir);

      for (const file of files) {
        if (!file.startsWith(prefix) || !file.endsWith(METADATA_EXT)) {
          continue;
        }

        try {
          const filePath = join(this.storageDir, file);
          const data = await readFile(filePath, "utf-8");
          const metadata = JSON.parse(data) as SnapshotMetadata;
          metadata.createdAt = new Date(metadata.createdAt);
          metadata.refreshedAt = new Date(metadata.refreshedAt);
          snapshots.push(metadata);
        } catch (error) {
          logger.warn(
            { error, file },
            `[snapshot-store] Failed to read snapshot file`,
          );
        }
      }
    } catch (error) {
      logger.error({ error }, `[snapshot-store] Failed to list snapshots`);
    }

    return snapshots;
  }

  /**
   * Delete a snapshot.
   */
  async delete(key: SnapshotKey): Promise<void> {
    const filePath = this.getFilePath(key);

    try {
      await unlink(filePath);
      logger.debug({ key }, `[snapshot-store] Deleted snapshot`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return; // Already deleted
      }
      logger.warn({ error, key }, `[snapshot-store] Failed to delete snapshot`);
    }
  }

  /**
   * Clean up old snapshots beyond max age.
   * Returns the number of snapshots deleted.
   */
  async cleanup(maxAgeHours: number): Promise<number> {
    await this.initialize();

    let deleted = 0;

    try {
      const files = await readdir(this.storageDir);

      await Promise.all(
        files
          .filter((file) => file.endsWith(METADATA_EXT))
          .map(async (file) => {
            try {
              const filePath = join(this.storageDir, file);
              const data = await readFile(filePath, "utf-8");
              const metadata = JSON.parse(data) as SnapshotMetadata;
              metadata.createdAt = new Date(metadata.createdAt);
              metadata.refreshedAt = new Date(metadata.refreshedAt);

              if (isSnapshotExpired(metadata, maxAgeHours)) {
                await unlink(filePath);
                deleted++;
                logger.debug(
                  { snapshotId: metadata.snapshotId, file },
                  `[snapshot-store] Deleted expired snapshot`,
                );
              }
            } catch (error) {
              logger.warn(
                { error, file },
                `[snapshot-store] Failed to process snapshot file`,
              );
            }
          }),
      );
    } catch (error) {
      logger.error({ error }, `[snapshot-store] Failed during cleanup`);
    }

    if (deleted > 0) {
      logger.info({ deleted }, `[snapshot-store] Cleanup completed`);
    }

    return deleted;
  }
}

/**
 * Global snapshot store instance.
 */
export const globalSnapshotStore = new FilesystemSnapshotStore();

/**
 * Initialize the snapshot store (call at startup).
 */
export async function initializeSnapshotStore(): Promise<void> {
  await globalSnapshotStore.initialize();
}
