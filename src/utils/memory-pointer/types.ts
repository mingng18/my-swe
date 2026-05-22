/**
 * Metadata stored with each artifact
 */
export interface ArtifactMetadata {
  id: string;
  threadId: string;
  type: string;
  timestamp: number;
  size: number;
  tokenCount: number;
  expiresAt: number;
  metadata: Record<string, unknown>;
}

/**
 * Stored artifact data
 */
export interface StoredArtifact {
  metadata: ArtifactMetadata;
  content: string;
}

/**
 * Query options for retrieving portions of artifacts
 */
export interface QueryOptions {
  type: "full" | "line-range" | "grep" | "summary";
  startLine?: number;
  endLine?: number;
  pattern?: string;
  caseInsensitive?: boolean;
  maxResults?: number;
}

/**
 * Result of an artifact query
 */
export interface QueryResult {
  content: string;
  truncated: boolean;
  originalSize: number;
  queryType: string;
}

/**
 * Options for updating an artifact
 */
export interface UpdateOptions {
  content?: string;
  metadata?: Record<string, unknown>;
  type?: string;
}
