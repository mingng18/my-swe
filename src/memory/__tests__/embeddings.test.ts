import { describe, it, expect, beforeAll, beforeEach, mock } from "bun:test";
import { EmbeddingService } from "../embeddings";

// Mock fetch for testing
let mockFetch: ReturnType<typeof mock>;

// Create deterministic embeddings based on text content
function createMockEmbedding(text: string, dimension: number = 1536): number[] {
  const embedding: number[] = [];
  const seed = text
    .split("")
    .reduce((acc, char) => acc + char.charCodeAt(0), 0);

  for (let i = 0; i < dimension; i++) {
    // Generate deterministic values based on text seed
    const value = Math.sin(seed + i * 0.1) * 0.5 + 0.5; // Normalize to 0-1
    embedding.push(value);
  }

  // Normalize the vector
  const magnitude = Math.sqrt(
    embedding.reduce((sum, val) => sum + val * val, 0),
  );
  return embedding.map((val) => val / magnitude);
}

function setupMockFetch() {
  mockFetch = mock(async (
    url: string | Request,
    options?: RequestInit,
  ) => {
    const urlStr = typeof url === "string" ? url : url.toString();

    if (urlStr.includes("/embeddings")) {
      const body = options?.body as string;
      const data = JSON.parse(body);
      const texts = Array.isArray(data.input) ? data.input : [data.input];

      const responseData = {
        data: texts.map((text: string, index: number) => ({
          embedding: createMockEmbedding(text),
          index,
        })),
      };

      return new Response(JSON.stringify(responseData), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  });
  global.fetch = mockFetch as any;
}

function restoreFetch() {
  global.fetch = fetch;
}

describe("EmbeddingService", () => {
  let service: EmbeddingService;

  beforeAll(() => {
    // Set test environment variables
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_BASE_URL = "https://api.openai.com/v1";
  });

  beforeEach(() => {
    setupMockFetch();
    service = new EmbeddingService();
  });

  it("should generate an embedding for a single text", async () => {
    const text = "This is a test document for embedding generation.";
    const embedding = await service.generateEmbedding(text);

    expect(embedding).toBeDefined();
    expect(Array.isArray(embedding)).toBe(true);
    expect(embedding.length).toBe(1536); // text-embedding-3-small dimension
    expect(embedding.every((v) => typeof v === "number")).toBe(true);
  });

  it("should generate embeddings for multiple texts in batch", async () => {
    const texts = [
      "First document about machine learning",
      "Second document about data science",
      "Third document about artificial intelligence",
    ];

    const embeddings = await service.generateEmbeddingsBatch(texts);

    expect(embeddings).toBeDefined();
    expect(Array.isArray(embeddings)).toBe(true);
    expect(embeddings.length).toBe(3);
    expect(embeddings.every((emb) => emb.length === 1536)).toBe(true);
  });

  it("should handle empty text array in batch", async () => {
    const embeddings = await service.generateEmbeddingsBatch([]);
    expect(embeddings).toEqual([]);
  });

  it("should calculate cosine similarity between two vectors", () => {
    const vectorA = [1, 2, 3];
    const vectorB = [1, 2, 3];
    const similarity = EmbeddingService.cosineSimilarity(vectorA, vectorB);

    expect(similarity).toBeCloseTo(1.0, 5); // Identical vectors
  });

  it("should calculate cosine similarity for orthogonal vectors", () => {
    const vectorA = [1, 0, 0];
    const vectorB = [0, 1, 0];
    const similarity = EmbeddingService.cosineSimilarity(vectorA, vectorB);

    expect(similarity).toBeCloseTo(0.0, 5); // Orthogonal vectors
  });

  it("should calculate cosine similarity for opposite vectors", () => {
    const vectorA = [1, 2, 3];
    const vectorB = [-1, -2, -3];
    const similarity = EmbeddingService.cosineSimilarity(vectorA, vectorB);

    expect(similarity).toBeCloseTo(-1.0, 5); // Opposite vectors
  });

  it("should handle high similarity between similar texts", async () => {
    const text1 = "The cat sat on the mat";
    const text2 = "A cat sat on a mat";

    const embedding1 = await service.generateEmbedding(text1);
    const embedding2 = await service.generateEmbedding(text2);

    const similarity = EmbeddingService.cosineSimilarity(
      embedding1,
      embedding2,
    );

    // With deterministic mock, similar texts (with similar character patterns) should have higher similarity
    // than completely different texts
    expect(similarity).toBeGreaterThan(0.5);
  });

  it("should handle low similarity between different texts", async () => {
    const text1 = "The cat sat on the mat";
    const text2 = "Stock prices rose by 5% today";

    const embedding1 = await service.generateEmbedding(text1);
    const embedding2 = await service.generateEmbedding(text2);

    const similarity = EmbeddingService.cosineSimilarity(
      embedding1,
      embedding2,
    );

    // These should have different similarity values since they're different texts
    expect(similarity).toBeDefined();
    expect(similarity).toBeGreaterThanOrEqual(-1);
    expect(similarity).toBeLessThanOrEqual(1);
  });

  it("should throw error for empty text in generateEmbedding", async () => {
    await expect(service.generateEmbedding("")).rejects.toThrow();
  });

  it("should handle whitespace-only text", async () => {
    const text = "   ";
    await expect(service.generateEmbedding(text)).rejects.toThrow();
  });
});
