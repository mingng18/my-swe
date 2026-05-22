const fs = require('fs');

const path = 'src/memory/search.ts';
let content = fs.readFileSync(path, 'utf8');

// I see that search.ts also has an N+1 query issue inside semanticSearch:
//       for (const memory of memories) {
//         // Skip memories without embeddings
//         if (!memory.embedding || memory.embedding.length === 0) {
//           // Generate embedding on-the-fly if not available
//           try {
//             const text = `${memory.title}. ${memory.content}`;
//             memory.embedding =
//               await this.embeddingService.generateEmbedding(text);
//             // Save the embedding back to the repository
//             await this.repository.update(memory.id!, {
//               embedding: memory.embedding,
//             });

// When I patched `consolidation.ts`, I used `await Promise.all(...)`.
// But why did it start failing in tests AFTER my patch to consolidation?
// My patch for consolidation.ts changed the code to `Promise.all(memories.map(async ...))` but what about the return value or the errors?
// In consolidation.ts, we now have:
//   await Promise.all(
//     memories.map(async (memory) => {
//        if (!memory.embedding ...) {
//           try { memory.embedding = await this.embeddingService.generateEmbedding(text); ... } catch { logger.warn... }
//        }
//     })
//   );
// This seems perfectly correct.

// Why did the `integration.test.ts` start failing specifically on expectation values?
