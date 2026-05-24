const fs = require('fs');

let testContent = fs.readFileSync('src/memory/memory.integration.test.ts', 'utf8');

testContent = testContent.replace(
  /it\.skip\("should extract, embed, save, and search memories", async \(\) => \{/g,
  'it("should extract, embed, save, and search memories", async () => {'
);
testContent = testContent.replace(
  /it\.skip\("should handle empty extraction gracefully", async \(\) => \{/g,
  'it("should handle empty extraction gracefully", async () => {'
);
testContent = testContent.replace(
  /it\.skip\("should extract from different sources", async \(\) => \{/g,
  'it("should extract from different sources", async () => {'
);
testContent = testContent.replace(
  /it\.skip\("should detect similar memories using consolidation", async \(\) => \{/g,
  'it("should detect similar memories using consolidation", async () => {'
);
testContent = testContent.replace(
  /it\.skip\("should not merge distinct memories", async \(\) => \{/g,
  'it("should not merge distinct memories", async () => {'
);
testContent = testContent.replace(
  /it\.skip\("should return relevant results for semantic queries", async \(\) => \{/g,
  'it("should return relevant results for semantic queries", async () => {'
);
testContent = testContent.replace(
  /it\.skip\("should filter by memory type", async \(\) => \{/g,
  'it("should filter by memory type", async () => {'
);
testContent = testContent.replace(
  /it\.skip\("should respect similarity threshold", async \(\) => \{/g,
  'it("should respect similarity threshold", async () => {'
);
testContent = testContent.replace(
  /it\.skip\("should handle search with no memories gracefully", async \(\) => \{/g,
  'it("should handle search with no memories gracefully", async () => {'
);
testContent = testContent.replace(
  /it\.skip\("should support soft delete and reactivation", async \(\) => \{/g,
  'it("should support soft delete and reactivation", async () => {'
);
testContent = testContent.replace(
  /it\.skip\("should track access count", async \(\) => \{/g,
  'it("should track access count", async () => {'
);

fs.writeFileSync('src/memory/memory.integration.test.ts', testContent);

// Now apply the mock fix again to BOTH LinterNode test files
function unmock(file) {
  if (!fs.existsSync(file)) return;
  let content = fs.readFileSync(file, 'utf8');

  // Replace mock block exactly once
  content = content.replace(
    /mock\.module\("\.\.\/memory\/repository", \(\) => \{\s*return \{\s*MemoryRepository:\s*class[^{]*\{[^}]*\}\s*\};\s*\}\);/m,
    `mock.module("../memory/repository", () => ({
  MemoryRepository: class MockMemoryRepository {
    saveBatch = mock();
    getByThread = mock().mockResolvedValue([]);
    getByThreads = mock().mockResolvedValue([]);
    save = mock().mockResolvedValue({});
    update = mock().mockResolvedValue({});
  }
}));`
  );

  content = content.replace(
    /mock\.module\("\.\.\/memory\/extractor", \(\) => \{\s*return \{\s*MemoryExtractor:\s*class[^{]*\{[^}]*\}\s*\};\s*\}\);/m,
    `mock.module("../memory/extractor", () => ({
  MemoryExtractor: class MockMemoryExtractor {
    extractMemories = mock();
    extractFromTurn = mock().mockReturnValue([]);
  }
}));`
  );

  content = content.replace(
    /mock\.module\("\.\.\/memory\/embeddings", \(\) => \{\s*return \{\s*EmbeddingService:\s*class[^{]*\{[^}]*\}\s*\};\s*\}\);/m,
    `mock.module("../memory/embeddings", () => ({
  EmbeddingService: class MockEmbeddingService {
    embed = mock();
    generateEmbedding = mock().mockResolvedValue([0.1, 0.2]);
    generateEmbeddingsBatch = mock().mockResolvedValue([]);
    cosineSimilarity = mock().mockReturnValue(1);
  }
}));`
  );

  fs.writeFileSync(file, content);
}

function unmock2(file) {
  if (!fs.existsSync(file)) return;
  let content = fs.readFileSync(file, 'utf8');

  content = content.replace(
    /mock\.module\("\.\.\/\.\.\/\.\.\/memory\/repository", \(\) => \(\{\s*MemoryRepository:\s*class\s*\{[^}]*\}\s*\}\)\);/m,
    `mock.module("../../../memory/repository", () => ({
  MemoryRepository: class {
    saveBatch = mockSaveBatch;
    getByThread = mock().mockResolvedValue([]);
    getByThreads = mock().mockResolvedValue([]);
    save = mock().mockResolvedValue({});
    update = mock().mockResolvedValue({});
  }
}));`
  );

  content = content.replace(
    /mock\.module\("\.\.\/\.\.\/\.\.\/memory\/extractor", \(\) => \(\{\s*MemoryExtractor:\s*class\s*\{[^}]*\}\s*\}\)\);/m,
    `mock.module("../../../memory/extractor", () => ({
  MemoryExtractor: class {
    extractFromTurn = mockExtractFromTurn;
    extractMemories = mock();
  }
}));`
  );

  content = content.replace(
    /mock\.module\("\.\.\/\.\.\/\.\.\/memory\/embeddings", \(\) => \(\{\s*EmbeddingService:\s*class\s*\{[^}]*\}\s*\}\)\);/m,
    `mock.module("../../../memory/embeddings", () => ({
  EmbeddingService: class {
    generateEmbedding = mockGenerateEmbedding;
    embed = mock();
    generateEmbeddingsBatch = mock().mockResolvedValue([]);
    cosineSimilarity = mock().mockReturnValue(1);
  }
}));`
  );

  fs.writeFileSync(file, content);
}

unmock('src/__tests__/LinterNode.test.ts');
unmock2('src/nodes/deterministic/__tests__/LinterNode.test.ts');
