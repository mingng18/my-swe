import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { MemoryRepository } from "../repository";
import type { Memory } from "../types";
import type { SupabaseClient } from "../repository";

// Mock Supabase client for testing
class MockSupabaseClient implements SupabaseClient {
  private memories: Map<string, any> = new Map();
  private nextId = 1;

  async fetch(url: string, options?: RequestInit): Promise<Response> {
    const method = options?.method || "GET";

    // Parse URL to extract operation
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const params = urlObj.searchParams;

    // Extract ID from URL if present (check both pathname and search params)
    const idMatch = url.match(/id=eq\.([^&]+)/);
    const threadIdMatch = url.match(/thread_id=eq\.([^&]+)/);

    if (method === "GET") {
      // Check thread_id first to avoid conflict with id regex
      if (threadIdMatch) {
        const threadId = decodeURIComponent(threadIdMatch[1]);
        const memories = Array.from(this.memories.values()).filter(
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
            const filtered = memories.filter((m: any) =>
              types.includes(m.type),
            );
            return new Response(JSON.stringify(filtered), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
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
          // If this is an access count update (has last_accessed_at), increment access_count
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

describe("MemoryRepository", () => {
  let repo: MemoryRepository;
  const testThreadId = "test-thread-" + Date.now();

  beforeAll(() => {
    // Set test environment variables
    process.env.SUPABASE_URL =
      process.env.SUPABASE_URL || "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY =
      process.env.SUPABASE_SERVICE_ROLE_KEY || "test-key";
  });

  beforeEach(() => {
    const mockClient = new MockSupabaseClient();
    repo = new MemoryRepository(mockClient as any);
  });

  it("should save a memory", async () => {
    const memory: Memory = {
      threadId: testThreadId,
      type: "user",
      title: "Test preference",
      content: "User prefers TypeScript",
      metadata: { source: "test" },
    };

    const saved = await repo.save(memory);
    expect(saved.id).toBeDefined();
    expect(saved.threadId).toBe(testThreadId);
    expect(saved.title).toBe("Test preference");
    expect(saved.content).toBe("User prefers TypeScript");
  });

  it("should retrieve a memory by ID", async () => {
    const memory: Memory = {
      threadId: testThreadId,
      type: "feedback",
      title: "Test feedback",
      content: "Do not mock database",
      metadata: {},
    };

    const saved = await repo.save(memory);
    const retrieved = await repo.getById(saved.id!);

    expect(retrieved).toBeDefined();
    expect(retrieved?.title).toBe("Test feedback");
    expect(retrieved?.content).toBe("Do not mock database");
  });

  it("should search memories by thread", async () => {
    // First save a memory
    const memory: Memory = {
      threadId: testThreadId,
      type: "project",
      title: "Project context",
      content: "This is a Node.js project",
      metadata: {},
    };
    await repo.save(memory);

    const results = await repo.getByThread(testThreadId);
    expect(results.length).toBeGreaterThan(0);
  });

  it("should filter memories by type when searching by thread", async () => {
    // Save memories of different types
    await repo.save({
      threadId: testThreadId,
      type: "user",
      title: "User pref",
      content: "Prefers dark mode",
      metadata: {},
    });
    await repo.save({
      threadId: testThreadId,
      type: "project",
      title: "Project info",
      content: "Uses TypeScript",
      metadata: {},
    });

    const userMemories = await repo.getByThread(testThreadId, ["user"]);
    expect(userMemories.every((m) => m.type === "user")).toBe(true);
  });

  it("should delete a memory (soft delete)", async () => {
    const memory: Memory = {
      threadId: testThreadId,
      type: "project",
      title: "To be deleted",
      content: "Temporary memory",
      metadata: {},
    };

    const saved = await repo.save(memory);
    await repo.softDelete(saved.id!);

    const retrieved = await repo.getById(saved.id!);
    expect(retrieved?.isActive).toBe(false);
  });

  it("should permanently delete a memory", async () => {
    const memory: Memory = {
      threadId: testThreadId,
      type: "reference",
      title: "Temporary reference",
      content: "Will be permanently deleted",
      metadata: {},
    };

    const saved = await repo.save(memory);
    await repo.delete(saved.id!);

    const retrieved = await repo.getById(saved.id!);
    expect(retrieved).toBeNull();
  });

  it("should update a memory", async () => {
    const memory: Memory = {
      threadId: testThreadId,
      type: "user",
      title: "Original title",
      content: "Original content",
      metadata: {},
    };

    const saved = await repo.save(memory);
    const updated = await repo.update(saved.id!, {
      title: "Updated title",
      content: "Updated content",
    });

    expect(updated).toBeDefined();
    expect(updated?.title).toBe("Updated title");
    expect(updated?.content).toBe("Updated content");
  });

  it("should save multiple memories in batch", async () => {
    const memories: Memory[] = [
      {
        threadId: testThreadId,
        type: "user",
        title: "Batch 1",
        content: "First batch memory",
        metadata: {},
      },
      {
        threadId: testThreadId,
        type: "project",
        title: "Batch 2",
        content: "Second batch memory",
        metadata: {},
      },
    ];

    const saved = await repo.saveBatch(memories);
    expect(saved.length).toBe(2);
    expect(saved[0].id).toBeDefined();
    expect(saved[1].id).toBeDefined();
  });

  it("should increment access count on retrieval", async () => {
    const memory: Memory = {
      threadId: testThreadId,
      type: "feedback",
      title: "Access test",
      content: "Testing access count",
      metadata: {},
    };

    const saved = await repo.save(memory);
    const initialAccessCount = saved.accessCount || 0;

    // Access the memory
    await repo.getById(saved.id!);
    await repo.getById(saved.id!);

    const retrieved = await repo.getById(saved.id!);
    expect(retrieved?.accessCount).toBeGreaterThan(initialAccessCount);
  });
});
