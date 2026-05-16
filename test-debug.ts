import { ConsolidationService } from "./src/memory/consolidation";

const mockRepo = {
  getByThread: async () => [
    { id: "1", type: "user", title: "A", content: "A content" },
    { id: "2", type: "user", title: "A", content: "A content" },
  ],
  update: async () => {},
};

const mockEmbedding = {
  generateEmbedding: async (text: string) => {
    return [0.1, 0.2, 0.3];
  },
  cosineSimilarity: () => 0.95,
};

async function test() {
  const service = new ConsolidationService(mockRepo as any, mockEmbedding as any);
  const result = await service.findDuplicates("test-thread", 0.9);
  console.log(result.length);
}

test().catch(console.error);
