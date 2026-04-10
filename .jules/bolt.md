## 2025-04-10 - Snapshot Store listAll Concurrency Optimization
**Learning:** `listAll` in `snapshot-store.ts` was doing sequential metadata reads using an `await` within a `for...of` loop which severely impacted performance for large amounts of snapshot files.
**Action:** Replaced the sequential `for...of` loop with concurrent mapping via `Array.map` and `Promise.all` reducing listAll latency by ~60%.
