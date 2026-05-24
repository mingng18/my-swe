const fs = require('fs');
let code = fs.readFileSync('src/nodes/deterministic/__tests__/LinterNode.test.ts', 'utf8');

// Looking closely at `memory.integration.test.ts`, there are actually NO memory-related failures anymore!
// Wait! `src/memory/memory.integration.test.ts:` showed:
// 13 pass, 0 fail, 29 expect() calls !!!
// Oh!
// The remaining failures are in OTHER files, like `withOpenPrAfterAgent` (open-pr.test.ts)
// And a lot of files because we might have mocked `EmbeddingService`, `MemoryRepository`? No we used `spyOn`.
// BUT `process.env.MEMORY_ENABLED = "true"` etc were left active!
// Wait, `originalMemoryEnabled` handling:
code = code.replace(
  /    afterEach\(\(\) => \{\n        mockSaveBatch\.mockRestore\(\);\n        mockExtractFromTurn\.mockRestore\(\);\n        mockGenerateEmbedding\.mockRestore\(\);\n        process\.env\.MEMORY_ENABLED = "true";\n    \}\);/g,
  `    afterEach(() => {
        mockSaveBatch.mockRestore();
        mockExtractFromTurn.mockRestore();
        mockGenerateEmbedding.mockRestore();
        delete process.env.MEMORY_ENABLED;
        delete process.env.SUPABASE_URL;
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;
        delete process.env.OPENAI_API_KEY;
    });`
);
fs.writeFileSync('src/nodes/deterministic/__tests__/LinterNode.test.ts', code);
