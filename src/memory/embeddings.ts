import { createLogger } from "../utils/logger";

const logger = createLogger("embedding-service");

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const MAX_BATCH_SIZE = 100;

/**
 * Service for generating text embeddings using OpenAI API
 */
export class EmbeddingService {
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY?.trim() || "";
    this.baseUrl = process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1";

    if (!this.apiKey) {
      throw new Error("OPENAI_API_KEY environment variable is required");
    }

    // Remove trailing slash from base URL
    this.baseUrl = this.baseUrl.replace(/\/+$/, "");
  }

  /**
   * Generate embedding for a single text
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      throw new Error("Text cannot be empty");
    }

    const embeddings = await this.generateEmbeddingsBatch([text]);
    return embeddings[0];
  }

  /**
   * Generate embeddings for multiple texts in batch
   */
  async generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    // Filter out empty texts
    const validTexts = texts.filter((t) => t && t.trim().length > 0);
    if (validTexts.length === 0) {
      throw new Error("No valid texts provided");
    }

    // Process in batches if needed
    if (validTexts.length > MAX_BATCH_SIZE) {
      logger.warn(
        { requested: validTexts.length, max: MAX_BATCH_SIZE },
        "Batch size exceeds maximum, splitting into multiple requests"
      );
      const results: number[][] = [];
      for (let i = 0; i < validTexts.length; i += MAX_BATCH_SIZE) {
        const batch = validTexts.slice(i, i + MAX_BATCH_SIZE);
        const batchEmbeddings = await this.fetchEmbeddings(batch);
        results.push(...batchEmbeddings);
      }
      return results;
    }

    return this.fetchEmbeddings(validTexts);
  }

  /**
   * Fetch embeddings from OpenAI API
   */
  private async fetchEmbeddings(texts: string[]): Promise<number[][]> {
    const url = `${this.baseUrl}/embeddings`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: texts,
          dimensions: EMBEDDING_DIMENSIONS,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          { status: response.status, error: errorText },
          "OpenAI API error"
        );
        throw new Error(
          `OpenAI API error: ${response.status} ${response.statusText}`
        );
      }

      const data = (await response.json()) as {
        data: Array<{ embedding: number[]; index: number }>;
      };

      // Sort by index to ensure order matches input
      const sortedEmbeddings = data.data
        .sort((a, b) => a.index - b.index)
        .map((item) => item.embedding);

      return sortedEmbeddings;
    } catch (error) {
      if (error instanceof Error) {
        logger.error({ error: error.message }, "Failed to generate embeddings");
        throw error;
      }
      throw new Error("Unknown error occurred while generating embeddings");
    }
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error("Vectors must have the same length");
    }

    if (a.length === 0) {
      throw new Error("Vectors cannot be empty");
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) {
      throw new Error("Vectors cannot have zero magnitude");
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
