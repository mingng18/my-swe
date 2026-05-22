import { randomBytes } from "node:crypto";
import path from "node:path";
import { MEMORY_POINTER_DIR, MEMORY_POINTER_TTL_HOURS } from "./config";

/**
 * Validate a regex pattern to prevent ReDoS (Regular Expression Denial of Service).
 * Blocks patterns with nested repetition, multiple wildcards, or excessive length.
 */
export function isValidPattern(pattern: string): boolean {
  // Limit pattern length
  if (pattern.length > 200) {
    return false;
  }

  // Block dangerous patterns that could cause exponential backtracking
  const dangerousPatterns = [
    /\([^)]*\+[^)]*\)+/, // Nested repetition like (a+)+b
    /\([^)]*\*[^)]*\)+/, // Nested repetition with *
    /\(\.\+|\.\*\)/, // Repeated wildcards like .+ or .*
    /\(.+\*\+.*\)/, // Multiple repetition operators
    /\(\[.*\{.*\]/, // Character class with repetition
  ];

  for (const dangerous of dangerousPatterns) {
    if (dangerous.test(pattern)) {
      return false;
    }
  }

  return true;
}

/**
 * Estimate token count for a string (rough approximation)
 * Uses ~4 characters per token as a heuristic
 */
export function estimateTokens(str: string): number {
  return Math.ceil(str.length / 4);
}

/**
 * Generate a unique pointer ID
 */
export function generatePointerId(): string {
  const bytes = randomBytes(8);
  return `ptr_${bytes.toString("base64url")}`;
}

/**
 * Get the file path for a pointer ID with validation.
 * @throws {Error} If pointer ID format is invalid
 */
export function getPointerPath(pointerId: string): string {
  // Validate pointer ID format (ptr_ prefix followed by base64url characters)
  if (!pointerId || !/^ptr_[A-Za-z0-9_-]+$/.test(pointerId)) {
    throw new Error(`Invalid pointer ID format: ${pointerId}`);
  }

  // Additional length check to prevent path traversal via very long IDs
  if (pointerId.length > 100) {
    throw new Error(`Pointer ID too long: ${pointerId.length} characters`);
  }

  return path.join(MEMORY_POINTER_DIR, `${pointerId}.json`);
}

/**
 * Calculate expiration timestamp
 */
export function getExpirationTimestamp(): number {
  return Date.now() + MEMORY_POINTER_TTL_HOURS * 60 * 60 * 1000;
}

/**
 * Check if an artifact has expired
 */
export function isExpired(expiresAt: number): boolean {
  return Date.now() > expiresAt;
}
