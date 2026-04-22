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
import fs from "node:fs";
import { mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const logger = createLogger("snapshot-store");

/**
 * Storage directory for snapshot metadata.
 * Can be overridden via SNAPSHOT_STORAGE_DIR env var.
 */
const STORAGE_DIR = process.env.SNAPSHOT_STORAGE_DIR || "/tmp/snapshots";

/**
 * Cache TTL in milliseconds.
 * Can be overridden via SNAPSHOT_CACHE_TTL_MS env var.
 * Default: 5 minutes
 */
const CACHE_TTL_MS = Number.parseInt(process.env.SNAPSHOT_CACHE_TTL_MS || "300000", 10);

/**
 * File extension for snapshot metadata files.
 */
const METADATA_EXT = ".json";

/**
 * Cache entry with timestamp for TTL expiration.
 */
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

/**
 * Cache statistics for monitoring cache performance.
 */
interface CacheStats {
  hits: number;
  misses: number;
}

/**
 * Filesystem-based implementation of SnapshotStore.
 */
export class FilesystemSnapshotStore implements SnapshotStore {
  private storageDir: string;
  private cache: Map<string, CacheEntry<SnapshotMetadata>>;
  private listAllCache: CacheEntry<SnapshotMetadata[]> | null;
  private cacheStats: CacheStats;

  constructor(storageDir: string = STORAGE_DIR) {
    this.storageDir = storageDir;
    this.cache = new Map();
    this.listAllCache = null;
    this.cacheStats = { hits: 0, misses: 0 };
  }

  /**
   * Get the file path for a snapshot key.
   */
  private getFilePath(key: SnapshotKey): string {
    const keyStr = snapshotKeyToString(key);
    return join(this.storageDir, `${keyStr}${METADATA_EXT}`);
  }

  /**
   * Generate a cache key for a snapshot key.
   */
  private getCacheKey(key: SnapshotKey): string {
    return snapshotKeyToString(key);
  }

  /**
   * Get snapshot metadata from cache if valid (not expired).
   * Returns null if not in cache or expired.
   */
  private getFromCache(key: SnapshotKey): SnapshotMetadata | null {
    const cacheKey = this.getCacheKey(key);
    const entry = this.cache.get(cacheKey);

    if (!entry) {
      this.cacheStats.misses++;
      return null;
    }

    // Check if entry has expired
    const now = Date.now();
    const age = now - entry.timestamp;
    if (age > CACHE_TTL_MS) {
      this.cache.delete(cacheKey);
      this.cacheStats.misses++;
      return null;
    }

    this.cacheStats.hits++;
    return entry.data;
  }

  /**
   * Store snapshot metadata in cache with current timestamp.
   */
  private setInCache(metadata: SnapshotMetadata): void {
    const cacheKey = this.getCacheKey(metadata.key);
    const entry: CacheEntry<SnapshotMetadata> = {
      data: metadata,
      timestamp: Date.now(),
    };
    this.cache.set(cacheKey, entry);
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
    // Check cache first
    const cached = this.getFromCache(key);
    if (cached !== null) {
      return cached;
    }

    // Cache miss - read from filesystem
    const filePath = this.getFilePath(key);

    try {
      const data = await readFile(filePath, "utf-8");
      const metadata = JSON.parse(data) as SnapshotMetadata;

      // Parse date strings back to Date objects
      metadata.createdAt = new Date(metadata.createdAt);
      metadata.refreshedAt = new Date(metadata.refreshedAt);

      // Cache the result for future reads
      this.setInCache(metadata);

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

      // Update the individual cache entry
      this.setInCache(metadata);

      // Invalidate the listAll cache since the snapshot list has changed
      this.listAllCache = null;

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

      const filteredFiles = files.filter(
        (file) => file.startsWith(prefix) && file.endsWith(METADATA_EXT),
      );

      const metadataPromises = filteredFiles.map(async (file) => {
        try {
          const filePath = join(this.storageDir, file);
          const data = await readFile(filePath, "utf-8");
          const metadata = JSON.parse(data) as SnapshotMetadata;
          metadata.createdAt = new Date(metadata.createdAt);
          metadata.refreshedAt = new Date(metadata.refreshedAt);
          return metadata;
        } catch (error) {
          logger.warn(
            { error, file },
            `[snapshot-store] Failed to read snapshot file`,
          );
          return null;
        }
      });

      const results = await Promise.all(metadataPromises);
      for (const metadata of results) {
        if (metadata) {
          snapshots.push(metadata);
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

      const filteredFiles = files.filter(
        (file) => file.startsWith(prefix) && file.endsWith(METADATA_EXT),
      );

      const metadataPromises = filteredFiles.map(async (file) => {
        try {
          const filePath = join(this.storageDir, file);
          const data = await readFile(filePath, "utf-8");
          const metadata = JSON.parse(data) as SnapshotMetadata;
          metadata.createdAt = new Date(metadata.createdAt);
          metadata.refreshedAt = new Date(metadata.refreshedAt);
          return metadata;
        } catch (error) {
          logger.warn(
            { error, file },
            `[snapshot-store] Failed to read snapshot file`,
          );
          return null;
        }
      });

      const results = await Promise.all(metadataPromises);
      for (const metadata of results) {
        if (metadata) {
          snapshots.push(metadata);
        }
      }
    } catch (error) {
      logger.error({ error }, `[snapshot-store] Failed to list snapshots`);
    }

    return snapshots;
  }

  /**
   * List all snapshots.
   */
  async listAll(): Promise<SnapshotMetadata[]> {
    await this.initialize();

    const snapshots: SnapshotMetadata[] = [];

    try {
      // Find all JSON files recursively using a helper function
      const findFiles = async (dir: string): Promise<string[]> => {
        const dirents = await fs.promises.readdir(dir, { withFileTypes: true });
        const files = await Promise.all(
          dirents.map((dirent) => {
            const res = resolve(dir, dirent.name);
            return dirent.isDirectory() ? findFiles(res) : res;
          }),
        );
        return Array.prototype.concat(...files);
      };

      const files = await findFiles(this.storageDir);

      const filteredFiles = files.filter((filePath) =>
        filePath.endsWith(METADATA_EXT),
      );

      const readPromises = filteredFiles.map(async (filePath) => {
        try {
          const data = await readFile(filePath, "utf-8");
          const metadata = JSON.parse(data) as SnapshotMetadata;
          metadata.createdAt = new Date(metadata.createdAt);
          metadata.refreshedAt = new Date(metadata.refreshedAt);
          return metadata;
        } catch (error) {
          logger.warn(
            { error, file: filePath },
            `[snapshot-store] Failed to read snapshot file`,
          );
          return null;
        }
      });

      const results = await Promise.all(readPromises);
      for (const metadata of results) {
        if (metadata) {
          snapshots.push(metadata);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        logger.error(
          { error },
          `[snapshot-store] Failed to list all snapshots`,
        );
      }
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

      const filteredFiles = files.filter((file) => file.endsWith(METADATA_EXT));

      const deletePromises = filteredFiles.map(async (file) => {
        try {
          const filePath = join(this.storageDir, file);
          const data = await readFile(filePath, "utf-8");
          const metadata = JSON.parse(data) as SnapshotMetadata;
          metadata.createdAt = new Date(metadata.createdAt);
          metadata.refreshedAt = new Date(metadata.refreshedAt);

          if (isSnapshotExpired(metadata, maxAgeHours)) {
            await unlink(filePath);
            logger.debug(
              { snapshotId: metadata.snapshotId, file },
              `[snapshot-store] Deleted expired snapshot`,
            );
            return 1;
          }
          return 0;
        } catch (error) {
          logger.warn(
            { error, file },
            `[snapshot-store] Failed to process snapshot file`,
          );
          return 0;
        }
      });

      const results = await Promise.all(deletePromises);
      deleted = results.reduce((sum: number, count) => sum + count, 0);
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
