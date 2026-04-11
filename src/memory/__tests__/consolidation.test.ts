import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { ConsolidationService } from "../consolidation";
import { MemoryRepository } from "../repository";
import { EmbeddingService } from "../embeddings";
import type { Memory, MemoryType } from "../types";
import type { SupabaseClient } from "../repository";

// Mock Supabase client for testing
class MockSupabaseClient implements SupabaseClient {
  private memories: Map<string, any> = new Map();
  private nextId = 1;

  async fetch(url: string, options?: RequestInit): Promise<Response> {
    const method = options?.method || "GET";
    const urlObj = new URL(url);
    const params = urlObj.searchParams;

    const idMatch = url.match(/id=eq\.([^&]+)/);
    const threadIdMatch = url.match(/thread_id=eq\.([^&]+)/);

    if (method === "GET") {
      if (threadIdMatch) {
        const threadId = decodeURIComponent(threadIdMatch[1]);
        let memories = Array.from(this.memories.values()).filter(
          (m: any) =>
            (m.thread_id || m.threadId) === threadId &&
            m.is_active !== false &&
            m.isActive !== false,
        );

        // Check for type filter
        const orParam = params.get("or");
        if (orParam) {
          const types = orParam
            .match(/type\.eq\.([^,)]+)/g)
            ?.map((t: string) => t.replace("type.eq.", ""));
          if (types) {
            memories = memories.filter((m: any) => types.includes(m.type));
          }
        }

        return new Response(JSON.stringify(memories), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (idMatch) {
        const id = decodeURIComponent(idMatch[1]);
        const memory = this.memories.get(id);
        if (!memory) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify([memory]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
    }

    if (method === "POST") {
      const body = JSON.parse(options?.body as string);
      const memories = Array.isArray(body) ? body : [body];
      const savedMemories: any[] = [];

      for (const memory of memories) {
        const id = memory.id || `mock-${this.nextId++}`;
        const saved = {
          ...memory,
          id,
          created_at: memory.created_at || new Date().toISOString(),
          is_active: memory.is_active !== undefined ? memory.is_active : true,
          access_count: memory.access_count || 0,
        };
        this.memories.set(id, saved);
        savedMemories.push(saved);
      }

      return new Response(JSON.stringify(savedMemories), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (method === "PATCH") {
      const idMatch = url.match(/id=eq\.([^&]+)/);
      if (idMatch) {
        const id = decodeURIComponent(idMatch[1]);
        const updates = JSON.parse(options?.body as string);
        const existing = this.memories.get(id);

        if (existing) {
          const updated = { ...existing, ...updates };
          if (updates.last_accessed_at) {
            updated.access_count = (existing.access_count || 0) + 1;
          }
          this.memories.set(id, updated);
        }
      }
      return new Response(null, { status: 204 });
    }

    if (method === "DELETE") {
      const idMatch = url.match(/id=eq\.([^&]+)/);
      if (idMatch) {
        const id = decodeURIComponent(idMatch[1]);
        this.memories.delete(id);
      }
      return new Response(null, { status: 204 });
    }

    return new Response("Not found", { status: 404 });
  }
}

// Mock EmbeddingService
class MockEmbeddingService {
  private static createMockEmbedding(text: string): number[] {
    const seed = text
      .split("")
      .reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const embedding: number[] = [];

    for (let i = 0; i < 1536; i++) {
      const value = Math.sin(seed + i * 0.1) * 0.5 + 0.5;
      embedding.push(value);
    }

    const magnitude = Math.sqrt(
      embedding.reduce((sum, val) => sum + val * val, 0),
    );
    return embedding.map((val) => val / magnitude);
  }

  async generateEmbedding(text: string): Promise<number[]> {
    return MockEmbeddingService.createMockEmbedding(text);
  }

  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error("Vectors must have the same length");
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}

describe("ConsolidationService", () => {
  let consolidationService: ConsolidationService;
  let repository: MemoryRepository;
  const testThreadId = "test-thread-consolidation-" + Date.now();

  beforeAll(() => {
    process.env.SUPABASE_URL =
      process.env.SUPABASE_URL || "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY =
      process.env.SUPABASE_SERVICE_ROLE_KEY || "test-key";
  });

  beforeEach(async () => {
    const mockClient = new MockSupabaseClient();
    repository = new MemoryRepository(mockClient as any);
    const mockEmbeddingService = new MockEmbeddingService() as any;
    consolidationService = new ConsolidationService(
      repository,
      mockEmbeddingService,
    );
  });

  it("should find duplicate memories using similarity threshold", async () => {
    // Add test memories with similar content
    const embedding = await new MockEmbeddingService().generateEmbedding(
      "similar content",
    );

    const memories: Memory[] = [
      {
        threadId: testThreadId,
        type: "user",
        title: "User prefers TypeScript",
        content: "The user prefers TypeScript for development",
        metadata: {},
        embedding,
      },
      {
        threadId: testThreadId,
        type: "user",
        title: "User likes TypeScript",
        content: "The user likes TypeScript for development",
        metadata: {},
        embedding, // Same embedding = high similarity
      },
    ];

    await repository.saveBatch(memories);

    const duplicates = await consolidationService.findDuplicates(
      testThreadId,
      0.9,
    );

    expect(duplicates.length).toBeGreaterThan(0);
    expect(duplicates[0].length).toBeGreaterThanOrEqual(2); // At least 2 duplicates in a group
  });

  it("should merge duplicate memories", async () => {
    const embedding = await new MockEmbeddingService().generateEmbedding(
      "merge test",
    );

    const memories: Memory[] = [
      {
        threadId: testThreadId,
        type: "project",
        title: "Project info",
        content: "This is a TypeScript project",
        metadata: { source: "first" },
        embedding,
      },
      {
        threadId: testThreadId,
        type: "project",
        title: "Project details",
        content: "This is a TypeScript project with React",
        metadata: { source: "second" },
        embedding,
      },
    ];

    const saved = await repository.saveBatch(memories);

    // Merge the duplicates
    const result = await consolidationService.mergeDuplicateGroup(saved);

    expect(result.processed).toBe(2);
    expect(result.merged).toBe(1); // 1 memory kept, 1 deleted
  });

  it("should find stale memories older than threshold", async () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 100); // 100 days ago

    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 10); // 10 days ago

    const memories: Memory[] = [
      {
        threadId: testThreadId,
        type: "reference",
        title: "Old reference",
        content: "This is old",
        metadata: {},
        createdAt: oldDate,
      },
      {
        threadId: testThreadId,
        type: "reference",
        title: "Recent reference",
        content: "This is recent",
        metadata: {},
        createdAt: recentDate,
      },
    ];

    await repository.saveBatch(memories);

    const staleMemories = await consolidationService.findStaleMemories(
      testThreadId,
      90,
    );

    expect(staleMemories.length).toBe(1);
    expect(staleMemories[0].title).toBe("Old reference");
  });

  it("should consolidate a thread", async () => {
    // Add various memories
    const embedding1 = await new MockEmbeddingService().generateEmbedding(
      "content 1",
    );
    const embedding2 = await new MockEmbeddingService().generateEmbedding(
      "content 2",
    );

    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 100);

    const memories: Memory[] = [
      {
        threadId: testThreadId,
        type: "user",
        title: "Duplicate 1",
        content: "Same content",
        metadata: {},
        embedding: embedding1,
      },
      {
        threadId: testThreadId,
        type: "user",
        title: "Duplicate 2",
        content: "Same content",
        metadata: {},
        embedding: embedding1, // Same embedding
      },
      {
        threadId: testThreadId,
        type: "reference",
        title: "Stale memory",
        content: "Old content",
        metadata: {},
        createdAt: oldDate,
        embedding: embedding2,
      },
    ];

    await repository.saveBatch(memories);

    const result = await consolidationService.consolidate(testThreadId);

    expect(result.processed).toBeGreaterThan(0);
    expect(result.merged + result.archived).toBeGreaterThan(0);
    expect(result.errors).toBeDefined();
  });

  it("should resolve time references in memory content", async () => {
    const content = "I fixed this issue yesterday";
    const resolved = consolidationService.resolveTimeReferences(content);

    // Should replace "yesterday" with actual date
    expect(resolved).not.toContain("yesterday");
    expect(resolved).toMatch(/\d{4}-\d{2}-\d{2}/); // Contains date
  });

  it("should handle empty thread gracefully", async () => {
    const result = await consolidationService.consolidate("empty-thread");

    expect(result.processed).toBe(0);
    expect(result.merged).toBe(0);
    expect(result.archived).toBe(0);
    expect(result.errors.length).toBe(0);
  });

  it("should respect custom similarity threshold", async () => {
    // Use the exact same embedding for both memories to ensure high similarity
    const sameEmbedding = await new MockEmbeddingService().generateEmbedding(
      "test content",
    );

    const memories: Memory[] = [
      {
        threadId: testThreadId,
        type: "project",
        title: "Memory 1",
        content: "Content 1",
        metadata: {},
        embedding: sameEmbedding, // Same embedding
      },
      {
        threadId: testThreadId,
        type: "project",
        title: "Memory 2",
        content: "Content 2",
        metadata: {},
        embedding: sameEmbedding, // Same embedding = 1.0 similarity
      },
    ];

    const saved = await repository.saveBatch(memories);

    // Debug: check if memories were saved with embeddings
    console.log("Saved memories:", saved.length);
    console.log("Memory 1 embedding length:", saved[0]?.embedding?.length);
    console.log("Memory 2 embedding length:", saved[1]?.embedding?.length);

    // With high threshold (0.95), should find duplicates since similarity is 1.0
    const highThreshold = await consolidationService.findDuplicates(
      testThreadId,
      0.95,
    );
    console.log("High threshold groups:", highThreshold.length);
    expect(highThreshold.length).toBeGreaterThan(0);

    // With even higher threshold (1.0), should still find duplicates
    const veryHighThreshold = await consolidationService.findDuplicates(
      testThreadId,
      1.0,
    );
    expect(veryHighThreshold.length).toBeGreaterThan(0);
  });
});
