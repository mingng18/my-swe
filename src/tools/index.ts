import { commitAndOpenPrTool } from "./commit-and-open-pr";
import { codeSearchTool } from "./code-search";
import { fetchUrlTool } from "./fetch-url";
import { mergePrTool } from "./merge-pr";
import { searchTool } from "./search";
import { githubCommentTool } from "./github-comment";
import { sandboxTools } from "./sandbox-shell";
import {
  artifactQueryTool,
  artifactListTool,
  artifactDeleteTool,
} from "./artifact-query";
import { semanticSearchTool } from "./semantic-search";
import { activateSkillTool } from "./activate-skill";
import { toolSearchTool } from "./tool-search";
import { listMcpResourcesTool } from "./list-mcp-resources";
import { readMcpResourceTool } from "./read-mcp-resource";

// Compression wrapper (optional, controlled by RTK_COMPRESSION_ENABLED)
import { wrapToolsWithCompression } from "./compression-wrapper";

// Raw tools (uncompressed, for backward compatibility)
export const allToolsUncompressed = [
  commitAndOpenPrTool,
  codeSearchTool,
  mergePrTool,
  fetchUrlTool,
  searchTool,
  githubCommentTool,
  artifactQueryTool,
  artifactListTool,
  artifactDeleteTool,
  semanticSearchTool,
  activateSkillTool,
  toolSearchTool,
  listMcpResourcesTool,
  readMcpResourceTool,
];

export const sandboxAllToolsUncompressed = [
  ...allToolsUncompressed,
  ...sandboxTools,
];

// Compressed tools (default, controlled by environment variable)
const RTK_COMPRESSION_ENABLED = process.env.RTK_COMPRESSION_ENABLED !== "false";

export const allTools = RTK_COMPRESSION_ENABLED
  ? wrapToolsWithCompression(allToolsUncompressed)
  : allToolsUncompressed;

export const sandboxAllTools = RTK_COMPRESSION_ENABLED
  ? [...allTools, ...wrapToolsWithCompression(sandboxTools)]
  : sandboxAllToolsUncompressed;
