import { type SubAgent } from "deepagents";
import { exploreTools, planTools, generalPurposeTools } from "./toolFilter";
import { exploreSystemPrompt } from "./prompts/explore";
import { planSystemPrompt } from "./prompts/plan";
import { generalPurposeSystemPrompt } from "./prompts/general";

export const builtInSubagents: SubAgent[] = [
  {
    name: "explore-agent",
    description: "Fast, read-only codebase exploration specialist. Use for finding files by patterns, searching code for keywords, and answering questions about how codebases work. Specify thoroughness: quick, medium, or very thorough.",
    systemPrompt: exploreSystemPrompt,
    tools: exploreTools,
    model: process.env.EXPLORE_AGENT_MODEL || "haiku",
  },
  {
    name: "plan-agent",
    description: "Software architect and planning specialist. Use to plan implementation strategies, identify critical files, and consider architectural trade-offs before coding.",
    systemPrompt: planSystemPrompt,
    tools: planTools,
    model: process.env.PLAN_AGENT_MODEL || "inherit",
  },
  {
    name: "general-purpose",
    description: "Versatile agent for researching complex questions, searching for code, and executing multi-step tasks. Has access to all tools.",
    systemPrompt: generalPurposeSystemPrompt,
    tools: generalPurposeTools,
    model: process.env.GENERAL_AGENT_MODEL || "inherit",
  },
];
