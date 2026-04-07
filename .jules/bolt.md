## 2025-04-06 - Pre-computing properties in hot loop
**Learning:** String allocations and case conversions inside iterative lookup loops (`blueprint.triggerKeywords.map(k => k.toLowerCase())` within a loop) create substantial O(n * m) overhead in Node/Bun when the function is invoked frequently.
**Action:** When working on hot paths like graph or registry selections that execute thousands of times per turn, extract dynamic object manipulation (`toLowerCase`, `find`, etc.) to application setup/registration time instead of executing them inline inside `select()` or `find()` functions.

## 2024-03-24 - OpenSandbox File Batching
**Learning:** The OpenSandbox SDK (`@alibaba-group/opensandbox`) supports native batching for `createDirectories` and `writeFiles`, which is vastly superior to sequential execution. However, the `readFile` API lacks a bulk counterpart, requiring chunked parallel requests (e.g. `Promise.all` with a concurrency limit) to avoid socket exhaustion.
**Action:** When working with OpenSandbox, always use the SDK's native batch methods (`writeFiles`, `createDirectories`) where available, and implement bounded chunked parallelism for operations that lack bulk APIs (`readFile`).
