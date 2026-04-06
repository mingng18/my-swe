import { commitAndOpenPrTool } from "./commit-and-open-pr";
import { codeSearchTool } from "./code-search";
import { fetchUrlTool } from "./fetch-url";
import { mergePrTool } from "./merge-pr";
import { searchTool } from "./search";
import { githubCommentTool } from "./github-comment";
import { sandboxTools } from "./sandbox-shell";

export const allTools = [
  commitAndOpenPrTool,
  codeSearchTool,
  mergePrTool,
  fetchUrlTool,
  searchTool,
  githubCommentTool,
];

export const sandboxAllTools = [
  ...allTools,
  ...sandboxTools,
];
