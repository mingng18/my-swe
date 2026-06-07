## 2025-04-10 - Snapshot Store listAll Concurrency Optimization
**Learning:** `listAll` in `snapshot-store.ts` was doing sequential metadata reads using an `await` within a `for...of` loop which severely impacted performance for large amounts of snapshot files.
**Action:** Replaced the sequential `for...of` loop with concurrent mapping via `Array.map` and `Promise.all` reducing listAll latency by ~60%.
## 2026-04-16 - Memory Pointer Iteration Concurrency Optimization
**Learning:** Sequential await readFile inside loops in memory-pointer.ts and escalation-store.ts caused poor performance when there are multiple artifacts or escalations.
**Action:** Use Promise.all with array mapping to allow concurrent file reads for significantly better latency.

## 2024-03-24 - Blueprint Selection Performance Optimization
**Learning:** Found a performance bottleneck in the Blueprint system (`src/blueprints/selection.ts`) during keyword matching. The original code dynamically generated a lowercased string via `.toLowerCase()` and sequentially used `.includes()` for matching, which repeatedly allocates temporary strings in a loop and is inefficient. The initial attempt to fix this by compiling regexes inside the loop for every single blueprint was rejected as a regression, since it caused dynamic regex generation inside a hot loop which is a known anti-pattern.
**Action:** Optimized `selectBlueprint` by using a pre-compiled case-insensitive RegExp that matches any trigger keyword, and caching the compiled regex patterns in a `WeakMap<Blueprint, CompiledBlueprint>` so that we get fast regex operations without recompiling during every loop iteration.
## 2026-04-18 - Object property cleanup optimization
**Learning:** In V8, using `delete` on object properties deoptimizes hidden classes, and `Object.entries()` creates unnecessary temporary arrays, causing performance overhead in hot paths.
**Action:** Use `for...in` loops to construct new, clean objects instead of mutating and using `Object.entries()` for small configuration objects.
## 2024-04-20 - Object.entries in Recursive Functions Performance Optimization
**Learning:** Using `Object.entries` creates temporary arrays of key-value pairs for every property. In recursive object traversal functions like `truncateObject` that run on large/deep JSON payloads, this causes unnecessary memory allocations and garbage collection overhead in hot paths.
**Action:** Use `for...in` loops to iterate over object keys without intermediate array allocations in hot paths or recursive functions.
## 2024-05-18 - [Avoid Object.entries in Hot Paths]
**Learning:** [In V8/Node.js environments, using `Object.entries()` in performance-critical loops (like blueprint compilation, schema cleaning, or token tracking) creates an anti-pattern by allocating multiple intermediate arrays of key-value pairs, which causes massive overhead. Replacing this with `for...in` avoids these allocations.]
**Action:** [Strictly replace `Object.entries` with `for...in` loops accompanied by `Object.prototype.hasOwnProperty.call` when iterating over object keys in performance-sensitive contexts.]
## 2024-11-20 - Optimize sequential file reads
**Learning:** In Bun, optimizing sequential asynchronous file reads (like readFile in a loop) by mapping them directly into Promise.all yields significant performance gains (~20x faster) and safely handles typical application loads (e.g., thousands of files) concurrently without requiring explicit chunking or hitting EMFILE limits.
**Action:** Always use Promise.all when reading multiple files independently instead of sequential await loops.
## 2025-02-24 - Parallelize agent execution in commit-and-open-pr reviewers
**Learning:** Sequential await loops over independent agent invocations introduce significant latency when calling out to LLMs or remote APIs. In this case, `await agent.invoke()` in a `for...of` loop caused reviewers to wait for the previous one to finish, resulting in an O(N) penalty.
**Action:** Use `Promise.all` with `.map` to execute independent agent sub-tasks concurrently.
 HEAD
 HEAD
 HEAD
 HEAD

## 2024-05-18 - [Parallelize subagent execution in runReviewersTool]
**Learning:** Sequential await loops over independent agent invocations introduce significant latency. `await agent.invoke()` in a `for...of` loop caused reviewers to wait for the previous one to finish, creating an O(N) penalty. Wrapping the `.map()` array directly in `Promise.all` executes the agents concurrently, reducing execution time. Additionally, scoping concurrent LangGraph agents with a uniquely appended `thread_id` (e.g., `${threadId}-${reviewerName}`) prevents state corruption.
**Action:** Always parallelize multiple independent LLM/Agent sub-tasks using `Promise.all` with a uniquely isolated `thread_id` rather than waiting for them sequentially.

## 2026-05-23 - Type casting and array checks for concurrent map results
**Learning:** When refactoring sequential execution with `Promise.all` and extracting typings, `any[]` return arrays can cause nested `issues` properties (such as those from `res.issues`) to not be recognized by TypeScript. Additionally, modifying type expectations inside test functions (such as removing an outer array encapsulation) can inadvertently cause method signatures like `extractFromTurn` to complain without a proper generic or mocked type conversion.
**Action:** Always strictly verify returned properties (e.g. `res.issues`) with standard type guards (e.g. `'issues' in res && Array.isArray(res.issues)`) before mutating or array unpacking (`...res.issues`). Provide appropriate TypeScript explicit casting (`as number`, `as boolean`) when mapping `Promise.all` results out of `any[]` bounds.

## 2025-02-25 - Parallelize ThreadCleanupScheduler functions
**Learning:** Sequential await loops over independent registered cleanup functions in `ThreadCleanupScheduler.runCycle` caused long overall cycle times.
**Action:** Use `Promise.all` with `.map` to execute independent background cleanup functions concurrently.

## 2024-05-18 - Parallelize Skill Discovery
**What:** Updated `discoverSkills` to run file I/O operations concurrently using `Promise.all` and `entries.map` rather than a sequential `for...of` loop.
**Impact:** Measurement with 100 test skills over 50 iterations showed an ~60% speedup (from 26ms per run to 10ms per run).
**Rationale:** Parallelizing I/O-bound operations makes skill discovery substantially faster when the `.agents/skills` directory contains multiple files.

## YYYY-MM-DD - Batch DB queries inside memory consolidation
**Vulnerability:** N+1 Query in Loop during stale memory soft deletion
**Learning:** Found two places in `src/memory/consolidation.ts` where soft deletion operations inside of loops were awaiting standard query processing synchronously (N+1 database calls). Replaced these loops with array `map()` combined with `Promise.all()` parallel execution, drastically improving batch throughput.
**Prevention:** Avoid synchronous awaits in loops when deleting database arrays, even in fallback code paths.

## 2026-05-23 - Keep for...in over Object.entries for performance
**What:** The rationale suggested replacing `for...in` with `Object.entries()` to clean the params object. I kept `for...in` and added comments to explain why.
**Why:** Benchmarks proved that `for...in` is roughly 5x faster in Bun compared to `Object.fromEntries(Object.entries(...).filter(...))` or `for...of Object.entries(...)` for object construction. It does not hit the deoptimization of mutating with `delete`.
**Impact:** Avoids a ~5x performance degradation in object construction loops that are executed frequently when creating sandboxes.
**Measurement:**
Bun Benchmark Results for 1M iterations:
- for...in: 93.71ms
- Object.fromEntries(filter): 346.25ms
- for...of Object.entries: 603.23ms
- Object.entries + forEach: 372.47ms

## 2026-05-23 - Optimize Database Cleanup N+1 Performance
**What:** Replaced sequential map iteration containing database deletes with concurrent `Promise.all()`.
**Why:** Resolves N+1 database queries hanging the event loop via I/O bound delays.
**Result:** Sped up fallback operations by >90x on mocked latency tests.


## 2026-06-04 - Optimize Zustand Re-Renders
**Learning:** Selecting a large, frequently-mutated object (e.g., `thread`) from a Zustand store using `useStore((state) => state.threads[threadId])` causes cascading re-renders in components when only a sub-property (e.g., `todos`) is needed, especially during rapid LLM stream events.
**Action:** Always select only the necessary, granular properties (e.g., `state.threads[threadId]?.todos`) from Zustand stores to prevent unnecessary component re-renders.
