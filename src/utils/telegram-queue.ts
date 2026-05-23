import { createHash } from "crypto";
import { createLogger } from "./logger";

const log = createLogger("telegram-queue");

/**
 * Generate a deterministic thread ID from a Telegram chat ID.
 * This ensures each chat has its own conversation history.
 */
export function generateThreadId(chatId: number): string {
  return createHash("sha256")
    .update(chatId.toString())
    .digest("hex")
    .substring(0, 16);
}

/**
 * Generic Telegram message queue with thread-based concurrency control.
 * Each thread processes messages sequentially, but different threads run in parallel.
 */
export class TelegramMessageQueue<T> {
  private queue = new Map<string, T[]>();
  private active = new Set<string>();
  private processor: (threadId: string, message: T) => Promise<void>;

  constructor(processor: (threadId: string, message: T) => Promise<void>) {
    this.processor = processor;
  }

  /**
   * Check if a thread is currently processing a message.
   */
  isThreadActive(threadId: string): boolean {
    return this.active.has(threadId);
  }

  /**
   * Enqueue a message and start processing if thread is idle.
   */
  enqueue(threadId: string, message: T): void {
    if (!this.queue.has(threadId)) {
      this.queue.set(threadId, []);
    }
    this.queue.get(threadId)!.push(message);

    if (!this.active.has(threadId)) {
      this.processQueue(threadId).catch((err) => {
        log.error({ err, threadId }, "[telegram-queue] Error processing queue");
      });
    }
  }

  /**
   * Process queued messages for a thread sequentially.
   */
  private async processQueue(threadId: string): Promise<void> {
    if (this.active.has(threadId)) return;
    this.active.add(threadId);

    try {
      const queue = this.queue.get(threadId);

      while (queue && queue.length > 0) {
        const item = queue.shift();
        if (!item) continue;

        try {
          await this.processor(threadId, item);
        } catch (err) {
          log.error({ err, threadId }, "[telegram-queue] Error processing message");
        }
      }
    } finally {
      this.active.delete(threadId);
    }

    // Clean up empty queue
    const remaining = this.queue.get(threadId);
    if (!remaining || remaining.length === 0) {
      this.queue.delete(threadId);
    }
  }
}
