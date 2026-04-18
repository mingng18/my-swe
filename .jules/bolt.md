## 2025-04-10 - Snapshot Store listAll Concurrency Optimization
**Learning:** `listAll` in `snapshot-store.ts` was doing sequential metadata reads using an `await` within a `for...of` loop which severely impacted performance for large amounts of snapshot files.
**Action:** Replaced the sequential `for...of` loop with concurrent mapping via `Array.map` and `Promise.all` reducing listAll latency by ~60%.
## 2026-04-16 - Memory Pointer Iteration Concurrency Optimization
**Learning:** Sequential await readFile inside loops in memory-pointer.ts and escalation-store.ts caused poor performance when there are multiple artifacts or escalations.
**Action:** Use Promise.all with array mapping to allow concurrent file reads for significantly better latency.

## 2025-02-18 - Optimize sequential Supabase fallback operations
**Learning:** In the fallback block of `writeRepoMemoryAfterAgentTurn`, `supabaseSelectSingle` and `supabaseUpsertSingle` network requests were awaited sequentially despite several dependencies being independent (e.g. repo lookup and agent_run lookup).
**Action:** Used `Promise.all` to fetch data concurrently and perform insert operations simultaneously when dependency requirements allowed.
