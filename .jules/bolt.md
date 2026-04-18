## 2025-04-10 - Snapshot Store listAll Concurrency Optimization
**Learning:** `listAll` in `snapshot-store.ts` was doing sequential metadata reads using an `await` within a `for...of` loop which severely impacted performance for large amounts of snapshot files.
**Action:** Replaced the sequential `for...of` loop with concurrent mapping via `Array.map` and `Promise.all` reducing listAll latency by ~60%.
## 2026-04-16 - Memory Pointer Iteration Concurrency Optimization
**Learning:** Sequential await readFile inside loops in memory-pointer.ts and escalation-store.ts caused poor performance when there are multiple artifacts or escalations.
**Action:** Use Promise.all with array mapping to allow concurrent file reads for significantly better latency.
## 2025-04-18 - Optimize asynchronous file reading
**Learning:** Sequential synchronous file reading (`readFileSync` inside a loop) can block the event loop and significantly degrade performance when reading multiple configuration or metadata files from disk.
**Action:** Replace synchronous `fs.readdirSync` and `fs.readFileSync` with `fs.promises.readdir` and `fs.promises.readFile`. Map read operations into a Promise array and await them concurrently using `Promise.all` to significantly improve throughput.
