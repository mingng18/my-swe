/**
 * Centralized pino logger singleton.
 *
 * All modules should import this logger instance instead of creating their own.
 * This ensures consistent logging configuration across the application.
 */

import pino, { type Logger } from "pino";

/**
 * Default log level from environment variable or info
 */
const defaultLevel = process.env.LOG_LEVEL || "info";

/**
 * Base logger configuration
 */
const baseConfig: pino.LoggerOptions = {
  level: defaultLevel,
  // Pretty print in development
  ...(process.env.NODE_ENV !== "production" && {
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss Z",
        ignore: "pid,hostname",
        singleLine: false,
      },
    },
  }),
};

/**
 * Global pino logger instance
 */
export const logger: Logger = pino(baseConfig);

/**
 * Create a child logger with a custom name/context.
 *
 * @param name - Logger name (e.g., "deepagents", "opensandbox")
 * @returns Child logger instance
 *
 * @example
 * ```ts
 * import { createLogger } from "./utils/logger";
 * const logger = createLogger("my-module");
 * logger.info("Hello from my module");
 * ```
 */
export function createLogger(name: string): Logger {
  return logger.child({ name });
}

/**
 * Default export for convenience
 */
export default logger;
