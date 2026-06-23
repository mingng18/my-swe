## 2024-06-22 - Prototype Pollution Checking Anti-Pattern
**Learning:** Found a major performance bottleneck and subtle security flaw in `parseJsonSafely` where `JSON.parse(JSON.stringify(parsed))` was used alongside a top-level `hasOwnProperty` check to block prototype pollution. This is extremely slow (O(n) memory allocation and stringification overhead) and unsafe because it only blocks pollution at the absolute top-level of the object, completely ignoring nested keys.
**Action:** When implementing prototype pollution prevention in JSON parsing, never use stringify/parse cycling. Use a single-pass recursive traversal or a custom reviver function in `JSON.parse` that checks keys at every level while validating depth constraints simultaneously.

## 2024-05-18 - Unbounded File I/O Concurrency in Array Maps
**Learning:** In backend `snapshot-store.ts`, mapping an unbounded array of files directly into `Promise.all(readFile(...))` can cause severe memory spikes and Node.js `EMFILE` (too many open files) errors when dealing with large repositories. This pattern was present in `listByRepo` and `listByProfile`.
**Action:** When parallelizing sequential await loops with `Promise.all` for I/O operations, always implement chunking/batching (e.g., using a `for` loop and `array.slice` with `BATCH_SIZE = 500`) to avoid unbounded concurrency.
