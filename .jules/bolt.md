## 2025-02-12 - Optimize sequential file reads with Promise.all
**Learning:** Sequential `fs.readFile` calls within a loop over directory contents introduce massive I/O bottlenecks. In Bun/Node, this pattern performs very poorly.
**Action:** Replaced sequential file reads with `Promise.all(files.map(...))` in `src/utils/memory-pointer.ts` functions (`listArtifacts` and `cleanupArtifacts`), dramatically improving execution speed from ~478ms to ~23ms for 5000 files.
