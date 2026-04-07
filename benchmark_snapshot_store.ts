import { FilesystemSnapshotStore } from "./src/sandbox/snapshot-store";
import { join } from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

// Extend to override `readdir` logic for benchmarking
class BenchmarkStore extends FilesystemSnapshotStore {
  // Mock readdir returning 1000 file names that start with the prefix
  async listByRepoMock(repoOwner: string, repoName: string) {
    const snapshots = [];
    const prefix = `${repoOwner.toLowerCase()}/${repoName.toLowerCase()}/`;

    const files = Array.from({length: 1000}, (_, i) => `${prefix}typescript/branch-${i}.json`);

    // Create the actual files so readFile succeeds
    await mkdir(join(this['storageDir'], `${repoOwner.toLowerCase()}`, `${repoName.toLowerCase()}`, `typescript`), { recursive: true });
    for (const file of files) {
      await writeFile(join(this['storageDir'], file), JSON.stringify({
        snapshotId: "test",
        key: { repoOwner, repoName, profile: "typescript", branch: file },
        createdAt: new Date().toISOString(),
        refreshedAt: new Date().toISOString()
      }));
    }

    const start = performance.now();

    // ORIGINAL LOGIC from src/sandbox/snapshot-store.ts
    for (const file of files) {
      if (!file.startsWith(prefix) || !file.endsWith(".json")) {
        continue;
      }

      try {
        const filePath = join(this['storageDir'], file);
        const data = await import("node:fs/promises").then(m => m.readFile(filePath, "utf-8"));
        const metadata = JSON.parse(data);
        metadata.createdAt = new Date(metadata.createdAt);
        metadata.refreshedAt = new Date(metadata.refreshedAt);
        snapshots.push(metadata);
      } catch (error) {
        console.error("error reading", file, error);
      }
    }

    const end = performance.now();
    return { count: snapshots.length, time: end - start, files };
  }

  async listByRepoOptimized(repoOwner: string, repoName: string, files: string[]) {
    const snapshots = [];
    const prefix = `${repoOwner.toLowerCase()}/${repoName.toLowerCase()}/`;

    const start = performance.now();

    // OPTIMIZED LOGIC using Promise.all
    const fs = await import("node:fs/promises");

    const validFiles = files.filter(file => file.startsWith(prefix) && file.endsWith(".json"));

    // Chunking to avoid opening too many files at once (e.g., limit 50 or 100)
    // Or just Promise.all if it's 1000.

    await Promise.all(
      validFiles.map(async (file) => {
        try {
          const filePath = join(this['storageDir'], file);
          const data = await fs.readFile(filePath, "utf-8");
          const metadata = JSON.parse(data);
          metadata.createdAt = new Date(metadata.createdAt);
          metadata.refreshedAt = new Date(metadata.refreshedAt);
          snapshots.push(metadata);
        } catch (error) {
           console.error("error reading", file, error);
        }
      })
    );

    const end = performance.now();
    return { count: snapshots.length, time: end - start };
  }
}

async function run() {
  const testDir = "/tmp/benchmark-snapshots-2";
  await rm(testDir, { recursive: true, force: true });
  await mkdir(testDir, { recursive: true });

  const store = new BenchmarkStore(testDir);
  await store.initialize();

  console.log("Benchmarking sequential readFile (Current approach)...");
  const result1 = await store.listByRepoMock("testowner", "testrepo");
  console.log(`Sequential: Read ${result1.count} files in ${result1.time.toFixed(2)} ms`);

  console.log("Benchmarking Promise.all (Optimized approach)...");
  const result2 = await store.listByRepoOptimized("testowner", "testrepo", result1.files);
  console.log(`Optimized: Read ${result2.count} files in ${result2.time.toFixed(2)} ms`);

  const improvement = ((result1.time - result2.time) / result1.time) * 100;
  console.log(`Improvement: ${improvement.toFixed(2)}%`);

  await rm(testDir, { recursive: true, force: true });
}

run().catch(console.error);
