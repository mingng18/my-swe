import { commitAndOpenPrTool } from "./commit-and-open-pr";
import { fetchUrlTool } from "./fetch-url";
import { mergePrTool } from "./merge-pr";
import { searchTool } from "./search";
import { sandboxTools } from "./sandbox-shell";

export const allTools = [
  commitAndOpenPrTool,
  mergePrTool,
  fetchUrlTool,
  searchTool,
];

export const sandboxAllTools = [
  ...allTools,
  ...sandboxTools,
];
