import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createLogger } from "../utils/logger";
import { skillRegistry } from "../skills/registry";

const logger = createLogger("activate-skill");

/**
 * Activate a skill tool.
 *
 * Loads the full content of a skill from the registry and returns it
 * wrapped in <skill_content> tags. This allows the LLM to access detailed
 * instructions for specific tasks without bloating the system prompt.
 *
 * Skills are discovered from .agents/skills/*.md files and presented in
 * the skill catalog. When a task matches a skill's description, use this
 * tool to load its full instructions.
 *
 * Args:
 *   name: The name of the skill to activate (e.g., "commit", "review-pr")
 *
 * Returns:
 *   The full skill content wrapped in <skill_content> tags, or an error
 *   if the skill is not found.
 */
export const activateSkillTool = tool(
  async ({ name }, config) => {
    const threadId = config?.configurable?.thread_id;
    if (!threadId) {
      return JSON.stringify({ error: "Missing thread_id" });
    }

    logger.debug({ skill: name, thread: threadId }, "[activate-skill] Loading skill");

    // Get the skill from the registry
    const entry = skillRegistry.get(threadId, name);
    if (!entry) {
      logger.warn({ skill: name, thread: threadId }, "[activate-skill] Skill not found");
      return JSON.stringify({
        error: `Skill '${name}' not found in registry`,
        available: skillRegistry.getAllForThread(threadId).map((e) => e.skill.name),
      });
    }

    const skill = entry.skill;

    // Mark the skill as activated
    skillRegistry.markActivated(threadId, name);

    // Build the skill content
    const parts: string[] = [];

    // Add metadata
    parts.push(`# ${skill.name}`);
    if (skill.description) {
      parts.push(`\n${skill.description}`);
    }
    if (skill.version) {
      parts.push(`\nVersion: ${skill.version}`);
    }

    // Add the skill body (the actual instructions)
    if (skill.body) {
      parts.push(`\n${skill.body}`);
    }

    const fullContent = parts.join("\n");

    logger.info(
      { skill: name, thread: threadId, contentLength: fullContent.length },
      "[activate-skill] Skill activated"
    );

    // Return wrapped in skill_content tags
    return `<skill_content name="${name}">
${fullContent}
</skill_content>`;
  },
  {
    name: "activate_skill",
    description:
      "Activate a skill to load its full instructions. Use this when a task matches a skill's description from the available skills catalog. The skill content will be returned in <skill_content> tags.",
    schema: z.object({
      name: z
        .string()
        .describe(
          "The name of the skill to activate (e.g., 'commit', 'review-pr', 'pdf')"
        ),
    }),
  }
);
