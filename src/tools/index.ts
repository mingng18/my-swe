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

export const allTools = [
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
];

export const sandboxAllTools = [...allTools, ...sandboxTools];
