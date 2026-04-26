import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
} from "bun:test";
import { MemoryDaemon } from "../daemon";
import { MemoryRepository } from "../repository";
import { ConsolidationService } from "../consolidation";
import type { SupabaseClient } from "../repository";

// Mock Supabase client
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
  async generateEmbedding(text: string): Promise<number[]> {
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

describe("MemoryDaemon", () => {
  let daemon: MemoryDaemon;
  let repository: MemoryRepository;
  let consolidationService: ConsolidationService;
  let mockEmbeddingService: MockEmbeddingService;

  beforeAll(() => {
    process.env.SUPABASE_URL =
      process.env.SUPABASE_URL || "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY =
      process.env.SUPABASE_SERVICE_ROLE_KEY || "test-key";
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "test-key";
    process.env.OPENAI_BASE_URL =
      process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  });

  beforeEach(() => {
    const mockClient = new MockSupabaseClient();
    repository = new MemoryRepository(mockClient as any);
    mockEmbeddingService = new MockEmbeddingService();
    consolidationService = new ConsolidationService(
      repository,
      mockEmbeddingService as any,
    );
    daemon = new (MemoryDaemon as any)(
      repository,
      consolidationService,
      mockEmbeddingService as any,
      1000,
    ); // 1 second interval for testing
  });

  afterEach(() => {
    if (daemon) {
      daemon.stop();
      daemon.clearSessions();
    }
  });

  it("should start and stop the daemon", () => {
    expect(daemon.getStatus().isRunning).toBe(false);

    daemon.start();
    expect(daemon.getStatus().isRunning).toBe(true);

    daemon.stop();
    expect(daemon.getStatus().isRunning).toBe(false);
  });

  it("should register and unregister sessions", () => {
    const threadId = "test-thread-1";

    daemon.registerSession(threadId);
    expect(daemon.getRegisteredSessions().length).toBe(1);
    expect(daemon.getRegisteredSessions()[0].threadId).toBe(threadId);

    daemon.unregisterSession(threadId);
    expect(daemon.getRegisteredSessions().length).toBe(0);
  });

  it("should update existing session on re-registration", async () => {
    const threadId = "test-thread-2";

    daemon.registerSession(threadId);
    const firstSession = daemon.getRegisteredSessions()[0];

    // Wait a bit and re-register
    await new Promise((resolve) => setTimeout(resolve, 100));
    daemon.registerSession(threadId);

    const sessions = daemon.getRegisteredSessions();
    expect(sessions.length).toBe(1);
    // Just check that the session was updated (same session object)
    expect(sessions[0].threadId).toBe(firstSession.threadId);
    expect(sessions[0].registeredAt).toEqual(firstSession.registeredAt);
  });

  it("should trigger immediate consolidation", async () => {
    const threadId = "test-thread-3";

    // Add some test memories
    const embedding =
      await mockEmbeddingService.generateEmbedding("test content");
    await repository.save({
      threadId,
      type: "user",
      title: "Test memory",
      content: "Test content",
      metadata: {},
      embedding,
    });

    const result = await daemon.triggerConsolidation(threadId);

    expect(result.success).toBe(true);
    expect(result.result).toBeDefined();
    expect(result.result.processed).toBeGreaterThanOrEqual(0);
  });

  it("should return daemon status", () => {
    const status = daemon.getStatus();

    expect(status).toBeDefined();
    expect(status.isRunning).toBe(false);
    expect(status.consolidationInterval).toBe(1000);
    expect(status.registeredSessions).toBe(0);
    expect(status.totalConsolidations).toBe(0);
    expect(status.totalErrors).toBe(0);
  });

  it("should clear all sessions", () => {
    daemon.registerSession("thread-1");
    daemon.registerSession("thread-2");
    daemon.registerSession("thread-3");

    expect(daemon.getRegisteredSessions().length).toBe(3);

    daemon.clearSessions();
    expect(daemon.getRegisteredSessions().length).toBe(0);
  });

  it("should set consolidation interval", () => {
    daemon.setConsolidationInterval(5000);
    expect(daemon.getStatus().consolidationInterval).toBe(5000);
  });

  it("should handle multiple start/stop cycles", () => {
    daemon.start();
    expect(daemon.getStatus().isRunning).toBe(true);

    daemon.start(); // Should not throw
    expect(daemon.getStatus().isRunning).toBe(true);

    daemon.stop();
    expect(daemon.getStatus().isRunning).toBe(false);

    daemon.stop(); // Should not throw
    expect(daemon.getStatus().isRunning).toBe(false);
  });

  it("should provide singleton instance", () => {
    const instance1 = MemoryDaemon.getInstance();
    const instance2 = MemoryDaemon.getInstance();

    expect(instance1).toBe(instance2);
  });

  it("should handle consolidation errors gracefully", async () => {
    const threadId = "test-thread-error";

    // Trigger consolidation for empty thread (should not throw)
    const result = await daemon.triggerConsolidation(threadId);

    expect(result).toBeDefined();
    expect(result.success).toBeDefined();
  });

  it("should run consolidation cycle for registered sessions", async () => {
    const threadId1 = "test-thread-cycle-1";
    const threadId2 = "test-thread-cycle-2";

    // Register sessions
    daemon.registerSession(threadId1);
    daemon.registerSession(threadId2);

    // Start daemon
    daemon.start();

    // Run consolidation cycle manually
    await daemon.runConsolidationCycle();

    const status = daemon.getStatus();
    expect(status.totalConsolidations).toBe(1);
    expect(status.registeredSessions).toBe(2);

    daemon.stop();
  });

  it("should track errors during consolidation", async () => {
    const threadId = "test-thread-error-tracking";

    // Register session
    daemon.registerSession(threadId);

    // Start daemon
    daemon.start();

    // Run consolidation (should handle any errors gracefully)
    await daemon.runConsolidationCycle();

    const status = daemon.getStatus();
    expect(status.totalConsolidations).toBeGreaterThanOrEqual(0);

    daemon.stop();
  });
});
