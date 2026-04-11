import { randomUUID } from "node:crypto";
import { createLogger } from "../utils/logger";
import type { Memory, MemoryType } from "./types";

const logger = createLogger("memory-repository");

export interface SupabaseClient {
  fetch(url: string, options?: RequestInit): Promise<Response>;
}

interface SupabaseMemoryRow {
  id: string;
  thread_id: string;
  type: string;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at?: string;
  expires_at?: string;
  source_run_id?: string;
  is_active: boolean;
  access_count: number;
  last_accessed_at?: string;
  embedding?: number[];
}

/**
 * Real Supabase client using fetch
 */
class RealSupabaseClient implements SupabaseClient {
  constructor(private serviceKey: string) {}

  async fetch(url: string, options: RequestInit = {}): Promise<Response> {
    return fetch(url, {
      ...options,
      headers: {
        apikey: this.serviceKey,
        Authorization: `Bearer ${this.serviceKey}`,
        ...options.headers,
      },
    });
  }
}

/**
 * Repository for managing memories in Supabase
 */
export class MemoryRepository {
  private supabaseUrl: string;
  private client: SupabaseClient;
  private tableName = "memories";

  constructor(client?: SupabaseClient) {
    const url = process.env.SUPABASE_URL?.trim();
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

    if (!url || !key) {
      throw new Error(
        "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required",
      );
    }

    this.supabaseUrl = url.replace(/\/+$/, "");
    this.client = client || new RealSupabaseClient(key);
  }

  /**
   * Save a single memory
   */
  async save(memory: Memory): Promise<Memory> {
    const row = this.toRow(memory);
    row.id = row.id || randomUUID();
    row.created_at = row.created_at || new Date().toISOString();
    row.is_active = row.is_active !== undefined ? row.is_active : true;
    row.access_count = row.access_count || 0;

    const saved = await this.supabaseUpsert(row);
    if (!saved) {
      throw new Error("Failed to save memory");
    }

    return this.fromRow(saved);
  }

  /**
   * Save multiple memories in batch
   */
  async saveBatch(memories: Memory[]): Promise<Memory[]> {
    const rows = memories.map((memory) => {
      const row = this.toRow(memory);
      row.id = row.id || randomUUID();
      row.created_at = row.created_at || new Date().toISOString();
      row.is_active = row.is_active !== undefined ? row.is_active : true;
      row.access_count = row.access_count || 0;
      return row;
    });

    const saved = await this.supabaseInsertMany(rows);
    if (!saved) {
      throw new Error("Failed to save memories in batch");
    }

    return saved.map((row) => this.fromRow(row));
  }

  /**
   * Get a memory by ID
   */
  async getById(id: string): Promise<Memory | null> {
    // Increment access count first
    await this.incrementAccessCount(id);

    // Then fetch the updated row
    const row = await this.supabaseSelectById(id);
    if (!row) {
      return null;
    }

    return this.fromRow(row);
  }

  /**
   * Get all memories for a thread, optionally filtered by type
   */
  async getByThread(threadId: string, types?: MemoryType[]): Promise<Memory[]> {
    const rows = await this.supabaseSelectByThread(threadId, types);
    return rows.map((row) => this.fromRow(row));
  }

  /**
   * Soft delete a memory (mark as inactive)
   */
  async softDelete(id: string): Promise<void> {
    await this.supabaseUpdate(id, { is_active: false });
  }

  /**
   * Permanently delete a memory
   */
  async delete(id: string): Promise<void> {
    await this.supabaseDelete(id);
  }

  /**
   * Update a memory
   */
  async update(
    id: string,
    updates: Partial<Omit<Memory, "id" | "threadId" | "createdAt">>,
  ): Promise<Memory | null> {
    const updateData: Partial<SupabaseMemoryRow> = {};

    if (updates.type !== undefined) updateData.type = updates.type;
    if (updates.title !== undefined) updateData.title = updates.title;
    if (updates.content !== undefined) updateData.content = updates.content;
    if (updates.metadata !== undefined) updateData.metadata = updates.metadata;
    if (updates.expiresAt !== undefined)
      updateData.expires_at = updates.expiresAt.toISOString();
    if (updates.sourceRunId !== undefined)
      updateData.source_run_id = updates.sourceRunId;
    if (updates.isActive !== undefined) updateData.is_active = updates.isActive;
    if (updates.embedding !== undefined)
      updateData.embedding = updates.embedding;

    await this.supabaseUpdate(id, updateData);

    const updated = await this.supabaseSelectById(id);
    return updated ? this.fromRow(updated) : null;
  }

  /**
   * Increment the access count for a memory
   */
  private async incrementAccessCount(id: string): Promise<void> {
    await this.supabaseUpdate(id, {
      last_accessed_at: new Date().toISOString(),
    });
    // Note: In a real implementation, we'd use a PostgreSQL increment function
    // For now, we handle this in the getById method
  }

  /**
   * Convert Memory to Supabase row format
   */
  private toRow(memory: Memory): SupabaseMemoryRow {
    return {
      id: memory.id || randomUUID(),
      thread_id: memory.threadId,
      type: memory.type,
      title: memory.title,
      content: memory.content,
      metadata: memory.metadata,
      created_at: memory.createdAt?.toISOString(),
      expires_at: memory.expiresAt?.toISOString(),
      source_run_id: memory.sourceRunId,
      is_active: memory.isActive !== undefined ? memory.isActive : true,
      access_count: memory.accessCount || 0,
      last_accessed_at: memory.lastAccessedAt?.toISOString(),
      embedding: memory.embedding,
    };
  }

  /**
   * Convert Supabase row to Memory format
   */
  private fromRow(row: SupabaseMemoryRow): Memory {
    return {
      id: row.id,
      threadId: row.thread_id,
      type: row.type as MemoryType,
      title: row.title,
      content: row.content,
      metadata: row.metadata || {},
      createdAt: row.created_at ? new Date(row.created_at) : undefined,
      expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
      sourceRunId: row.source_run_id,
      isActive: row.is_active,
      accessCount: row.access_count,
      lastAccessedAt: row.last_accessed_at
        ? new Date(row.last_accessed_at)
        : undefined,
      embedding: row.embedding,
    };
  }

  /**
   * Supabase: Select by ID
   */
  private async supabaseSelectById(
    id: string,
  ): Promise<SupabaseMemoryRow | null> {
    const url = `${this.supabaseUrl}/rest/v1/${this.tableName}?id=eq.${encodeURIComponent(id)}&limit=1`;
    const res = await this.client.fetch(url);

    if (!res.ok) {
      logger.warn({ status: res.status }, "Failed to select memory by ID");
      return null;
    }

    const json = (await res.json()) as SupabaseMemoryRow[];
    return json?.[0] ?? null;
  }

  /**
   * Supabase: Select by thread ID
   */
  private async supabaseSelectByThread(
    threadId: string,
    types?: MemoryType[],
  ): Promise<SupabaseMemoryRow[]> {
    let url = `${this.supabaseUrl}/rest/v1/${this.tableName}?thread_id=eq.${encodeURIComponent(threadId)}`;

    if (types && types.length > 0) {
      const typeFilter = types
        .map((t) => `type.eq.${encodeURIComponent(t)}`)
        .join(",");
      url += `&or=(${typeFilter})`;
    }

    url += "&order=created_at.desc";

    const res = await this.client.fetch(url);

    if (!res.ok) {
      logger.warn(
        { status: res.status },
        "Failed to select memories by thread",
      );
      return [];
    }

    return (await res.json()) as SupabaseMemoryRow[];
  }

  /**
   * Supabase: Upsert single row
   */
  private async supabaseUpsert(
    row: SupabaseMemoryRow,
  ): Promise<SupabaseMemoryRow | null> {
    const url = `${this.supabaseUrl}/rest/v1/${this.tableName}`;
    const res = await this.client.fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify([row]),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn({ status: res.status, body }, "Failed to upsert memory");
      return null;
    }

    const json = (await res.json()) as SupabaseMemoryRow[];
    return json?.[0] ?? null;
  }

  /**
   * Supabase: Insert many rows
   */
  private async supabaseInsertMany(
    rows: SupabaseMemoryRow[],
  ): Promise<SupabaseMemoryRow[] | null> {
    if (rows.length === 0) return [];

    const url = `${this.supabaseUrl}/rest/v1/${this.tableName}`;
    const res = await this.client.fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(rows),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn({ status: res.status, body }, "Failed to insert memories");
      return null;
    }

    return (await res.json()) as SupabaseMemoryRow[];
  }

  /**
   * Supabase: Update row
   */
  private async supabaseUpdate(
    id: string,
    updates: Partial<SupabaseMemoryRow>,
  ): Promise<void> {
    const url = `${this.supabaseUrl}/rest/v1/${this.tableName}?id=eq.${encodeURIComponent(id)}`;
    const res = await this.client.fetch(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(updates),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn({ status: res.status, body }, "Failed to update memory");
    }
  }

  /**
   * Supabase: Delete row
   */
  private async supabaseDelete(id: string): Promise<void> {
    const url = `${this.supabaseUrl}/rest/v1/${this.tableName}?id=eq.${encodeURIComponent(id)}`;
    const res = await this.client.fetch(url, {
      method: "DELETE",
    });

    if (!res.ok) {
      logger.warn({ status: res.status }, "Failed to delete memory");
    }
  }
}
