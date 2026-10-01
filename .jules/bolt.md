## 2026-06-25 - Extracted mapping outside useShallow in zustand components
**Learning:** Using inline `.map()` inside Zustand's `useShallow` hook generates a new array on every render because `useShallow` only performs a shallow equality check. Since `[1, 2] !== [1, 2]` by reference, this defeats the purpose of `useShallow` and causes components to re-render constantly as if there was no optimization at all.
**Action:** Move array mapping operations outside of the `useShallow` selector. The selector should only extract the raw array from the store, and the `.map()` should be applied in the component body (or memoized independently) so `useShallow` can correctly detect when the underlying array references haven't changed.
## 2026-06-26 - Don't use filter inside useShallow
**Learning:** Using `.filter()` inside `useShallow` creates a new array reference on every store update, defeating the shallow equality check and causing continuous re-renders.
**Action:** Extract the raw array using `useShallow`, then perform the `.filter()` operation in the component body.

## 2026-06-27 - Use Array.from instead of spread for Set conversion
**Learning:** Using the spread operator `[...set]` to convert a Set to an Array can be slower than `Array.from(set)` in V8, especially for larger sets, due to how the iterator protocol is implemented.
**Action:** Prefer `Array.from(set)` over `[...set]` when performance is a concern on hot paths.

## 2026-06-28 - Avoid redundant context updates
**Learning:** Deeply comparing objects before triggering state updates in Zustand stores can prevent unnecessary React re-renders when the actual data hasn't changed.
**Action:** Implement deep equality checks on complex state objects before calling `set()` in Zustand actions.

## 2026-07-27 - Concurrency Limiting over unbounded Promise.all
**Learning:** Replacing sequential `for...of` loops with unbounded `Promise.all` for network requests (like GitHub PR comment fetching) creates immediate rate-limiting and 429 errors from APIs, ultimately failing the operation.
**Action:** Use a concurrency limiter like `p-limit` when parallelizing async network operations to prevent overwhelming external APIs while still gaining concurrency benefits.

## 2026-07-27 - fs/promises over synchronous fs
**Learning:** Using synchronous `fs.readFileSync` and `fs.writeFileSync` inside high-frequency operations blocks the Node.js event loop, degrading performance for concurrent requests. Asynchronous `fs/promises` (`readFile`, `writeFile`) allows the event loop to continue processing other tasks, improving throughput.
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
## 2026-10-27 - Avoid multiple array iterations in search loops
**Learning:** Chaining `.map().filter().slice().map()` on candidate tools creates multiple intermediate arrays, causing unnecessary memory allocation overhead and increased garbage collection pauses during search operations.
**Action:** Replaced chained array methods with a single-pass `for` loop to eliminate intermediate object allocations and improve search performance.
## 2025-08-25 - Zustand useShallow Optimization
**Learning:** When using Zustand's `useShallow` to prevent unnecessary re-renders when mapping over collections, do not return an array of newly created objects. Instead, return a single dictionary/record object mapping keys to primitive values, which `useShallow` can successfully compare. This prevents expensive UI re-renders during high-frequency updates like LLM streaming.
**Action:** Use granular selectors or shallowly compared flat records instead of subscribing to full objects when streaming updates.
## 2026-09-15 - Avoid .reduce() overhead in GitHub PR comment processing
**Learning:** Using `Array.prototype.reduce()` to find matching indices in an array of GitHub PR comments creates unnecessary callback allocations for every comment. For PRs with extensive discussion history, this adds garbage collection overhead and slows down processing.
**Action:** Replaced `.reduce()` with a standard `for` loop to scan PR comments, improving raw iteration speed and reducing memory allocation pressure.
## 2026-09-17 - Extracted array creation from React useCallback in PromptInput
**Learning:** In PromptInput.tsx, the `matchesAccept` function inside `useCallback` was repeatedly chaining `.split(",").map((s) => s.trim()).filter(Boolean)` on the `accept` string property to validate each incoming file. Since the `accept` prop rarely changes, this caused redundant intermediate array allocations and overhead when multiple files were dropped.\n**Action:** Extract static string parsing and filtering logic from inside per-item iterative `useCallback` loops into a `useMemo` block that depends only on the prop string, reusing the array mapping once per change.

## 2026-09-26 - Optimize array chains in memory consolidation
**Learning:** Chained array methods like `.map().filter(Boolean)` or `.reduce()` on memory consolidation operations allocate intermediate arrays and add garbage collection overhead during background cleanup processes.
**Action:** Replace these array chains with single-pass `for` loops to minimize intermediate allocations in memory aggregation routines.

## $(date +%Y-%m-%d) - Prevent re-renders by using Zustand selectors for stable actions
**Learning:** While avoiding full store subscriptions (like `useThreadStore()`) is critical, destructuring stable actions directly (e.g., `const { addThread } = useThreadStore()`) still implicitly subscribes the component to all state changes in Zustand, defeating the purpose of the optimization.
**Action:** When extracting actions from a Zustand store, always use granular selectors (e.g., `const addThread = useThreadStore(state => state.addThread)`) or `useShallow` to ensure the component only re-renders when those specific properties change (which for actions, is never).

## 2024-03-22 - Optimize SSE buffer array filtering
**Learning:** Using `Array.prototype.filter()` on highly active event buffers to enforce a Time-To-Live (TTL) allocates a new array and performs an O(N) traversal on every iteration, leading to significant garbage collection pressure. If the buffer is strictly chronological, an in-place `Array.splice` combined with an early-exit loop is much faster.
**Action:** Replace full array `.filter()` scans on chronologically sorted arrays with early-exit `for` loops and in-place `splice()` mutations to minimize GC pressure and O(N) allocation overhead.
