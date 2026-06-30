/**
 * Centralized input sanitization utilities.
 * Provides safe validation and sanitization for user inputs.
 */

import { createLogger } from "./logger";

const logger = createLogger("sanitize");

/**
 * Configuration for input sanitization.
 */
interface SanitizeOptions {
  maxLength?: number;
  allowedChars?: RegExp;
  stripControl?: boolean;
  normalizeUnicode?: boolean;
  context?: string;
}

/**
 * Result of sanitization.
 */
interface SanitizeResult {
  value: string;
  wasSanitized: boolean;
  originalLength: number;
  sanitizedLength: number;
}

/**
 * Default limits for different input contexts.
 */
const DEFAULT_LIMITS = {
  MAX_INPUT_SIZE: 100000, // 100KB
  MAX_THREAD_ID_SIZE: 256,
  MAX_USER_ID_SIZE: 256,
  MAX_REPO_NAME_SIZE: 100,
  MAX_BRANCH_NAME_SIZE: 300,
  MAX_COMMIT_MESSAGE_SIZE: 1024, // 1KB
  MAX_URL_SIZE: 2048,
  MAX_TOKEN_SIZE: 2048,
} as const;

/**
 * Control characters that should be stripped.
 */
const CONTROL_CHARS = /[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/;

/**
 * Dangerous patterns that could indicate injection attacks.
 */
const DANGEROUS_PATTERNS: RegExp[] = [
  /\$\{.*?\}/, // Template injection ${}
  /\${/, // Template literal start
  /\{\{.*?\}\}/, // Double curly brace template {{}}
  /<script[^>]*>/i, // Script tags
  /javascript:/i, // JavaScript protocol
  /on\w+\s*=/i, // Event handlers (onclick=, etc.)
  /<iframe[^>]*>/i, // Iframes
  /<embed[^>]*>/i, // Embed tags
  /<object[^>]*>/i, // Object tags
  /<link[^>]*>/i, // Link tags (for stylesheet injection)
  /<meta[^>]*>/i, // Meta tags (for various injections)
  /@import/i, // CSS import
  /expression\s*\(/i, // CSS expression (old IE)
];

/**
 * Sanitize a string input based on context.
 *
 * @param input - The raw input to sanitize
 * @param options - Sanitization options
 * @returns Sanitized result
 * @throws Error if input is invalid or exceeds limits
 */
export function sanitizeString(
  input: unknown,
  options: SanitizeOptions = {},
): SanitizeResult {
  const {
    maxLength = DEFAULT_LIMITS.MAX_INPUT_SIZE,
    allowedChars,
    stripControl = true,
    normalizeUnicode = true,
    context = "input",
  } = options;

  // Validate input type
  if (typeof input !== "string") {
    throw new Error(
      `[${context}] Invalid input type: expected string, got ${typeof input}`,
    );
  }

  const original = input;
  let value = input;

  // Check length first
  if (value.length > maxLength) {
    throw new Error(
      `[${context}] Input too large: ${value.length} characters (max: ${maxLength})`,
    );
  }

  // Check for control characters BEFORE stripping (for security)
  if (stripControl && CONTROL_CHARS.test(value)) {
    logger.warn(
      { context, hasControlChars: true },
      "[sanitize] Input contains control characters",
    );
    throw new Error(
      `[${context}] Input contains null byte or control characters`,
    );
  }

  // Check for dangerous patterns BEFORE normalization
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(value)) {
      logger.warn(
        { context, pattern: pattern.source },
        "[sanitize] Detected potentially dangerous pattern",
      );
      throw new Error(
        `[${context}] Input contains potentially dangerous pattern: ${pattern.source}`,
      );
    }
  }

  // Normalize Unicode
  if (normalizeUnicode) {
    value = value.normalize("NFC");
  }

  // Apply character whitelist if provided
  if (allowedChars) {
    if (!allowedChars.test(value)) {
      throw new Error(
        `[${context}] Input contains characters not matching allowed pattern`,
      );
    }
  }

  // Trim whitespace
  value = value.trim();

  const wasSanitized = value !== original;
  const originalLength = original.length;
  const sanitizedLength = value.length;

  if (wasSanitized) {
    logger.debug(
      { context, originalLength, sanitizedLength },
      "[sanitize] Input was sanitized",
    );
  }

  return { value, wasSanitized, originalLength, sanitizedLength };
}

/**
 * Sanitize user prompt input.
 */
export function sanitizeUserPrompt(input: unknown): string {
  const result = sanitizeString(input, {
    maxLength: DEFAULT_LIMITS.MAX_INPUT_SIZE,
    stripControl: true,
    normalizeUnicode: true,
    context: "userPrompt",
  });

  if (!result.value) {
    throw new Error("User prompt cannot be empty");
  }

  return result.value;
}

/**
 * Sanitize thread ID.
 */
export function sanitizeThreadId(input: unknown): string {
  const result = sanitizeString(input, {
    maxLength: DEFAULT_LIMITS.MAX_THREAD_ID_SIZE,
    stripControl: true,
    normalizeUnicode: true,
    allowedChars: /^[a-zA-Z0-9_-]+$/,
    context: "threadId",
  });

  return result.value;
}

/**
 * Sanitize user ID.
 */
export function sanitizeUserId(input: unknown): string {
  const result = sanitizeString(input, {
    maxLength: DEFAULT_LIMITS.MAX_USER_ID_SIZE,
    stripControl: true,
    normalizeUnicode: true,
    context: "userId",
  });

  return result.value;
}

/**
 * Sanitize branch name.
 */
export function sanitizeBranchName(input: unknown): string {
  const result = sanitizeString(input, {
    maxLength: DEFAULT_LIMITS.MAX_BRANCH_NAME_SIZE,
    stripControl: true,
    normalizeUnicode: true,
    allowedChars: /^[a-zA-Z0-9/_-]+$/,
    context: "branchName",
  });

  return result.value;
}

/**
 * Sanitize commit message.
 */
export function sanitizeCommitMessage(input: unknown): string {
  const result = sanitizeString(input, {
    maxLength: DEFAULT_LIMITS.MAX_COMMIT_MESSAGE_SIZE,
    stripControl: false, // Allow newlines in commit messages
    normalizeUnicode: true,
    context: "commitMessage",
  });

  if (!result.value) {
    throw new Error("Commit message cannot be empty");
  }

  return result.value;
}

/**
 * Sanitize URL.
 */
export function sanitizeUrl(input: unknown): string {
  const result = sanitizeString(input, {
    maxLength: DEFAULT_LIMITS.MAX_URL_SIZE,
    stripControl: true,
    normalizeUnicode: true,
    context: "url",
  });

  try {
    // Validate URL format
    const url = new URL(result.value);

    // Only allow http/https protocols
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error(`URL protocol not allowed: ${url.protocol}`);
    }

    return url.toString();
  } catch (err) {
    throw new Error(
      `Invalid URL: ${err instanceof Error ? err.message : "unknown error"}`,
    );
  }
}

/**
 * Sanitize API token.
 */
export function sanitizeApiToken(input: unknown): string {
  const result = sanitizeString(input, {
    maxLength: DEFAULT_LIMITS.MAX_TOKEN_SIZE,
    stripControl: true,
    normalizeUnicode: false, // Don't normalize tokens
    context: "apiToken",
  });

  if (!result.value) {
    throw new Error("API token cannot be empty");
  }

  return result.value;
}

/**
 * Safe JSON parser with validation.
 */
export function parseJsonSafely<T = unknown>(
  input: string,
  options: {
    maxSize?: number;
    maxDepth?: number;
    schema?: { parse: (data: unknown) => T };
    blockProto?: boolean;
  } = {},
): T {
  const {
    maxSize = DEFAULT_LIMITS.MAX_INPUT_SIZE,
    maxDepth = 100,
    schema,
    blockProto = true,
  } = options;

  // Check size
  if (input.length > maxSize) {
    throw new Error(`JSON input exceeds maximum size of ${maxSize} bytes`);
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(input);
  } catch (err) {
    throw new Error(
      `Invalid JSON: ${err instanceof Error ? err.message : "unknown error"}`,
    );
  }

  // Check depth and block prototype pollution
  const checkDepthAndProto = (obj: unknown, currentDepth = 0): void => {
    if (currentDepth > maxDepth) {
      throw new Error(`JSON depth exceeds maximum of ${maxDepth}`);
    }

    if (typeof obj === "object" && obj !== null) {
      if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
          checkDepthAndProto(obj[i], currentDepth + 1);
        }
      } else {
        for (const key in obj as Record<string, unknown>) {
          // hasOwnProperty is omitted because JSON.parse output is guaranteed to be a plain object
          if (blockProto && (key === "__proto__" || key === "constructor")) {
            throw new Error("Prototype pollution detected in JSON input");
          }
          checkDepthAndProto(
            (obj as Record<string, unknown>)[key],
            currentDepth + 1,
          );
        }
      }
    }
  };

  checkDepthAndProto(parsed);

  // Validate schema
  if (schema) {
    return schema.parse(parsed) as T;
  }

  return parsed as T;
}
