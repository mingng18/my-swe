/**
 * Checkpoint Rewind — restore a prior thread state via the LangGraph checkpointer.
 *
 * The agent tool (`rewind_checkpoint`) and the HTTP route (`POST /rewind/:threadId/:checkpointId`)
 * both delegate to `restoreCheckpoint`, which walks the thread's `getStateHistory`
 * (provided by the existing MemorySaver checkpointer wired in `src/harness/deepagents.ts`)
 * to locate the requested checkpoint and rewrites the thread head to that snapshot
 * using `updateState`.
 *
 * Invalid checkpoint IDs surface as `CheckpointNotFoundError` from the tool and a
 * 404 from the route.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createLogger } from "../utils/logger";

const logger = createLogger("checkpoint-rewind");

/**
 * Typed error raised when a checkpoint cannot be found for a thread.
 *
 * The route maps this to HTTP 404; the tool surfaces the message to the agent.
 */
export class CheckpointNotFoundError extends Error {
  readonly checkpointId: string;
  readonly threadId: string;

  constructor(threadId: string, checkpointId: string) {
    super(
      `Checkpoint '${checkpointId}' not found for thread '${threadId}'.`,
    );
    this.name = "CheckpointNotFoundError";
    this.threadId = threadId;
    this.checkpointId = checkpointId;
  }
}

/**
 * Subset of the LangGraph/Pregel agent surface that restoreCheckpoint depends on.
 *
 * Narrowing the interface keeps the function decoupled from the concrete
 * `DeepAgent` type (whose state methods are marked `@internal` in the type
 * definitions) and makes it trivially mockable in tests.
 */
export interface CheckpointedAgent {
  getStateHistory(
    config: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): AsyncIterableIterator<StateHistoryEntry>;
  updateState(
    config: Record<string, unknown>,
    values: Record<string, unknown> | unknown,
    asNode?: string,
  ): Promise<Record<string, unknown>>;
}

/**
 * Minimal view of a {@link StateSnapshot} returned by `getStateHistory`.
 *
 * Only the fields restoreCheckpoint reads are listed here.
 */
export interface StateHistoryEntry {
  /** Channel values at this checkpoint (e.g. `{ messages, ... }`). */
  readonly values: Record<string, unknown> | unknown;
  /** Nodes scheduled to run after this checkpoint, if any. */
  readonly next?: readonly string[];
  /** Config used to fetch this snapshot; carries `configurable.checkpoint_id`. */
  readonly config: Record<string, unknown>;
  /** Optional metadata (step, source, writes, ...). */
  readonly metadata?: Record<string, unknown>;
  /** Config of the parent checkpoint (time-travel breadcrumb). */
  readonly parentConfig?: Record<string, unknown>;
}

/** Extract the `checkpoint_id` stored under a snapshot's `config.configurable`. */
function getCheckpointId(snapshot: StateHistoryEntry): string | undefined {
  const configurable = snapshot.config?.configurable as
    | Record<string, unknown>
    | undefined;
  return configurable?.checkpoint_id as string | undefined;
}

/**
 * Locate a checkpoint in a thread's history by id.
 *
 * Iterates the (possibly large) state history in newest-first order and returns
 * the first snapshot whose `configurable.checkpoint_id` matches.
 *
 * @returns The matching snapshot, or `undefined` if none was found.
 */
export async function findCheckpoint(
  agent: CheckpointedAgent,
  threadId: string,
  checkpointId: string,
  options?: { limit?: number },
): Promise<StateHistoryEntry | undefined> {
  const config = { configurable: { thread_id: threadId } };
  const historyConfig = options?.limit
    ? { limit: options.limit }
    : undefined;

  for await (const snapshot of agent.getStateHistory(config, historyConfig)) {
    if (getCheckpointId(snapshot) === checkpointId) {
      return snapshot;
    }
  }
  return undefined;
}

/**
 * Restore a thread to a prior checkpoint by id.
 *
 * Walks `getStateHistory` for the thread, locates the target checkpoint, and
 * rewrites the thread head to that snapshot's values by calling `updateState`
 * with the target checkpoint's config. The next `invoke()` / `stream()` on the
 * thread resumes from the restored state — this is the standard LangGraph
 * time-travel pattern over an existing checkpointer.
 *
 * @returns The restored snapshot (values, next, config, metadata).
 * @throws {CheckpointNotFoundError} if no checkpoint matches the id.
 */
export async function restoreCheckpoint(
  agent: CheckpointedAgent,
  threadId: string,
  checkpointId: string,
): Promise<StateHistoryEntry> {
  const snapshot = await findCheckpoint(agent, threadId, checkpointId);

  if (!snapshot) {
    throw new CheckpointNotFoundError(threadId, checkpointId);
  }

  // Rewrite the thread head with the target snapshot's values. Passing the
  // target checkpoint's config pins the update to the correct base checkpoint.
  await agent.updateState(snapshot.config, snapshot.values);

  logger.info(
    { threadId, checkpointId, next: snapshot.next },
    "[checkpoint-rewind] thread restored to checkpoint",
  );

  return snapshot;
}

/**
 * Agent tool that restores the current thread to a prior checkpoint.
 *
 * The agent obtains a checkpoint id (e.g. via a future `list_checkpoints` tool
 * or external observability) and rewinds the conversation to that point. The
 * next model turn continues from the restored state.
 */
export const checkpointRewindTool = tool(
  async ({ checkpointId }, config) => {
    const threadId = config?.configurable?.thread_id as string | undefined;

    if (!threadId) {
      return JSON.stringify({
        success: false,
        error:
          "No thread_id in tool config. Checkpoint rewind requires an active thread.",
      });
    }

    // Lazily import to avoid a hard module-cycle between tools and the harness.
    const { threadManager } = await import("../harness/thread-manager");
    const agent = threadManager.getAgent(threadId);

    if (!agent) {
      return JSON.stringify({
        success: false,
        error: `No active agent for thread '${threadId}'.`,
      });
    }

    try {
      const restored = await restoreCheckpoint(
        agent as unknown as CheckpointedAgent,
        threadId,
        checkpointId,
      );

      const restoredValues = restored.values as Record<string, unknown> | undefined;
      const messageCount = Array.isArray(restoredValues?.messages)
        ? restoredValues!.messages.length
        : undefined;

      return JSON.stringify({
        success: true,
        threadId,
        checkpointId,
        restoredAt: new Date().toISOString(),
        next: restored.next ?? [],
        messageCount,
        note: "Thread state restored. The next turn resumes from this checkpoint.",
      });
    } catch (error) {
      const isNotFound = error instanceof CheckpointNotFoundError;
      const message =
        error instanceof Error ? error.message : String(error);

      logger.warn(
        { threadId, checkpointId, message, isNotFound },
        "[checkpoint-rewind] restore failed",
      );

      return JSON.stringify({
        success: false,
        error: message,
        notFound: isNotFound,
        threadId,
        checkpointId,
      });
    }
  },
  {
    name: "rewind_checkpoint",
    description:
      "Rewind the current conversation thread to a prior checkpoint by id. " +
      "The thread state (messages, files, todos) is restored from the LangGraph " +
      "checkpointer; subsequent turns continue from the restored state. Use a " +
      "checkpoint id previously observed for this thread.",
    schema: z.object({
      checkpointId: z
        .string()
        .min(1)
        .describe(
          "Checkpoint id to restore. Must belong to the current thread.",
        ),
    }),
  },
);
