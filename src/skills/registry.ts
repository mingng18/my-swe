import { createLogger } from "../utils/logger";
import type { Skill, SkillRegistryEntry } from "./types";

const logger = createLogger("skills:registry");

/**
 * Thread-scoped registry for discovered skills.
 * Tracks skill availability and activation state per conversation thread.
 */
export class SkillRegistry {
  private threads: Map<
    string,
    Map<string, SkillRegistryEntry>
  > = new Map();

  /**
   * Store skills for a specific thread.
   * Replaces any existing skills for that thread.
   */
  setForThread(threadId: string, skills: Skill[]): void {
    const skillMap = new Map<string, SkillRegistryEntry>();

    for (const skill of skills) {
      skillMap.set(skill.name, { skill });
    }

    this.threads.set(threadId, skillMap);
    logger.debug(
      { thread: threadId, count: skills.length },
      "[registry] Skills registered",
    );
  }

  /**
   * Get a specific skill entry by thread and name.
   * Returns null if not found.
   */
  get(threadId: string, skillName: string): SkillRegistryEntry | null {
    const threadSkills = this.threads.get(threadId);
    if (!threadSkills) return null;

    return threadSkills.get(skillName) || null;
  }

  /**
   * Get all skill entries for a thread.
   * Returns empty array if thread has no skills.
   */
  getAllForThread(threadId: string): SkillRegistryEntry[] {
    const threadSkills = this.threads.get(threadId);
    if (!threadSkills) return [];

    return Array.from(threadSkills.values());
  }

  /**
   * Check if a skill has been activated in a thread.
   * Returns false if skill or thread doesn't exist.
   */
  isActivated(threadId: string, skillName: string): boolean {
    const entry = this.get(threadId, skillName);
    return entry?.activatedAt !== undefined;
  }

  /**
   * Mark a skill as activated with current timestamp.
   * No-op if skill doesn't exist.
   */
  markActivated(threadId: string, skillName: string): void {
    const entry = this.get(threadId, skillName);
    if (!entry) return;

    entry.activatedAt = new Date();
    logger.debug(
      { thread: threadId, skill: skillName },
      "[registry] Skill activated",
    );
  }

  /**
   * Remove all skills for a thread.
   * Useful for cleanup or thread reset.
   */
  clearThread(threadId: string): void {
    this.threads.delete(threadId);
    logger.debug({ thread: threadId }, "[registry] Thread cleared");
  }
}
