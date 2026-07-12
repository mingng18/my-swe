## 2024-06-22 - Prototype Pollution Checking Anti-Pattern
**Learning:** Found a major performance bottleneck and subtle security flaw in `parseJsonSafely` where `JSON.parse(JSON.stringify(parsed))` was used alongside a top-level `hasOwnProperty` check to block prototype pollution. This is extremely slow (O(n) memory allocation and stringification overhead) and unsafe because it only blocks pollution at the absolute top-level of the object, completely ignoring nested keys.
**Action:** When implementing prototype pollution prevention in JSON parsing, never use stringify/parse cycling. Use a single-pass recursive traversal or a custom reviver function in `JSON.parse` that checks keys at every level while validating depth constraints simultaneously.

## 2024-06-24 - Unbounded Concurrent DB/IO Read Anti-Pattern
**Learning:** Calling `Promise.all` directly on the output of an unchunked array map over the filesystem or DB instances creates an unbound concurrency trap. Doing this with high-quantity entities (such as snapshots or cache items) will exhaust file descriptor limits or cause Node.js EMFILE crashes.
**Action:** When evaluating `Promise.all` in functions designed to load resources, chunk the iteration loop with a safe bound (e.g., `BATCH_SIZE = 500`) to process batches of promises without crashing the system or draining connection pools.

## 2025-07-06 - Array.prototype.reduce Overhead in Aggregations
**Learning:** In the Bun/V8 runtime, using multiple sequential `Array.prototype.reduce` passes over the same array to calculate distinct aggregates introduces unnecessary callback overhead and increases iteration from O(N) to O(k*N). Also, using `reduce` for string concatenation (e.g. `arr.reduce((acc, x) => acc + x, "")`) is slower than simple `for` loops primarily due to the function callback overhead on every element, rather than string buffer allocations (since V8 optimizes string appends via ConsStrings).
**Action:** Replace `reduce` string concatenations with standard `for` loops or `.map().join()`. Combine multiple mapping/reducing passes over the same data into a single `for` loop to avoid redundant iteration and callback overhead.
## 2025-07-08 - Optimized O(N) array traversals in trace-dashboard
**Learning:** Chaining `.filter().reduce()` on large metrics arrays causes unnecessary O(N^2) behavior due to multiple array traversals and intermediate allocations.
**Action:** Replace chained `.filter().reduce()` operations with a single-pass `for` loop, especially in dashboard or metric aggregations, to reduce memory pressure and execution time.
## 2026-07-12 - Use Promise.all over sequential async maps
**Learning:** Sequential await loops over independent tasks (like CI failed run fetching and handling) cause unneeded I/O bottlenecks.
**Action:** Use `Promise.all` with `.map` to enable concurrent execution for independent looping asynchronous actions to gain O(1)-like time scaling with O(n) task lists instead of O(n) time.
