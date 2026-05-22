// Configuration from environment
export const RTK_COMPRESSION_ENABLED =
  process.env.RTK_COMPRESSION_ENABLED !== "false";

export const RTK_MAX_OUTPUT_TOKENS = Number.parseInt(
  process.env.RTK_MAX_OUTPUT_TOKENS || "2000",
  10,
);

export const RTK_MIN_COMPRESSION_RATIO = Number.parseFloat(
  process.env.RTK_MIN_COMPRESSION_RATIO || "0.5",
);

export const RTK_FAILURE_FOCUS_THRESHOLD = Number.parseInt(
  process.env.RTK_FAILURE_FOCUS_THRESHOLD || "10",
  10,
);

export const RTK_DEDUP_THRESHOLD = Number.parseInt(
  process.env.RTK_DEDUP_THRESHOLD || "3",
  10,
);

export const RTK_TRUNCATE_HEAD_TOKENS = Number.parseInt(
  process.env.RTK_TRUNCATE_HEAD_TOKENS || "500",
  10,
);

export const RTK_TRUNCATE_TAIL_TOKENS = Number.parseInt(
  process.env.RTK_TRUNCATE_TAIL_TOKENS || "500",
  10,
);

// Tools that should never be compressed (user-facing actions)
export const RTK_SKIP_TOOLS = new Set([
  "github_comment",
  "merge_pr",
  "commit_and_open_pr",
  "sandbox_pause",
  "sandbox_resume",
  "sandbox_network",
]);

// Tools that should always use compression
export const RTK_COMPRESS_TOOLS = new Set([
  "sandbox_shell",
  "code_search",
  "semantic_search",
  "internet_search",
  "fetch_url",
]);
