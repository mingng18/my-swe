/**
 * Deterministic Node: Linter
 *
 * Runs linter and type checker. No LLM calls - pure execution.
 *
 * This node ensures linting is ALWAYS run after code changes,
 * regardless of whether the agent remembers to do it.
 */

import { createLogger } from "../../utils/logger";

// Memory integration
import { MemoryRepository } from "../../memory/repository";
import { MemoryExtractor } from "../../memory/extractor";
import { EmbeddingService } from "../../memory/embeddings";
import type { TurnResult } from "../../memory/types";

const logger = createLogger("linter-node");

export interface LinterNodeState {
  lintPassed: boolean;
  lintExitCode: number;
  lintOutput: string;
}

/**
 * Detect lint command from repository
 */
function detectLintCommand(repoDir: string): string | null {
  const commands = [
    // TypeScript/JavaScript
    { file: "package.json", script: "lint", command: "npm run lint" },
    { file: "package.json", command: "bunx tsc --noEmit" },
    { file: "package.json", command: "bunx eslint ." },
    // Python
    { file: "pyproject.toml", command: "ruff check ." },
    { file: "pyproject.toml", command: "black --check ." },
    { file: "pyproject.toml", command: "mypy ." },
    // Rust
    { file: "Cargo.toml", command: "cargo clippy" },
    // Go
    { file: "go.mod", command: "gofmt -l ." },
  ];

  // Default to TypeScript check for TS projects
  return "bunx tsc --noEmit";
}

/**
 * Run linter in the sandbox
 */
export async function runLinter(
  sandbox: any,
  repoDir: string,
): Promise<LinterNodeState> {
  logger.info({ repoDir }, "[LinterNode] Running linter");

  const lintCommand = detectLintCommand(repoDir);

  if (!lintCommand) {
    logger.warn({ repoDir }, "[LinterNode] No lint command detected, skipping");
    return {
      lintPassed: true, // No linter = pass
      lintExitCode: 0,
      lintOutput: "No linter configured",
    };
  }

  try {
    const result = await sandbox.execute(`cd ${repoDir} && ${lintCommand}`, {
      timeout: 120000, // 2 minutes
    });

    const passed = result.exitCode === 0;

    logger.info(
      {
        lintCommand,
        exitCode: result.exitCode,
        passed,
        outputLength: result.output?.length || 0,
      },
      "[LinterNode] Linter execution completed",
    );

    return {
      lintPassed: passed,
      lintExitCode: result.exitCode,
      lintOutput: result.output || "",
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMsg }, "[LinterNode] Linter execution failed");

    return {
      lintPassed: false,
      lintExitCode: -1,
      lintOutput: errorMsg,
    };
  }
}

/**
 * Format lint results for display
 */
export function formatLintResults(state: LinterNodeState): string {
  if (state.lintPassed) {
    return "✅ Linter passed";
  }

  return `❌ Linter failed (exit code ${state.lintExitCode})\n\n${state.lintOutput}`;
}

/**
 * Memory System Integration
 *
 * Extracts and saves memories after each agent turn for future context.
 */

// Memory services singleton
let memoryRepository: MemoryRepository | null = null;
let memoryExtractor: MemoryExtractor | null = null;
let embeddingService: EmbeddingService | null = null;

/**
 * Initialize memory services (called on server startup if enabled)
 */
export function initializeMemoryServices(): void {
  const memoryEnabled = process.env.MEMORY_ENABLED === "true";

  if (!memoryEnabled) {
    return;
  }

  try {
    memoryRepository = new MemoryRepository();
    embeddingService = new EmbeddingService();
    memoryExtractor = new MemoryExtractor();

    logger.info("[Memory] Services initialized in LinterNode");
  } catch (error) {
    logger.error({ error }, "[Memory] Failed to initialize services");
    // Don't throw - allow the server to start without memory
    // Initialize services as null to prevent runtime errors
    memoryRepository = null;
    embeddingService = null;
    memoryExtractor = null;
  }
}

/**
 * Extract and save memories from an agent turn
 *
 * This function analyzes the turn results and extracts relevant information
 * to store as memories for future context.
 *
 * @param turn - The turn result containing user input, agent reply, and deterministic results
 * @param threadId - The thread ID for memory isolation
 */
export async function extractAndSaveMemories(
  turn: TurnResult,
  threadId: string,
): Promise<void> {
  // Check if memory is enabled
  const memoryEnabled = process.env.MEMORY_ENABLED === "true";
  if (
    !memoryEnabled ||
    !memoryExtractor ||
    !memoryRepository ||
    !embeddingService
  ) {
    return;
  }

  try {
    // Extract memories from the turn
    const extractedMemories = memoryExtractor.extractFromTurn(turn);

    if (extractedMemories.length === 0) {
      logger.debug("[Memory] No memories extracted from turn");
      return;
    }

    logger.info(
      { count: extractedMemories.length, threadId },
      "[Memory] Extracted memories from turn",
    );

    // Convert to Memory format and generate embeddings
    const memories = await Promise.all(
      extractedMemories.map(async (extracted) => {
        const text = `${extracted.title}. ${extracted.content}`;
        const embedding = await embeddingService!.generateEmbedding(text);

        return {
          threadId,
          type: extracted.type,
          title: extracted.title,
          content: extracted.content,
          metadata: extracted.metadata,
          embedding,
        };
      }),
    );

    // Save memories to repository
    await memoryRepository.saveBatch(memories);

    logger.info(
      { count: memories.length, threadId },
      "[Memory] Successfully saved memories",
    );
  } catch (error) {
    logger.error(
      { error, threadId },
      "[Memory] Failed to extract and save memories",
    );
    // Don't throw - memory failures shouldn't break the agent flow
  }
}

/**
 * Check if memory services are available
 */
export function isMemoryEnabled(): boolean {
  return process.env.MEMORY_ENABLED === "true" && memoryRepository !== null;
}
