## 2024-06-22 - Prototype Pollution Checking Anti-Pattern
**Learning:** Found a major performance bottleneck and subtle security flaw in `parseJsonSafely` where `JSON.parse(JSON.stringify(parsed))` was used alongside a top-level `hasOwnProperty` check to block prototype pollution. This is extremely slow (O(n) memory allocation and stringification overhead) and unsafe because it only blocks pollution at the absolute top-level of the object, completely ignoring nested keys.
**Action:** When implementing prototype pollution prevention in JSON parsing, never use stringify/parse cycling. Use a single-pass recursive traversal or a custom reviver function in `JSON.parse` that checks keys at every level while validating depth constraints simultaneously.

## 2024-06-29 - Unbounded Promise.all I/O Exhaustion
**Learning:** Found a major performance bottleneck where an unbounded `Promise.all` loop was iterating over potentially thousands of memories to generate LLM embeddings concurrently. This anti-pattern can rapidly exhaust database connection pools or trigger immediate rate limiting from external LLM API providers on large threads.
**Action:** When parallelizing sequential await loops for network I/O or database operations over potentially large sets, always implement chunking/batching (e.g., using a `CHUNK_SIZE` of 5) to control maximum concurrency and ensure system stability.
