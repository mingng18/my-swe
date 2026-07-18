/**
 * Graceful shutdown handler for production deployments.
 * Ensures proper cleanup of resources before process exit.
 */

import { createLogger } from "./logger";

const logger = createLogger("shutdown");

/**
 * Shutdown state.
 */
interface ShutdownState {
  isShuttingDown: boolean;
  shutdownTimeout: number;
  handlers: Array<() => Promise<void>>;
}

const state: ShutdownState = {
  isShuttingDown: false,
  shutdownTimeout: 30000, // 30 seconds default
  handlers: [],
};

/**
 * Register a cleanup handler to be called on shutdown.
 *
 * @param handler - Async cleanup function
 * @returns Function to unregister the handler
 */
export function registerShutdownHandler(
  handler: () => Promise<void>,
): () => void {
  state.handlers.push(handler);

  // Return unregister function
  return () => {
    const index = state.handlers.indexOf(handler);
    if (index > -1) {
      state.handlers.splice(index, 1);
    }
  };
}

/**
 * Set the shutdown timeout.
 *
 * @param timeoutMs - Timeout in milliseconds
 */
export function setShutdownTimeout(timeoutMs: number): void {
  state.shutdownTimeout = timeoutMs;
}

/**
 * Initiate graceful shutdown.
 */
async function initiateShutdown(signal: string): Promise<void> {
  if (state.isShuttingDown) {
    logger.warn(`[shutdown] Already shutting down, ignoring ${signal}`);
    return;
  }

  state.isShuttingDown = true;

  logger.info(
    { signal, timeout: state.shutdownTimeout, handlersCount: state.handlers.length },
    "[shutdown] Starting graceful shutdown",
  );

  // Set a hard timeout to force exit if cleanup takes too long
  const timeout = setTimeout(() => {
    logger.error(`[shutdown] Shutdown timeout (${state.shutdownTimeout}ms) exceeded, forcing exit`);
    process.exit(1);
  }, state.shutdownTimeout);

  try {
    // Call all cleanup handlers in parallel
    const results = await Promise.allSettled(
      state.handlers.map(async (handler, index) => {
        try {
          logger.debug(
            { handlerIndex: index, handlerName: handler.name || "anonymous" },
            "[shutdown] Running cleanup handler",
          );
          await handler();
          logger.debug(
            { handlerIndex: index },
            "[shutdown] Cleanup handler completed",
          );
        } catch (err) {
          logger.error(
            { handlerIndex: index, error: err },
            "[shutdown] Cleanup handler failed",
          );
        }
      }),
    );

    // ⚡ Bolt: Replaced multiple .filter().length passes with a single O(N) loop
    let successful = 0;
    let failed = 0;
    for (const r of results) {
      if (r.status === "fulfilled") successful++;
      else if (r.status === "rejected") failed++;
    }

    logger.info(
      { successful, failed, total: state.handlers.length },
      "[shutdown] Cleanup completed",
    );

    // Clear the timeout since we completed successfully
    clearTimeout(timeout);

    logger.info("[shutdown] Graceful shutdown complete, exiting");
    process.exit(0);
  } catch (err) {
    logger.error({ error: err }, "[shutdown] Unexpected error during shutdown");
    clearTimeout(timeout);
    process.exit(1);
  }
}

/**
 * Setup signal handlers for graceful shutdown.
 */
export function setupGracefulShutdown(): void {
  const signals = ["SIGTERM", "SIGINT", "SIGUSR2"];

  signals.forEach((signal) => {
    process.on(signal as NodeJS.Signals, () => {
      logger.info({ signal }, `[shutdown] Received ${signal} signal`);
      initiateShutdown(signal).catch((err) => {
        logger.error({ error: err }, "[shutdown] Failed to initiate shutdown");
        process.exit(1);
      });
    });
  });

  logger.info(
    { signals, shutdownTimeout: state.shutdownTimeout },
    "[shutdown] Graceful shutdown handlers registered",
  );
}

/**
 * Check if the process is shutting down.
 */
export function isShuttingDown(): boolean {
  return state.isShuttingDown;
}

/**
 * Health check endpoint that considers shutdown state.
 */
export function createHealthCheck(isReady: () => Promise<boolean>) {
  return async () => {
    if (state.isShuttingDown) {
      return {
        status: "shutting_down",
        message: "Server is shutting down",
      };
    }

    const ready = await isReady();

    return {
      status: ready ? "healthy" : "unhealthy",
      ready,
      shuttingDown: state.isShuttingDown,
    };
  };
}
