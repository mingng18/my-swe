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
 *
 * Environment variable: SNAPSHOT_STORAGE_DIR
 * Default: /tmp/snapshots
 */
const STORAGE_DIR = process.env.SNAPSHOT_STORAGE_DIR || "/tmp/snapshots";

/**
 * Cache TTL in milliseconds.
 * Can be overridden via SNAPSHOT_CACHE_TTL_MS env var.
 *
 * Environment variable: SNAPSHOT_CACHE_TTL_MS
 * Default: 300000 (5 minutes)
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
  /** Cached snapshot metadata */
  data: T;

  /** Unix timestamp in milliseconds when entry was cached */
  timestamp: number;
}

/**
 * Cache statistics for monitoring cache performance.
 * Used for debugging and optimizing cache behavior.
 */
export interface CacheStats {
  /** Number of successful cache hits */
  hits: number;

  /** Number of cache misses */
  misses: number;
}

/**
 * Filesystem-based implementation of SnapshotStore with in-memory caching.
 *
 * Caching strategy:
 * - Individual snapshots are cached by key with TTL expiration
 * - List operations are cached separately to avoid repeated filesystem scans
 * - Cache statistics are tracked for monitoring and debugging
 *
 * The cache is write-through: saves update both cache and filesystem.
 * Reads check cache first, falling back to filesystem on miss.
 *
 * Thread safety: Not thread-safe. Use a single instance or external synchronization.
 */
export class FilesystemSnapshotStore implements SnapshotStore {
  /** Directory where snapshot metadata files are stored */
  private storageDir: string;

  /** Cache for individual snapshot metadata by key */
  private cache: Map<string, CacheEntry<SnapshotMetadata>>;

  /** Cache for listAll() operation results */
  private listAllCache: CacheEntry<SnapshotMetadata[]> | null;

  /** Cache performance statistics */
  private cacheStats: CacheStats;

  /**
   * Create a new filesystem snapshot store.
   *
   * @param storageDir - Directory path for storing snapshot metadata files.
   *                    Defaults to SNAPSHOT_STORAGE_DIR env var or /tmp/snapshots.
   */
  constructor(storageDir: string = STORAGE_DIR) {
    this.storageDir = storageDir;
    this.cache = new Map();
    this.listAllCache = null;
    this.cacheStats = { hits: 0, misses: 0 };
  }

  /**
   * Get the filesystem path for a snapshot metadata file.
   *
   * @param key - Snapshot key to generate path for
   * @returns Absolute file path to the snapshot metadata JSON file
   */
  private getFilePath(key: SnapshotKey): string {
    const keyStr = snapshotKeyToString(key);
    return join(this.storageDir, `${keyStr}${METADATA_EXT}`);
  }

  /**
   * Generate a cache key string for a snapshot key.
   * Uses the same string format as filesystem paths for consistency.
   *
   * @param key - Snapshot key to generate cache key for
   * @returns String key suitable for Map lookup
   */
  private getCacheKey(key: SnapshotKey): string {
    return snapshotKeyToString(key);
  }

  /**
   * Get snapshot metadata from cache if valid (not expired).
   * Updates cache statistics (hits/misses) on every call.
   *
   * @param key - Snapshot key to look up
   * @returns Cached metadata if found and valid, null otherwise
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
   * Overwrites any existing entry for the same key.
   *
   * @param metadata - Snapshot metadata to cache
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
   * Creates the directory if it doesn't exist.
   * Called automatically on first operation, but can be called explicitly at startup.
   *
   * @returns Promise that resolves when directory is ready
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
   * Clear all caches for manual cache invalidation.
   * Clears individual snapshot cache, listAll cache, and resets statistics.
   *
   * Use this when:
   * - External changes to the filesystem are detected
   * - Testing or debugging requires fresh data
   * - Cache consistency issues are suspected
   */
  clearCache(): void {
    this.cache.clear();
    this.listAllCache = null;
    this.cacheStats = { hits: 0, misses: 0 };
    logger.debug(`[snapshot-store] Cache cleared`);
  }

  /**
   * Get current cache statistics for debugging and monitoring.
   * Returns a copy of the statistics to prevent external modification.
   *
   * @returns Current cache statistics (hits and misses)
   */
  getCacheStats(): CacheStats {
    return { ...this.cacheStats };
  }

  /**
   * Get snapshot metadata by key.
   *
   * Cache behavior:
   * - Checks cache first for fast lookup
   * - On cache miss, reads from filesystem and caches the result
   * - Returns null if snapshot doesn't exist
   *
   * @param key - Snapshot key identifying the snapshot
   * @returns Snapshot metadata if found, null otherwise
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
   *
   * Cache behavior:
   * - Updates individual snapshot cache entry (write-through)
   * - Invalidates listAll cache since the snapshot list has changed
   * - Throws on filesystem errors
   *
   * @param metadata - Snapshot metadata to save
   * @throws Error if filesystem write fails
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
   *
   * Cache behavior:
   * - Checks listAll cache first (separate from individual snapshot cache)
   * - On cache miss, scans filesystem recursively and caches results
   * - Returns empty array if storage directory doesn't exist
   *
   * Performance: Filesystem scan can be expensive for large numbers of snapshots.
   * The cache helps avoid repeated scans.
   *
   * @returns Array of all snapshot metadata (empty if none exist)
   */
  async listAll(): Promise<SnapshotMetadata[]> {
    // Check cache first
    if (this.listAllCache !== null) {
      const now = Date.now();
      const age = now - this.listAllCache.timestamp;

      // Check if cache entry has expired
      if (age <= CACHE_TTL_MS) {
        this.cacheStats.hits++;
        return this.listAllCache.data;
      }

      // Cache expired, invalidate
      this.listAllCache = null;
    }

    // Cache miss - read from filesystem
    this.cacheStats.misses++;
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

      // Cache the result for future reads
      this.listAllCache = {
        data: snapshots,
        timestamp: Date.now(),
      };
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
   *
   * Cache behavior:
   * - Removes individual snapshot cache entry if present
   * - Invalidates listAll cache since the snapshot list has changed
   * - If snapshot doesn't exist (ENOENT), still invalidates cache for consistency
   *
   * @param key - Snapshot key identifying the snapshot to delete
   */
  async delete(key: SnapshotKey): Promise<void> {
    const filePath = this.getFilePath(key);

    try {
      await unlink(filePath);

      // Remove the individual cache entry
      const cacheKey = this.getCacheKey(key);
      this.cache.delete(cacheKey);

      // Invalidate the listAll cache since the snapshot list has changed
      this.listAllCache = null;

      logger.debug({ key }, `[snapshot-store] Deleted snapshot`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        // Already deleted - still invalidate cache to ensure consistency
        const cacheKey = this.getCacheKey(key);
        this.cache.delete(cacheKey);
        this.listAllCache = null;
        return;
      }
      logger.warn({ error, key }, `[snapshot-store] Failed to delete snapshot`);
    }
  }

  /**
   * Clean up old snapshots beyond max age.
   *
   * Cache behavior:
   * - Clears entire cache after cleanup since multiple snapshots may be deleted
   * - This ensures cache consistency without tracking individual deletions
   *
   * Performance: Reads all metadata files to check expiration.
   * For large numbers of snapshots, consider running this operation during low-traffic periods.
   *
   * @param maxAgeHours - Maximum age in hours before a snapshot is considered expired
   * @returns Number of snapshots deleted
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
      // Clear cache to ensure consistency after deletions
      this.clearCache();
      logger.info({ deleted }, `[snapshot-store] Cleanup completed`);
    }

    return deleted;
  }
}

/**
 * Global snapshot store instance.
 * Initialized at startup and used throughout the application.
 *
 * Configuration:
 * - Storage directory: SNAPSHOT_STORAGE_DIR env var (default: /tmp/snapshots)
 * - Cache TTL: SNAPSHOT_CACHE_TTL_MS env var (default: 300000ms / 5 minutes)
 */
export const globalSnapshotStore = new FilesystemSnapshotStore();

/**
 * Initialize the snapshot store.
 * Call this during application startup to ensure the storage directory exists.
 *
 * Example:
 * ```ts
 * await initializeSnapshotStore();
 * ```
 *
 * @returns Promise that resolves when the store is ready
 */
export async function initializeSnapshotStore(): Promise<void> {
  await globalSnapshotStore.initialize();
}
