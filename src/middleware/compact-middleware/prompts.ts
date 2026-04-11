/**
 * Prompt templates for compaction.
 *
 * Uses a 9-section structured summary prompt that preserves what agents actually need.
 *
 * Ported from: https://github.com/emanueleielo/compact-middleware
 */

import type { BaseMessage } from "@langchain/core/messages";

/**
 * 9-section structured summary prompt.
 *
 * Unlike a generic "summarize this conversation", this prompt enforces
 * 9 sections that preserve critical context for agents.
 */
export const COMPACTION_SUMMARY_PROMPT = `You are a context compaction specialist. Your task is to create a comprehensive summary of the conversation so far that preserves all critical information needed to continue the work.

## The 9 Sections You Must Include

Create a summary with EXACTLY these 9 sections (use the exact headings):

### 1. Primary Request and Intent
What the user originally asked for and what they're trying to accomplish. Include the exact goal or problem statement.

### 2. Key Technical Concepts
Frameworks, patterns, technologies, libraries, and architectural decisions discussed or used.

### 3. Files and Code Sections
Specific file paths that were read or modified, with brief descriptions of why they matter. Include function names, class names, and important code snippets.

### 4. Errors and Fixes
What broke, error messages received, and how each error was resolved. Include debugging steps taken.

### 5. Problem Solving
Debugging strategies, troubleshooting approaches, and problem-solving methodologies used.

### 6. All User Messages
Verbatim non-tool messages from the user. This catches intent drift and preserves exact user requests.

### 7. Pending Tasks
What's still open, incomplete, or needs to be done next.

### 8. Current Work
Exactly where things left off. What was the last action taken, what's the current state, and what's in progress.

### 9. Optional Next Step
What should happen next, with direct quotes from the conversation to prevent task drift. Include the specific command or action that was about to be taken.

## Guidelines

- Be thorough but concise. Each section should be 2-5 sentences unless more detail is critical.
- Include exact file paths (e.g., \`src/middleware/compact-middleware/config.ts:45\`)
- Preserve user intent by quoting key user messages verbatim
- For code snippets, show the essential parts with line number references
- If a section has no relevant information, write "None" rather than omitting it
- For the "All User Messages" section, list each message on its own line with a timestamp if available

## Output Format

\`\`\`markdown
# Session Summary

## 1. Primary Request and Intent
[Describe the user's original request and goal]

## 2. Key Technical Concepts
[List frameworks, patterns, technologies discussed]

## 3. Files and Code Sections
[List files with paths and brief descriptions]

## 4. Errors and Fixes
[Describe errors and how they were resolved]

## 5. Problem Solving
[Describe debugging strategies used]

## 6. All User Messages
[List all user messages verbatim]

## 7. Pending Tasks
[List what's still incomplete]

## 8. Current Work
[Describe exactly where things left off]

## 9. Optional Next Step
[Describe what should happen next with quotes]
\`\`\`

Now, analyze the following conversation and create a comprehensive summary following the 9-section format above.`;

/**
 * Create a summary message from compacted content.
 */
export function createSummaryMessage(summary: string): BaseMessage {
  return {
    type: "system" as const,
    content: `[Context Compaction Summary]\n\n${summary}\n\n---\n\n[Note: The conversation history has been compacted to manage context length. All critical information has been preserved in the summary above. Continue from where we left off based on the "Current Work" and "Optional Next Step" sections.]`,
  } as any;
}

/**
 * Create a restoration notice for files that were re-read.
 */
export function createRestorationNotice(
  files: Array<{ path: string; chars: number }>,
): string {
  if (files.length === 0) return "";

  const fileInfos = files
    .map((f) => `  - ${f.path} (${f.chars} chars)`)
    .join("\n");
  return `[Post-Compaction Restoration]\n\nThe following files were automatically re-read to preserve recent context:\n${fileInfos}\n`;
}

/**
 * Add custom instructions to the base prompt.
 */
export function augmentPromptWithInstructions(
  basePrompt: string,
  customInstructions: string,
): string {
  if (!customInstructions) return basePrompt;

  return `${basePrompt}

## Additional Instructions

${customInstructions}`;
}

/**
 * Create a follow-up question prompt (when not suppressed).
 */
export function createFollowUpPrompt(lastAction: string): string {
  return `\n\n[Compaction Complete]\n\nThe conversation history has been compacted. The last action taken was:\n\n> ${lastAction}\n\nPlease continue with the next appropriate step based on the "Optional Next Step" section above.`;
}

/**
 * Extract the "Optional Next Step" from a summary for resumption.
 */
export function extractNextStep(summary: string): string | undefined {
  const match = summary.match(
    /## 9\. Optional Next Step\n([\s\S]+?)(?=\n#|\n\n\[|$)/i,
  );
  if (!match) return undefined;

  const nextStep = match[1].trim();
  if (nextStep.toLowerCase() === "none") return undefined;

  return nextStep;
}

/**
 * Create a badge summary for collapsed tool results.
 */
export function createBadgeSummary(
  toolName: string,
  count: number,
  summary: string,
): string {
  return `[${count} × ${toolName}] ${summary}`;
}
