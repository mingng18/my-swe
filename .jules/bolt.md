## 2025-02-12 - UI Render Loop Arrays
**Learning:** Chained array methods (e.g., `.filter().map()`) in frequently called frontend code or UI render loops create intermediate arrays that cause unnecessary garbage collection pressure and can impact UI rendering performance.
**Action:** Consolidate chained array manipulations into a single-pass `for` loop in critical rendering paths to avoid intermediate allocations.
## 2024-07-17 - Avoid multiple filter().length array passes
**Learning:** Using multiple `.filter(...).length` passes over the same array to calculate distinct statistics creates unnecessary intermediate arrays and traverses the source array multiple times. This adds unnecessary memory allocations and compute overhead (O(2N) instead of O(N)).
**Action:** Replace multiple `.filter(...).length` calls with a single `for` loop to compute multiple metrics in a single pass over the array.
## 2025-02-28 - Avoid Array allocations with multiple .filter().length passes
**Learning:** Found an anti-pattern in the codebase where developers were chaining or running multiple `.filter(...).length` iterations to calculate metrics on arrays (e.g., in `analyzer.ts` and `shutdown.ts`). This creates unnecessary intermediate array allocations and causes redundant O(N^2) traversal overhead.
**Action:** Replace multiple `.filter().length` passes on large metrics or event stream objects with a single O(N) `for` loop that safely calculates all variables without additional memory overhead.
## 2025-07-20 - Avoid .reduce() in high-frequency string metric calculations
**Learning:** In hot loops like compaction token evaluation (`countTruncatableArguments`), using `.reduce` with optional chaining (e.g., `p.text?.length || 0`) over arrays adds unnecessary callback overhead on every object, which can cause excessive garbage collection pressure.
**Action:** Replace `Array.prototype.reduce` in performance-critical calculation paths with a single-pass `for` loop to eliminate the intermediate anonymous function allocation and improve raw iteration speed.

## 2025-07-21 - Replace .map().filter() chains with single-pass loops
**Learning:** Chained array methods (like `.map().filter()`) on string processing create intermediate arrays, causing unnecessary garbage collection pressure which can impact memory and performance.
**Action:** When iterating over items to process and filter them (especially in hot paths like codebase indexing regex matches), use a single-pass `for` loop to avoid intermediate allocations.
## 2024-07-23 - String Concatenation and reduce overhead in Formatting
**Learning:** Using Array.prototype.reduce() coupled with iterative string concatenation (+=) in loops can cause significant memory allocation overhead in V8/Bun due to the creation of intermediate strings and callback overhead.
**Action:** Replace .reduce() with standard for loops and use array building with .join("") for efficient string construction, especially for functions formatting potentially large sets of issues.
## 2025-07-25 - Async file io in state-store
**Learning:** Synchronous file I/O operations (`readFileSync`, `writeFileSync`) block the event loop, severely degrading performance in a concurrent environment. Using their asynchronous equivalents from `fs/promises` (`readFile`, `writeFile`) allows the event loop to continue processing other tasks, improving throughput.
**Action:** Always prefer `fs/promises` methods for file I/O operations, especially in high-throughput or concurrent paths like a state store, and coordinate them via `Promise.all` when possible.
## 2026-07-27 - Redundant String Manipulation in Array Chains
**Learning:** Chaining `.filter().map()` where both operations perform the same string transformation (like `.trim()`) on large terminal outputs creates unnecessary allocations and duplicates work.
**Action:** Consolidate into a single-pass `for` loop that performs the transformation once and filters out empty results, avoiding intermediate array allocations.
## 2025-07-29 - Avoid array map allocations in string aggregations
**Learning:** Using `.map().join()` for formatting large arrays into strings creates unnecessary intermediate arrays and can degrade performance due to garbage collection pressure.
**Action:** Consolidate these string-building tasks into single-pass `for` loops without intermediary array allocations.
## 2025-07-29 - Missing memoization in React rendering
**Learning:** Exporting functional React components without `React.memo()` can cause unnecessary re-renders in large lists or frequently updated components (like timelines), leading to UI stuttering and poor performance.
**Action:** Wrap frequently updated or large components with `React.memo()` to prevent unnecessary re-renders when their props haven't changed.

## 2025-05-19 - Unbounded Filter Chaining in Telemetry Processing
**Learning:** Found multiple chained `.filter()` method calls creating unbounded intermediate array allocations in `src/utils/telemetry.ts` when formatting metrics data (e.g. `aggregateLlmMetrics`). Processing large metrics data structures generated a lot of memory churn that showed up in test durations.
**Action:** Always prefer consolidating multiple `.filter().map()` style loops into a single-pass sequential `for` or `for...of` block on highly active data pipelines to keep V8 memory overhead and garbage collection pauses low.
## 2025-02-12 - Optimizing search loop with O(1) Map lookup
**Learning:** In code dealing with search filtering and mapping over objects, using `array.find(obj => obj.name === name)` inside a loop over tools (`Array.from(found).map(name => ...)`) creates redundant O(N) nested scans.
**Action:** When a mapping of `name -> Object` is already constructed to resolve existence (like `toolsLowerMap`), reuse that exact same Map `.get(name)` later in the function to eliminate the $O(N)$ lookup and replace it with $O(1)$.
## 2026-08-01 - Optimize inner loop with Set in codebase-indexer.ts
**Learning:** When performing `new Set()` generation of identical data, evaluate the operation outside of loops rather than repeating the overhead each iteration.
**Action:** Audit inner loops for redundant array-to-Set conversions, specifically checking if the source array remains unmodified.

## 2026-08-04 - Array map and filter chains in Eval Harness
**Learning:** Found an anti-pattern in `src/eval/harness.ts` where multiple chained iterations (`.filter(...).length` and `.reduce(...)`) were used to calculate final eval report statistics. This adds unnecessary multiple O(N) traversals and intermediate array allocations in memory.
**Action:** Replaced chained array aggregations with a single-pass `for` loop to optimize iteration speed and decrease garbage collection pressure in test harness logic.

## 2025-10-25 - Avoid intermediate arrays for metric counts
**Learning:** In telemetry processors and aggregators (like `detectAnomalies` in `trace-dashboard.ts`), using `.filter(...).length` to count items in large arrays allocates an entire intermediate array just to measure its length, unnecessarily increasing memory and garbage collection overhead. (Note: Doing this on small lists like context messages is a non-measurable micro-optimization, but on telemetry arrays with thousands of spans it matters).
**Action:** Replace `.filter(...).length` with a standard `for` loop that increments a counter when processing large telemetry or log data to eliminate O(N) memory allocations.
## 2026-08-07 - Avoid multiple .filter().length passes for array counting
**Learning:** The codebase has multiple occurrences of chaining `.filter(condition).length` to count items matching specific conditions. This allocates a new temporary array just to measure its length, causing O(N) memory allocation and O(N) traversal overhead each time.
**Action:** Replaced chained `.filter().length` with standard `for` loops and incrementing counters when calculating invocation metrics. Reusing an optimized counting method instead of running multiple independent filters reduces unnecessary memory allocations and garbage collection pressure on the hot path.

## 2025-08-25 - Avoid multiple .filter().length array passes in UI components\n**Learning:** In React UI components that are frequently rendered (e.g., TodoSidebar which updates on state changes), using multiple `.filter(...).length` passes over the same array to calculate distinct statistics creates unnecessary intermediate arrays and traverses the source array multiple times. This adds unnecessary memory allocations and compute overhead during rendering.\n**Action:** Replace multiple `.filter(...).length` calls with a single O(N) `for` loop to compute multiple metrics in a single pass over the array, reducing GC pressure and render time.

## 2025-02-27 - Sequential vs Concurrent Directory Walking
**Learning:** The `codebase-indexer.ts` originally used a sequential `for...of` loop with `await` for recursive file directory walking, preventing any parallel file system reads which dramatically throttled startup or indexing indexing large repositories. I benchmarked the difference locally and saw `Promise.all` reduced I/O overhead heavily since node's `fs` does asynchronous operations.
**Action:** When finding loops involving I/O tasks like API calls, reading files, or database calls, always evaluate if sequential dependencies exist. If not, use `Promise.all` (with concurrency limits if bounded APIs are involved) to allow Node.js to parallelize execution over the single event loop.
