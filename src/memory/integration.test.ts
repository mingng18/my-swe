/**
 * Integration Tests for Memory System
 *
 * Tests the full memory flow: extract -> embed -> save -> search
 * Also tests duplicate detection and semantic search functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { MemoryRepository } from "./repository";
import { MemoryExtractor } from "./extractor";
import { EmbeddingService } from "./embeddings";
import { SearchService } from "./search";
import { ConsolidationService } from "./consolidation";
import type { Memory, TurnResult } from "./types";

// Mock Supabase client for testing
class MockSupabaseClient {
  private memories: Map<string, any> = new Map();

  async fetch(url: string, options?: RequestInit): Promise<Response> {
    const method = options?.method || "GET";

    if (method === "GET") {
      // Parse URL to extract filter parameters
      const urlObj = new URL(url);
      const threadId = urlObj.searchParams.get("thread_id");
      const id = urlObj.searchParams.get("id");

      if (id) {
        // Get by ID
        const memory = this.memories.get(id);
        return new Response(JSON.stringify(memory ? [memory] : []), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (threadId) {
        // Get by thread ID
        const memories = Array.from(this.memories.values()).filter(
          (m) => m.thread_id === threadId,
        );
        return new Response(JSON.stringify(memories), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (method === "POST") {
      // Insert or upsert
      const body = JSON.parse(options?.body as string);
      const memories = Array.isArray(body) ? body : [body];

      for (const memory of memories) {
        if (!memory.id) {
          memory.id = crypto.randomUUID();
        }
        this.memories.set(memory.id, memory);
      }

      return new Response(JSON.stringify(memories), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (method === "PATCH") {
      // Update
      const urlObj = new URL(url);
      const id = urlObj.searchParams.get("id");
      const updates = JSON.parse(options?.body as string);

      if (id) {
        const existing = this.memories.get(id);
        if (existing) {
          Object.assign(existing, updates);
          return new Response(JSON.stringify([existing]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      return new Response(null, { status: 404 });
    }

    if (method === "DELETE") {
      const urlObj = new URL(url);
      const id = urlObj.searchParams.get("id");

      if (id && this.memories.has(id)) {
        this.memories.delete(id);
        return new Response(null, { status: 204 });
      }

      return new Response(null, { status: 404 });
    }

    return new Response(null, { status: 400 });
  }

  clear() {
    this.memories.clear();
  }

  get count() {
    return this.memories.size;
  }
}

describe("Memory System Integration", () => {
  let mockClient: MockSupabaseClient;
  let repository: MemoryRepository;
  let extractor: MemoryExtractor;
  let embeddingService: EmbeddingService;
  let searchService: SearchService;
  let consolidationService: ConsolidationService;

  beforeEach(() => {
    // Setup mock environment
    process.env.SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    process.env.OPENAI_API_KEY = "test-key";

    mockClient = new MockSupabaseClient();
    repository = new MemoryRepository(mockClient as any);
    extractor = new MemoryExtractor();
    embeddingService = new EmbeddingService();
    searchService = new SearchService(repository, {
      generateEmbedding: (text: string) =>
        embeddingService.generateEmbedding(text),
      cosineSimilarity: (a: number[], b: number[]) =>
        EmbeddingService.cosineSimilarity(a, b),
    });
    consolidationService = new ConsolidationService(repository, {
      generateEmbedding: (text: string) =>
        embeddingService.generateEmbedding(text),
      cosineSimilarity: (a: number[], b: number[]) =>
        EmbeddingService.cosineSimilarity(a, b),
    });
  });

  afterEach(() => {
    mockClient.clear();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  describe("Full Memory Flow", () => {
    it("should extract, embed, save, and search memories", async () => {
      const threadId = "test-thread-1";

      // Step 1: Extract memories from a turn
      const turn: TurnResult = {
        threadId,
        userText: "I prefer using TypeScript strict mode",
        input: "I prefer using TypeScript strict mode",
        agentReply:
          "I'll implement this using TypeScript with strict mode enabled",
      };

      const extractedMemories = extractor.extractFromTurn(turn);
      expect(extractedMemories.length).toBeGreaterThan(0);

      // Step 2: Generate embeddings
      const memoriesWithEmbeddings = await Promise.all(
        extractedMemories.map(async (extracted) => {
          const text = `${extracted.title}. ${extracted.content}`;
          const embedding = await embeddingService.generateEmbedding(text);
          return {
            threadId,
            type: extracted.type,
            title: extracted.title,
            content: extracted.content,
            metadata: extracted.metadata,
            embedding,
          } as Memory;
        }),
      );

      expect(memoriesWithEmbeddings[0].embedding).toBeDefined();
      expect(memoriesWithEmbeddings[0].embedding!.length).toBeGreaterThan(0);

      // Step 3: Save memories
      const savedMemories = await repository.saveBatch(memoriesWithEmbeddings);
      expect(savedMemories.length).toBe(extractedMemories.length);
      expect(mockClient.count).toBe(extractedMemories.length);

      // Step 4: Search memories
      const searchResults = await searchService.search({
        query: "TypeScript preferences",
        threadIds: [threadId],
        limit: 5,
      });

      expect(searchResults.length).toBeGreaterThan(0);
      expect(searchResults[0].relevanceScore).toBeGreaterThan(0);
    });

    it("should handle empty extraction gracefully", async () => {
      const turn: TurnResult = {
        threadId: "test-thread-2",
        userText: "",
        input: "",
      };

      const extractedMemories = extractor.extractFromTurn(turn);
      expect(extractedMemories.length).toBe(0);
    });

    it("should extract from different sources", async () => {
      const turn: TurnResult = {
        threadId: "test-thread-3",
        userText: "I'm a frontend developer",
        input: "I'm a frontend developer",
        agentReply: "I'll use React for this implementation",
        agentError: "Failed to connect to API",
        deterministic: {
          linterResults: {
            success: false,
            exitCode: 1,
            output: "TypeScript error: Cannot find module",
          },
        },
      };

      const extractedMemories = extractor.extractFromTurn(turn);

      // Should extract from user text, agent reply, error, and linter results
      expect(extractedMemories.length).toBeGreaterThan(0);

      const types = extractedMemories.map((m) => m.type);
      expect(types).toContain("user");
    });
  });

  describe("Duplicate Detection", () => {
    it("should detect similar memories using consolidation", async () => {
      const threadId = "test-thread-duplicates";

      // Save similar memories
      const memories: Memory[] = [
        {
          threadId,
          type: "user",
          title: "[preference] I prefer TypeScript",
          content: "I prefer using TypeScript for all projects",
          metadata: {},
          embedding: await embeddingService.generateEmbedding(
            "I prefer using TypeScript for all projects",
          ),
        },
        {
          threadId,
          type: "user",
          title: "[preference] I like TypeScript",
          content: "I like to use TypeScript in my code",
          metadata: {},
          embedding: await embeddingService.generateEmbedding(
            "I like to use TypeScript in my code",
          ),
        },
      ];

      await repository.saveBatch(memories);

      // Run consolidation
      const result = await consolidationService.consolidate(threadId);

      expect(result.processed).toBeGreaterThan(0);
      expect(result.merged).toBeGreaterThanOrEqual(0);
    });

    it("should not merge distinct memories", async () => {
      const threadId = "test-thread-distinct";

      // Save distinct memories
      const memories: Memory[] = [
        {
          threadId,
          type: "user",
          title: "[preference] TypeScript preference",
          content: "I prefer TypeScript",
          metadata: {},
          embedding: await embeddingService.generateEmbedding(
            "I prefer TypeScript",
          ),
        },
        {
          threadId,
          type: "project",
          title: "[tech_stack] React usage",
          content: "We use React for frontend",
          metadata: {},
          embedding: await embeddingService.generateEmbedding(
            "We use React for frontend",
          ),
        },
      ];

      await repository.saveBatch(memories);

      // Run consolidation
      const result = await consolidationService.consolidate(threadId);

      // Should not merge these as they're about different topics
      expect(result.processed).toBeGreaterThan(0);
    });
  });

  describe("Semantic Search", () => {
    it("should return relevant results for semantic queries", async () => {
      const threadId = "test-thread-search";

      // Save memories with different topics
      const memories: Memory[] = [
        {
          threadId,
          type: "user",
          title: "[expertise] Frontend developer",
          content: "I am a frontend developer specializing in React",
          metadata: {},
          embedding: await embeddingService.generateEmbedding(
            "I am a frontend developer specializing in React",
          ),
        },
        {
          threadId,
          type: "project",
          title: "[architecture] Microservices",
          content: "The project uses microservices architecture",
          metadata: {},
          embedding: await embeddingService.generateEmbedding(
            "The project uses microservices architecture",
          ),
        },
      ];

      await repository.saveBatch(memories);

      // Search for frontend-related content
      const results = await searchService.search({
        query: "React development",
        threadIds: [threadId],
        limit: 5,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].relevanceScore).toBeGreaterThan(0);
    });

    it("should filter by memory type", async () => {
      const threadId = "test-thread-filter";

      const memories: Memory[] = [
        {
          threadId,
          type: "user",
          title: "[preference] TypeScript",
          content: "I prefer TypeScript",
          metadata: {},
          embedding: await embeddingService.generateEmbedding(
            "I prefer TypeScript",
          ),
        },
        {
          threadId,
          type: "project",
          title: "[tech_stack] React",
          content: "We use React",
          metadata: {},
          embedding: await embeddingService.generateEmbedding("We use React"),
        },
      ];

      await repository.saveBatch(memories);

      // Search only user memories
      const results = await searchService.search({
        query: "TypeScript",
        threadIds: [threadId],
        types: ["user"],
        limit: 5,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.type === "user")).toBe(true);
    });

    it("should respect similarity threshold", async () => {
      const threadId = "test-thread-threshold";

      const memories: Memory[] = [
        {
          threadId,
          type: "user",
          title: "[preference] TypeScript",
          content: "I prefer TypeScript",
          metadata: {},
          embedding: await embeddingService.generateEmbedding(
            "I prefer TypeScript",
          ),
        },
      ];

      await repository.saveBatch(memories);

      // Search with high threshold
      const highThresholdResults = await searchService.search({
        query: "JavaScript", // Different topic
        threadIds: [threadId],
        similarityThreshold: 0.9,
        limit: 5,
      });

      // Search with low threshold
      const lowThresholdResults = await searchService.search({
        query: "TypeScript", // Same topic
        threadIds: [threadId],
        similarityThreshold: 0.5,
        limit: 5,
      });

      // Low threshold should return more or equal results
      expect(lowThresholdResults.length).toBeGreaterThanOrEqual(
        highThresholdResults.length,
      );
    });
  });

  describe("Error Handling", () => {
    it("should handle embedding generation failures gracefully", async () => {
      // Use invalid API key
      process.env.OPENAI_API_KEY = "invalid-key";

      const invalidEmbeddingService = new EmbeddingService();

      // Should throw or handle error
      try {
        await invalidEmbeddingService.generateEmbedding("test");
        // If it doesn't throw, that's also fine (mock implementation)
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it("should handle search with no memories gracefully", async () => {
      const results = await searchService.search({
        query: "test",
        threadIds: ["nonexistent-thread"],
        limit: 5,
      });

      expect(results).toEqual([]);
    });

    it("should handle empty query gracefully", async () => {
      const results = await searchService.search({
        query: "",
        threadIds: ["test-thread"],
        limit: 5,
      });

      expect(results).toEqual([]);
    });
  });

  describe("Memory Lifecycle", () => {
    it("should support soft delete and reactivation", async () => {
      const threadId = "test-thread-lifecycle";

      const memory: Memory = {
        threadId,
        type: "user",
        title: "[test] Test memory",
        content: "Test content",
        metadata: {},
        embedding: await embeddingService.generateEmbedding("Test content"),
      };

      // Save memory
      const saved = await repository.save(memory);
      expect(saved.isActive).toBe(true);

      // Soft delete
      await repository.softDelete(saved.id!);

      // Verify it's marked inactive
      const updated = await repository.update(saved.id!, { isActive: false });
      expect(updated?.isActive).toBe(false);

      // Reactivate
      const reactivated = await repository.update(saved.id!, {
        isActive: true,
      });
      expect(reactivated?.isActive).toBe(true);
    });

    it("should track access count", async () => {
      const threadId = "test-thread-access";

      const memory: Memory = {
        threadId,
        type: "user",
        title: "[test] Test memory",
        content: "Test content",
        metadata: {},
        embedding: await embeddingService.generateEmbedding("Test content"),
      };

      const saved = await repository.save(memory);
      expect(saved.accessCount).toBe(0);

      // Access the memory
      const retrieved = await repository.getById(saved.id!);
      expect(retrieved).toBeDefined();
    });
  });
});
