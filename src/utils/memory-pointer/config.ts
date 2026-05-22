// Configuration from environment
export const MEMORY_POINTER_TTL_HOURS = Number.parseInt(
  process.env.MEMORY_POINTER_TTL_HOURS || "24",
  10,
);

export const MEMORY_POINTER_DIR = process.env.MEMORY_POINTER_DIR || ".memory-pointers";

export const MAX_POINTER_SIZE_TOKENS = Number.parseInt(
  process.env.MAX_POINTER_SIZE_TOKENS || "5000",
  10,
);
