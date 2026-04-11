import type { ExtractedMemory, TurnResult } from "./types";

/**
 * Extracts memories from agent turns using pattern matching
 */
export class MemoryExtractor {
  /**
   * Extract memories from a turn result
   */
  extractFromTurn(turn: TurnResult): ExtractedMemory[] {
    const memories: ExtractedMemory[] = [];

    // Extract from user text
    if (turn.userText) {
      memories.push(...this.extractFromUserText(turn.userText));
    }

    // Extract from agent reply
    if (turn.agentReply) {
      memories.push(...this.extractFromAgentReply(turn.agentReply));
    }

    // Extract from deterministic results
    if (turn.deterministic) {
      memories.push(...this.extractFromDeterministic(turn.deterministic));
    }

    // Deduplicate memories
    return this.deduplicate(memories);
  }

  /**
   * Extract memories from user text
   */
  private extractFromUserText(text: string): ExtractedMemory[] {
    const memories: ExtractedMemory[] = [];

    // User preferences
    const preferencePatterns = [
      /I prefer (.+)/i,
      /I like (.+)/i,
      /I'd rather (.+)/i,
      /I usually (.+)/i,
      /I typically (.+)/i,
    ];

    for (const pattern of preferencePatterns) {
      const match = text.match(pattern);
      if (match) {
        memories.push({
          type: "user",
          title: this.generateTitle(text, "preference"),
          content: text.trim(),
          metadata: { pattern: "preference" },
        });
        break;
      }
    }

    // User expertise/role
    const expertisePatterns = [
      /I am a (.+)/i,
      /I'm a (.+)/i,
      /I am an? (.+)/i,
      /I'm an? (.+)/i,
      /I work as a (.+)/i,
    ];

    for (const pattern of expertisePatterns) {
      const match = text.match(pattern);
      if (match) {
        memories.push({
          type: "user",
          title: this.generateTitle(text, "expertise"),
          content: text.trim(),
          metadata: { pattern: "expertise" },
        });
        break;
      }
    }

    // Negative feedback
    const negativePatterns = [
      /\bno\b/i,
      /\bdon't\b/i,
      /\bdoesn't\b/i,
      /\bwrong\b/i,
      /\bincorrect\b/i,
      /\bnot what\b/i,
      /\bnot that\b/i,
    ];

    for (const pattern of negativePatterns) {
      if (pattern.test(text)) {
        memories.push({
          type: "feedback",
          title: this.generateTitle(text, "correction"),
          content: text.trim(),
          metadata: { sentiment: "negative" },
        });
        break;
      }
    }

    // Positive feedback
    const positivePatterns = [
      /\byes\b/i,
      /\bcorrect\b/i,
      /\bperfect\b/i,
      /\bgreat\b/i,
      /\bexcellent\b/i,
      /\bright\b/i,
      /\bexactly\b/i,
    ];

    for (const pattern of positivePatterns) {
      if (pattern.test(text)) {
        memories.push({
          type: "feedback",
          title: this.generateTitle(text, "validation"),
          content: text.trim(),
          metadata: { sentiment: "positive" },
        });
        break;
      }
    }

    // External system references (prioritize specific system names first)
    const externalSystems = [
      { name: "GitHub", patterns: [/\bgithub\b/i] },
      { name: "Linear", patterns: [/\blinear\b/i] },
      { name: "Jira", patterns: [/\bjira\b/i] },
      { name: "Slack", patterns: [/\bslack\b/i] },
      { name: "Notion", patterns: [/\bnotion\b/i] },
      { name: "Confluence", patterns: [/\bconfluence\b/i] },
    ];

    // Generic patterns (only match if no specific system found)
    const genericPatterns = [
      { name: "GitHub", pattern: /\brepo\b/i },
      { name: "Linear", pattern: /\bticket\b/i },
      { name: "Slack", pattern: /\bchannel\b/i },
    ];

    // Try specific system names first
    let found = false;
    for (const system of externalSystems) {
      for (const pattern of system.patterns) {
        if (pattern.test(text)) {
          memories.push({
            type: "reference",
            title: this.generateTitle(text, system.name),
            content: text.trim(),
            metadata: { system: system.name },
          });
          found = true;
          break;
        }
        if (found) break;
      }
      if (found) break;
    }

    // If no specific system found, try generic patterns
    if (!found) {
      for (const { name, pattern } of genericPatterns) {
        if (pattern.test(text)) {
          memories.push({
            type: "reference",
            title: this.generateTitle(text, name),
            content: text.trim(),
            metadata: { system: name },
          });
          break;
        }
      }
    }

    return memories;
  }

  /**
   * Extract memories from agent reply
   */
  private extractFromAgentReply(reply: string): ExtractedMemory[] {
    const memories: ExtractedMemory[] = [];

    // Architecture decisions
    const architecturePatterns = [
      /\barchitecture\b/i,
      /\bdesign pattern\b/i,
      /\blayered architecture\b/i,
      /\bmicroservices?\b/i,
      /\bmonolith\b/i,
      /\bevent-driven\b/i,
      /\bhexagonal\b/i,
      /\bclean architecture\b/i,
    ];

    for (const pattern of architecturePatterns) {
      if (pattern.test(reply)) {
        memories.push({
          type: "project",
          title: this.generateTitle(reply, "architecture"),
          content: reply.trim(),
          metadata: { category: "architecture" },
        });
        break;
      }
    }

    // Tech stack mentions
    const techStackPatterns = [
      /\buses?\s+(?:React|Vue|Angular|Svelte)\b/i,
      /\bstack\b/i,
      /\bframework\b/i,
      /\blibrary\b/i,
      /\bTypeScript\b/i,
      /\bJavaScript\b/i,
      /\bPython\b/i,
      /\bGo\b/i,
      /\bRust\b/i,
      /\bJava\b/i,
    ];

    for (const pattern of techStackPatterns) {
      if (pattern.test(reply)) {
        memories.push({
          type: "project",
          title: this.generateTitle(reply, "tech_stack"),
          content: reply.trim(),
          metadata: { category: "tech_stack" },
        });
        break;
      }
    }

    return memories;
  }

  /**
   * Extract memories from deterministic results
   */
  private extractFromDeterministic(
    deterministic: TurnResult["deterministic"],
  ): ExtractedMemory[] {
    const memories: ExtractedMemory[] = [];

    if (!deterministic) {
      return memories;
    }

    // Linter errors
    if (deterministic.linterResults && !deterministic.linterResults.success) {
      memories.push({
        type: "project",
        title: this.generateTitle(
          deterministic.linterResults.output || "Linter error",
          "linter_error",
        ),
        content: deterministic.linterResults.output || "Linter failed",
        metadata: {
          category: "linter_error",
          exitCode: deterministic.linterResults.exitCode,
        },
      });
    }

    // Test failures
    if (deterministic.testResults && !deterministic.testResults.passed) {
      memories.push({
        type: "project",
        title: this.generateTitle(
          deterministic.testResults.summary || "Test failure",
          "test_failure",
        ),
        content:
          deterministic.testResults.output ||
          deterministic.testResults.summary ||
          "Tests failed",
        metadata: {
          category: "test_failure",
          summary: deterministic.testResults.summary,
        },
      });
    }

    return memories;
  }

  /**
   * Generate a meaningful title from content
   */
  private generateTitle(content: string, category: string): string {
    // Take first 50 chars and add category
    const preview = content.substring(0, 50).trim();
    const title = preview.length < content.length ? `${preview}...` : preview;

    // Capitalize first letter
    return title.charAt(0).toUpperCase() + title.slice(1);
  }

  /**
   * Deduplicate memories by content
   */
  private deduplicate(memories: ExtractedMemory[]): ExtractedMemory[] {
    const seen = new Set<string>();
    return memories.filter((memory) => {
      const key = `${memory.type}:${memory.content}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
}
