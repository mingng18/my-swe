import { type SubAgent } from "deepagents";
import {
  exploreTools,
  planTools,
  generalPurposeTools,
  reviewerTools,
} from "./toolFilter";
import { exploreSystemPrompt } from "./prompts/explore";
import { planSystemPrompt } from "./prompts/plan";
import { generalPurposeSystemPrompt } from "./prompts/general";
import { codeReviewerSystemPrompt } from "./prompts/codeReviewer";
import { databaseReviewerSystemPrompt } from "./prompts/databaseReviewer";
import { securityReviewerSystemPrompt } from "./prompts/securityReviewer";
import { goReviewerSystemPrompt } from "./prompts/goReviewer";
import { pythonReviewerSystemPrompt } from "./prompts/pythonReviewer";

export const builtInSubagents: SubAgent[] = [
  {
    name: "explore-agent",
    description:
      "Fast, read-only codebase exploration specialist. Use for finding files by patterns, searching code for keywords, and answering questions about how codebases work. Specify thoroughness: quick, medium, or very thorough.",
    systemPrompt: exploreSystemPrompt,
    tools: exploreTools,
    model: process.env.EXPLORE_AGENT_MODEL || "haiku",
  },
  {
    name: "plan-agent",
    description:
      "Software architect and planning specialist. Use to plan implementation strategies, identify critical files, and consider architectural trade-offs before coding.",
    systemPrompt: planSystemPrompt,
    tools: planTools,
    model: process.env.PLAN_AGENT_MODEL || "inherit",
  },
  {
    name: "general-purpose",
    description:
      "Versatile agent for researching complex questions, searching for code, and executing multi-step tasks. Has access to all tools.",
    systemPrompt: generalPurposeSystemPrompt,
    tools: generalPurposeTools,
    model: process.env.GENERAL_AGENT_MODEL || "inherit",
  },
  {
    name: "code-reviewer",
    description:
      "Expert code review specialist. Proactively reviews code for quality, security, and maintainability. Use immediately after writing or modifying code.",
    systemPrompt: codeReviewerSystemPrompt,
    tools: reviewerTools,
    model: process.env.CODE_REVIEWER_MODEL || "sonnet",
  },
  {
    name: "database-reviewer",
    description:
      "PostgreSQL database specialist for query optimization, schema design, security, and performance. Use when writing SQL, creating migrations, or troubleshooting database performance.",
    systemPrompt: databaseReviewerSystemPrompt,
    tools: reviewerTools,
    model: process.env.DATABASE_REVIEWER_MODEL || "sonnet",
  },
  {
    name: "security-reviewer",
    description:
      "Security vulnerability detection and remediation specialist. Use when handling user input, authentication, API endpoints, or sensitive data. Flags secrets, SSRF, injection, and OWASP Top 10 vulnerabilities.",
    systemPrompt: securityReviewerSystemPrompt,
    tools: reviewerTools,
    model: process.env.SECURITY_REVIEWER_MODEL || "sonnet",
  },
  {
    name: "go-reviewer",
    description:
      "Expert Go code reviewer specializing in idiomatic Go, concurrency patterns, error handling, and performance. Use for all Go code changes.",
    systemPrompt: goReviewerSystemPrompt,
    tools: reviewerTools,
    model: process.env.GO_REVIEWER_MODEL || "sonnet",
  },
  {
    name: "python-reviewer",
    description:
      "Expert Python code reviewer specializing in PEP 8 compliance, Pythonic idioms, type hints, security, and performance. Use for all Python code changes.",
    systemPrompt: pythonReviewerSystemPrompt,
    tools: reviewerTools,
    model: process.env.PYTHON_REVIEWER_MODEL || "sonnet",
  },
];
