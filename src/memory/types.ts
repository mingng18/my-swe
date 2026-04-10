/**
 * Memory type categories matching Claude Code's Auto Memory
 */
export type MemoryType = "user" | "feedback" | "project" | "reference";

/**
 * A memory extracted from an agent turn
 */
export interface Memory {
  id?: string;
  threadId: string;
  type: MemoryType;
  title: string;
  content: string;
  embedding?: number[];
  metadata: Record<string, unknown>;
  createdAt?: Date;
  expiresAt?: Date;
  sourceRunId?: string;
  isActive?: boolean;
  accessCount?: number;
  lastAccessedAt?: Date;
}

/**
 * Extracted memory before saving (no ID/timestamps)
 */
export interface ExtractedMemory {
  type: MemoryType;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
}

/**
 * Search result with relevance score
 */
export interface MemorySearchResult {
  id: string;
  type: MemoryType;
  title: string;
  preview: string;
  relevanceScore: number;
  createdAt: Date;
  metadata: Record<string, unknown>;
}

/**
 * Search options
 */
export interface MemorySearchOptions {
  query: string;
  types?: MemoryType[];
  limit?: number;
  hybrid?: boolean;
  similarityThreshold?: number;
  threadIds?: string[];
}

/**
 * Consolidation result
 */
export interface ConsolidationResult {
  processed: number;
  merged: number;
  archived: number;
  errors: string[];
}

/**
 * Turn result for memory extraction
 */
export interface TurnResult {
  threadId: string;
  userText: string;
  input: string;
  agentReply?: string;
  agentError?: string;
  plan?: string;
  fixAttempt?: string;
  deterministic?: {
    formatResults?: { success: boolean; output?: string };
    linterResults?: { success: boolean; exitCode?: number; output?: string };
    testResults?: { passed: boolean; summary?: string; output?: string };
  };
}
