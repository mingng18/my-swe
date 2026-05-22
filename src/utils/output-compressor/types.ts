/**
 * Compression context passed to compression functions.
 */
export interface CompressionContext {
  toolName: string;
  exitCode?: number;
  threadId?: string;
  command?: string;
}

/**
 * Result of compression operation.
 */
export interface CompressedResult {
  output: string;
  originalSize: number;
  compressedSize: number;
  strategy: string;
  metadata?: Record<string, unknown>;
}

/**
 * Compression strategy interface.
 */
export interface CompressionStrategy {
  name: string;
  apply: (input: string, context: CompressionContext) => string;
  priority: number;
}
