/**
 * Sandbox resource limits configuration.
 *
 * Defines default and maximum resource limits for sandbox operations
 * to prevent resource exhaustion and runaway processes.
 */

import { createLogger } from "./logger";

const logger = createLogger("resource-limits");

/**
 * Default resource limits for sandbox operations.
 */
export const DEFAULT_RESOURCE_LIMITS = {
  // Operation timeouts (in milliseconds)
  OPERATION_TIMEOUT_MS: 60_000, // 1 minute default
  LONG_OPERATION_TIMEOUT_MS: 300_000, // 5 minutes for dep/tests
  EXTENDED_OPERATION_TIMEOUT_MS: 600_000, // 10 minutes max

  // CPU limits (cores or percentage)
  DEFAULT_CPU: 2, // 2 CPU cores
  MAX_CPU: 8, // Maximum CPU cores

  // Memory limits (in MB)
  DEFAULT_MEMORY_MB: 4096, // 4GB
  MAX_MEMORY_MB: 16384, // 16GB maximum

  // Disk limits (in MB)
  DEFAULT_DISK_MB: 10240, // 10GB
  MAX_DISK_MB: 51200, // 50GB maximum

  // Process limits
  MAX_PROCESSES: 100,
  MAX_OPEN_FILES: 1024,

  // Network limits
  NETWORK_TIMEOUT_MS: 30_000, // 30 seconds
  MAX_REDIRECTS: 10,
  MAX_URL_LENGTH: 2000,

  // Content size limits
  MAX_HTTP_CONTENT_LENGTH: 10 * 1024 * 1024, // 10MB
  MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB
  MAX_OUTPUT_LENGTH: 1_000_000, // 1M chars

  // Rate limiting
  MAX_CONCURRENT_OPERATIONS: 5,
  RETRY_DELAY_MS: 1000,
  MAX_RETRIES: 3,
} as const;

/**
 * Sandbox resource profile presets.
 */
export type SandboxProfile =
  | "micro"
  | "small"
  | "medium"
  | "large"
  | "xlarge";

/**
 * Resource profile configurations.
 */
export const SANDBOX_PROFILES: Record<
  SandboxProfile,
  {
    cpu: number;
    memory: number; // MB
    disk: number; // MB
    timeout: number; // seconds
    description: string;
  }
> = {
  micro: {
    cpu: 1,
    memory: 1024, // 1GB
    disk: 2048, // 2GB
    timeout: 300, // 5 minutes
    description: "Minimal resources for quick tasks",
  },
  small: {
    cpu: 2,
    memory: 2048, // 2GB
    disk: 5120, // 5GB
    timeout: 600, // 10 minutes
    description: "Light development tasks",
  },
  medium: {
    cpu: 4,
    memory: 4096, // 4GB
    disk: 10240, // 10GB
    timeout: 1800, // 30 minutes
    description: "Standard development environment",
  },
  large: {
    cpu: 6,
    memory: 8192, // 8GB
    disk: 20480, // 20GB
    timeout: 3600, // 1 hour
    description: "Heavy development and testing",
  },
  xlarge: {
    cpu: 8,
    memory: 16384, // 16GB
    disk: 51200, // 50GB
    timeout: 7200, // 2 hours
    description: "Maximum resources for intensive workloads",
  },
};

/**
 * Validate resource limits against maximum allowed values.
 */
export function validateResourceLimits(config: {
  cpu?: number;
  memory?: number;
  disk?: number;
  timeout?: number;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (config.cpu !== undefined) {
    if (config.cpu < 0.5 || config.cpu > DEFAULT_RESOURCE_LIMITS.MAX_CPU) {
      errors.push(
        `CPU must be between 0.5 and ${DEFAULT_RESOURCE_LIMITS.MAX_CPU} cores, got ${config.cpu}`
      );
    }
  }

  if (config.memory !== undefined) {
    if (config.memory < 512 || config.memory > DEFAULT_RESOURCE_LIMITS.MAX_MEMORY_MB) {
      errors.push(
        `Memory must be between 512MB and ${DEFAULT_RESOURCE_LIMITS.MAX_MEMORY_MB}MB, got ${config.memory}MB`
      );
    }
  }

  if (config.disk !== undefined) {
    if (config.disk < 1024 || config.disk > DEFAULT_RESOURCE_LIMITS.MAX_DISK_MB) {
      errors.push(
        `Disk must be between 1GB and ${DEFAULT_RESOURCE_LIMITS.MAX_DISK_MB}MB, got ${config.disk}MB`
      );
    }
  }

  if (config.timeout !== undefined) {
    if (config.timeout < 60 || config.timeout > 7200) {
      errors.push(
        `Timeout must be between 1 minute and 2 hours, got ${config.timeout} seconds`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get resource limits for a given profile.
 */
export function getProfileLimits(
  profile: SandboxProfile
): (typeof SANDBOX_PROFILES)[SandboxProfile] {
  return SANDBOX_PROFILES[profile];
}

/**
 * Get resource limits from environment variables with fallback to profile.
 */
export function getResourceLimitsFromEnv(profile: SandboxProfile = "medium"): {
  cpu: number;
  memory: number;
  disk: number;
  timeout: number;
} {
  const profileLimits = getProfileLimits(profile);

  const cpu =
    (process.env.SANDBOX_CPU
      ? parseFloat(process.env.SANDBOX_CPU)
      : undefined) ?? profileLimits.cpu;

  const memory =
    (process.env.SANDBOX_MEMORY
      ? parseInt(process.env.SANDBOX_MEMORY, 10)
      : undefined) ?? profileLimits.memory;

  const disk =
    (process.env.SANDBOX_DISK
      ? parseInt(process.env.SANDBOX_DISK, 10)
      : undefined) ?? profileLimits.disk;

  const timeout =
    (process.env.SANDBOX_TIMEOUT
      ? parseInt(process.env.SANDBOX_TIMEOUT, 10)
      : undefined) ?? profileLimits.timeout;

  // Validate and log warnings
  const validation = validateResourceLimits({ cpu, memory, disk, timeout });
  if (!validation.valid) {
    logger.warn(
      { errors: validation.errors },
      "[resource-limits] Invalid resource limits detected, using defaults"
    );
    return profileLimits;
  }

  return { cpu, memory, disk, timeout };
}

/**
 * Calculate timeout based on operation type.
 */
export function getTimeoutForOperation(operation: "command" | "install" | "test" | "clone"): number {
  switch (operation) {
    case "command":
      return DEFAULT_RESOURCE_LIMITS.OPERATION_TIMEOUT_MS;
    case "install":
      return DEFAULT_RESOURCE_LIMITS.LONG_OPERATION_TIMEOUT_MS;
    case "test":
      return DEFAULT_RESOURCE_LIMITS.LONG_OPERATION_TIMEOUT_MS;
    case "clone":
      return DEFAULT_RESOURCE_LIMITS.LONG_OPERATION_TIMEOUT_MS;
    default:
      return DEFAULT_RESOURCE_LIMITS.OPERATION_TIMEOUT_MS;
  }
}

/**
 * Check if a resource request exceeds the maximum allowed.
 */
export function exceedsMaxLimits(config: {
  cpu?: number;
  memory?: number;
  disk?: number;
}): boolean {
  const validation = validateResourceLimits(config);
  return !validation.valid;
}

/**
 * Clamp resource values to allowed ranges.
 */
export function clampResourceLimits(config: {
  cpu?: number;
  memory?: number;
  disk?: number;
}): { cpu?: number; memory?: number; disk?: number } {
  const result: { cpu?: number; memory?: number; disk?: number } = {};

  if (config.cpu !== undefined) {
    result.cpu = Math.max(
      0.5,
      Math.min(config.cpu, DEFAULT_RESOURCE_LIMITS.MAX_CPU)
    );
  }

  if (config.memory !== undefined) {
    result.memory = Math.max(
      512,
      Math.min(config.memory, DEFAULT_RESOURCE_LIMITS.MAX_MEMORY_MB)
    );
  }

  if (config.disk !== undefined) {
    result.disk = Math.max(
      1024,
      Math.min(config.disk, DEFAULT_RESOURCE_LIMITS.MAX_DISK_MB)
    );
  }

  return result;
}
