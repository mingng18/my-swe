# Bullhorse Subagents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a hybrid subagent system for Bullhorse with synchronous agents (Explore, Plan, General-Purpose), async verification, and AGENTS.md support for repo-specific custom agents.

**Architecture:** Main agent delegates to specialized subagents via the `task()` tool. Synchronous subagents block until completion; async verification runs in background. Subagents have filtered tool access (e.g., Explore is read-only). Repo-specific agents are loaded from `.agents/agents/*.md` files with YAML frontmatter.

**Tech Stack:** TypeScript, deepagents v1.9.0+, LangGraph, Node.js built-ins (fs, path)

---

## File Structure

```
src/
├── subagents/
│   ├── registry.ts           # Built-in subagent definitions (Explore, Plan, General-Purpose)
│   ├── async.ts              # Async subagent config (Verification)
│   ├── agentsLoader.ts       # AGENTS.md file parser and loader
│   ├── toolFilter.ts         # Tool filtering utilities by name
│   ├── prompts/
│   │   ├── explore.ts        # Explore agent system prompt
│   │   ├── plan.ts           # Plan agent system prompt
│   │   └── general.ts        # General-Purpose agent system prompt
│   └── verification/
│       ├── graph.ts          # Verification LangGraph (StateGraph + node)
│       ├── prompt.ts         # Verification agent system prompt
│       └── state.ts          # Verification state schema
├── harness/
│   └── deepagents.ts         # Modified: load subagents at startup
├── tools/
│   └── index.ts              # Unchanged (existing tools)
└── server.ts                 # Unchanged

langgraph.json                # Modified: add verification graph

.env.example                  # Modified: add subagent env vars
```

---

## Phase 1: Foundation - Tool Filtering and Prompts

### Task 1: Create tool filter utilities

**Files:**
- Create: `src/subagents/toolFilter.ts`

- [ ] **Step 1: Write the tool filter module**

```typescript
import { allTools, sandboxAllTools } from "../tools";
import type { Tool } from "@langchain/core/tools";

const useSandbox = process.env.USE_SANDBOX === "true";

export function filterToolsByName(
  allowed?: string[],
  disallowed?: string[]
): Tool[] {
  const available = useSandbox ? sandboxAllTools : allTools;

  if (!allowed && !disallowed) return available;

  return available.filter((tool) => {
    const toolName = tool.name;

    if (disallowed?.includes(toolName)) return false;

    if (allowed) return allowed.includes(toolName);

    return true;
  });
}

// Tool sets for built-in agents
export const exploreTools = filterToolsByName(
  ["code_search", "semantic_search", "search", "fetch-url"],  // allowed
  ["sandbox-shell", "sandbox-files", "commit-and-open-pr", "merge-pr"]  // disallowed
);

export const planTools = exploreTools;  // Same as explore

// General-purpose gets all tools except the Agent tool itself
// (Agent tool is not in allTools, so we just use all available)
export const generalPurposeTools = useSandbox ? sandboxAllTools : allTools;
```

- [ ] **Step 2: Create test file**

```typescript
// src/subagents/__tests__/toolFilter.test.ts
import { describe, it, expect } from "bun:test";
import { filterToolsByName, exploreTools } from "../toolFilter";

describe("toolFilter", () => {
  it("should return all tools when no filters provided", () => {
    const result = filterToolsByName();
    expect(Array.isArray(result)).toBe(true);
  });

  it("should filter to allowed tools only", () => {
    const result = filterToolsByName(["code_search", "semantic_search"]);
    expect(result.every(t => ["code_search", "semantic_search"].includes(t.name))).toBe(true);
  });

  it("should exclude disallowed tools", () => {
    const result = filterToolsByName(undefined, ["commit-and-open-pr", "merge-pr"]);
    expect(result.some(t => t.name === "commit-and-open-pr")).toBe(false);
  });

  it("should prioritize disallowed over allowed", () => {
    const result = filterToolsByName(["code_search", "commit-and-open-pr"], ["commit-and-open-pr"]);
    expect(result.some(t => t.name === "commit-and-open-pr")).toBe(false);
    expect(result.some(t => t.name === "code_search")).toBe(true);
  });

  it("exploreTools should not have commit tools", () => {
    expect(exploreTools.some(t => t.name === "commit-and-open-pr")).toBe(false);
    expect(exploreTools.some(t => t.name === "merge-pr")).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
bun test src/subagents/__tests__/toolFilter.test.ts
```

Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/subagents/toolFilter.ts src/subagents/__tests__/toolFilter.test.ts
git commit -m "feat(subagents): add tool filtering utilities

Add filterToolsByName to create tool sets for different subagent types.
Explore agent gets read-only tools, others get varying access."
```

---

### Task 2: Create Explore agent prompt

**Files:**
- Create: `src/subagents/prompts/explore.ts`

- [ ] **Step 1: Write the Explore agent prompt**

```typescript
export const exploreSystemPrompt = `You are a file search specialist for Bullhorse, an agentic coder pipeline. You excel at thoroughly navigating and exploring codebases.

=== CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS ===
This is a READ-ONLY exploration task. You are STRICTLY PROHIBITED from:
- Creating new files (no Write tool or file creation of any kind)
- Modifying existing files (no Edit operations)
- Deleting files
- Moving or copying files
- Creating temporary files anywhere
- Using redirect operators (>, >>, |) or heredocs to write to files
- Running ANY commands that change system state

Your role is EXCLUSIVELY to search and analyze existing code. You do NOT have access to file editing tools.

Your strengths:
- Rapidly finding files using pattern matching
- Searching code and text with powerful search tools
- Reading and analyzing file contents

Available tools:
- code_search: Find classes, functions, and their definitions
- semantic_search: Conceptual code search (by meaning, not pattern)
- search: Web search for documentation and examples
- fetch-url: Fetch URLs for documentation

Guidelines:
- Use code_search for finding specific classes, functions, or implementations
- Use semantic_search for conceptual questions (e.g., "where is auth implemented?")
- Use Read when you know the specific file path
- NEVER create, edit, or modify files
- Make efficient use of tools - spawn parallel searches when possible
- Adapt your thoroughness based on the caller's specification (quick/medium/very thorough)

Complete the user's search request efficiently and report your findings clearly.`;
```

- [ ] **Step 2: Commit**

```bash
git add src/subagents/prompts/explore.ts
git commit -m "feat(subagents): add Explore agent system prompt

Read-only codebase exploration specialist with clear boundaries
and tool usage guidelines."
```

---

### Task 3: Create Plan agent prompt

**Files:**
- Create: `src/subagents/prompts/plan.ts`

- [ ] **Step 1: Write the Plan agent prompt**

```typescript
export const planSystemPrompt = `You are a software architect and planning specialist for Bullhorse. Your role is to explore the codebase and design implementation plans.

=== CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS ===
This is a READ-ONLY planning task. You are STRICTLY PROHIBITED from:
- Creating new files (no Write tool or file creation of any kind)
- Modifying existing files (no Edit operations)
- Deleting files
- Moving or copying files
- Creating temporary files anywhere
- Using redirect operators (>, >>, |) or heredocs to write to files
- Running ANY commands that change system state

Your role is EXCLUSIVELY to explore the codebase and design implementation plans.

## Your Process

1. **Understand Requirements**: Focus on the requirements provided by the caller.

2. **Explore Thoroughly**:
   - Read any files provided to you in the initial prompt
   - Find existing patterns and conventions using code_search and semantic_search
   - Understand the current architecture
   - Identify similar features as reference
   - Trace through relevant code paths
   - NEVER create, edit, or modify files

3. **Design Solution**:
   - Create implementation approach based on requirements
   - Consider trade-offs and architectural decisions
   - Follow existing patterns where appropriate

4. **Detail the Plan**:
   - Provide step-by-step implementation strategy
   - Identify dependencies and sequencing
   - Anticipate potential challenges

## Required Output

End your response with:

### Critical Files for Implementation
List 3-5 files most critical for implementing this plan:
- path/to/file1.ts
- path/to/file2.ts
- path/to/file3.ts

REMEMBER: You can ONLY explore and plan. You CANNOT and MUST NOT write, edit, or modify any files.`;
```

- [ ] **Step 2: Commit**

```bash
git add src/subagents/prompts/plan.ts
git commit -m "feat(subagents): add Plan agent system prompt

Software architect specialist for implementation planning
with required Critical Files output format."
```

---

### Task 4: Create General-Purpose agent prompt

**Files:**
- Create: `src/subagents/prompts/general.ts`

- [ ] **Step 1: Write the General-Purpose agent prompt**

```typescript
export const generalPurposeSystemPrompt = `You are an agent for Bullhorse. Given the user's message, you should use the tools available to complete the task.

Complete the task fully—don't gold-plate, but don't leave it half-done.

Your strengths:
- Searching for code, configurations, and patterns across large codebases
- Analyzing multiple files to understand system architecture
- Investigating complex questions that require exploring many files
- Performing multi-step research tasks

Guidelines:
- For file searches: use code_search or semantic_search when you don't know where something lives
- For analysis: Start broad and narrow down. Use multiple search strategies if the first doesn't yield results
- Be thorough: Check multiple locations, consider different naming conventions, look for related files
- NEVER create files unless they're absolutely necessary for achieving your goal
- ALWAYS prefer editing an existing file to creating a new one
- NEVER proactively create documentation files unless explicitly requested

Return a concise report covering what was done and any key findings — the caller will relay this to the user.`;
```

- [ ] **Step 2: Commit**

```bash
git add src/subagents/prompts/general.ts
git commit -m "feat(subagents): add General-Purpose agent system prompt

Versatile research and multi-step task agent with conservative
file creation guidance."
```

---

## Phase 2: Built-in Subagent Registry

### Task 5: Create subagent registry

**Files:**
- Create: `src/subagents/registry.ts`
- Modify: `src/harness/deepagents.ts`

- [ ] **Step 1: Write the subagent registry**

```typescript
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
```

- [ ] **Step 2: Modify deepagents.ts to import and use subagents**

Add this after the existing imports in `src/harness/deepagents.ts`:

```typescript
import { builtInSubagents } from "../subagents/registry";
```

Then modify the `createAgentInstance` function config object (around line 248):

```typescript
  const config: any = {
    model: chatModel,
    systemPrompt: constructSystemPrompt(args.workspaceRoot || process.cwd()),
    checkpointer: new MemorySaver(),
    tools: useSandbox ? sandboxAllTools : allTools,
    middleware,
  };

  if (args.backend) {
    config.backend = args.backend;
  }

  // Add subagents if enabled
  if (process.env.SUBAGENTS_ENABLED !== "false") {
    config.subagents = builtInSubagents;
    logger.info(
      { count: builtInSubagents.length },
      "[deepagents] Subagents enabled"
    );
  }

  const agent = createDeepAgent(config);
  return agent;
```

- [ ] **Step 3: Create integration test**

```typescript
// src/subagents/__tests__/registry.test.ts
import { describe, it, expect } from "bun:test";
import { builtInSubagents } from "../registry";

describe("subagent registry", () => {
  it("should have 3 built-in subagents", () => {
    expect(builtInSubagents.length).toBe(3);
  });

  it("should have explore-agent with correct config", () => {
    const explore = builtInSubagents.find(a => a.name === "explore-agent");
    expect(explore).toBeDefined();
    expect(explore?.description).toContain("read-only");
    expect(explore?.tools).toBeDefined();
    expect(Array.isArray(explore?.tools)).toBe(true);
  });

  it("should have plan-agent with correct config", () => {
    const plan = builtInSubagents.find(a => a.name === "plan-agent");
    expect(plan).toBeDefined();
    expect(plan?.description).toContain("architect");
  });

  it("should have general-purpose with correct config", () => {
    const general = builtInSubagents.find(a => a.name === "general-purpose");
    expect(general).toBeDefined();
    expect(general?.description).toContain("Versatile");
  });

  it("explore-agent should not have commit tools", () => {
    const explore = builtInSubagents.find(a => a.name === "explore-agent")!;
    const toolNames = explore.tools.map(t => t.name);
    expect(toolNames).not.toContain("commit-and-open-pr");
    expect(toolNames).not.toContain("merge-pr");
  });
});
```

- [ ] **Step 4: Run tests**

```bash
bun test src/subagents/__tests__/registry.test.ts
```

Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/subagents/registry.ts src/harness/deepagents.ts src/subagents/__tests__/registry.test.ts
git commit -m "feat(subagents): add built-in subagent registry

Register Explore, Plan, and General-Purpose subagents.
Integrate into createAgentInstance with SUBAGENTS_ENABLED flag."
```

---

## Phase 3: AGENTS.md Support

### Task 6: Create AGENTS.md loader

**Files:**
- Create: `src/subagents/agentsLoader.ts`
- Modify: `src/harness/deepagents.ts`

- [ ] **Step 1: Write the AGENTS.md loader**

```typescript
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { parse } from "yaml";
import type { SubAgent } from "deepagents";
import { filterToolsByName } from "./toolFilter";

interface AgentsMdMetadata {
  name: string;
  description: string;
  model?: string;
  tools?: string[];
  disallowedTools?: string[];
}

export async function loadRepoAgents(
  agentsDir: string = ".agents/agents"
): Promise<SubAgent[]> {
  const agents: SubAgent[] = [];

  try {
    const files = readdirSync(agentsDir);
    for (const file of files) {
      if (file.endsWith(".md")) {
        const content = readFileSync(join(agentsDir, file), "utf8");
        const agent = parseAgentsMd(content, file);
        if (agent) {
          agents.push(agent);
        }
      }
    }
  } catch (err) {
    // Directory doesn't exist or isn't readable - that's fine
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[agentsLoader] Error reading agents directory: ${err}`);
    }
  }

  return agents;
}

function parseAgentsMd(content: string, filename: string): SubAgent | null {
  try {
    const match = content.match(/^---\n([\s\S]+?)\n---/);
    if (!match) {
      console.warn(`[agentsLoader] No YAML frontmatter found in ${filename}`);
      return null;
    }

    const metadata = parse(match[1]) as AgentsMdMetadata;

    // Validate required fields
    if (!metadata.name || !metadata.description) {
      console.warn(
        `[agentsLoader] Missing required fields in ${filename}`,
        metadata
      );
      return null;
    }

    const systemPrompt = content.slice(match[0].length).trim();

    if (!systemPrompt) {
      console.warn(`[agentsLoader] Empty system prompt in ${filename}`);
      return null;
    }

    return {
      name: metadata.name,
      description: metadata.description,
      systemPrompt,
      tools: filterToolsByName(metadata.tools, metadata.disallowedTools),
      model: metadata.model || "inherit",
    };
  } catch (err) {
    console.error(`[agentsLoader] Failed to parse ${filename}:`, err);
    return null;
  }
}

export function mergeSubagents(
  builtIn: SubAgent[],
  repo: SubAgent[]
): SubAgent[] {
  const merged = [...builtIn];
  const seenNames = new Set(builtIn.map((a) => a.name));

  for (const repoAgent of repo) {
    if (seenNames.has(repoAgent.name)) {
      console.warn(
        `[subagent] Repo agent "${repoAgent.name}" overrides built-in agent`
      );
      const idx = merged.findIndex((a) => a.name === repoAgent.name);
      if (idx !== -1) merged.splice(idx, 1);
    }
    merged.push(repoAgent);
    seenNames.add(repoAgent.name);
  }

  return merged;
}
```

- [ ] **Step 2: Modify deepagents.ts to load repo agents**

Add this import after the builtInSubagents import:

```typescript
import { loadRepoAgents, mergeSubagents } from "../subagents/agentsLoader";
```

Then modify the subagents loading section in `createAgentInstance`:

```typescript
  // Add subagents if enabled
  if (process.env.SUBAGENTS_ENABLED !== "false") {
    // Load repo-specific agents
    const repoAgentsDir = process.env.REPO_AGENTS_DIR || ".agents/agents";
    const repoAgents = await loadRepoAgents(repoAgentsDir);

    // Merge built-in and repo agents
    const allSubagents = mergeSubagents(builtInSubagents, repoAgents);

    config.subagents = allSubagents;
    logger.info(
      {
        total: allSubagents.length,
        builtIn: builtInSubagents.length,
        repo: repoAgents.length,
      },
      "[deepagents] Subagents enabled"
    );
  }
```

- [ ] **Step 3: Create test AGENTS.md files**

```bash
mkdir -p .agents/agents
```

Create `.agents/agents/example-custom-agent.md`:

```markdown
---
name: example-test-agent
description: Example custom agent for testing AGENTS.md loading
model: inherit
tools: [code_search]
disallowedTools: [commit-and-open-pr]
---

You are a test agent for verifying AGENTS.md loading works correctly.

Your task is to search for code using the code_search tool and report findings.
```

- [ ] **Step 4: Create integration test**

```typescript
// src/subagents/__tests__/agentsLoader.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { loadRepoAgents, mergeSubagents, parseAgentsMd } from "../agentsLoader";
import { builtInSubagents } from "../registry";

const testAgentsDir = join(process.cwd(), ".agents", "agents");

describe("agentsLoader", () => {
  beforeEach(() => {
    // Ensure directory exists
    if (!existsSync(testAgentsDir)) {
      mkdirSync(testAgentsDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Cleanup test files
    const testFile = join(testAgentsDir, "test-agent.md");
    if (existsSync(testFile)) {
      unlinkSync(testFile);
    }
  });

  it("should load agents from directory", async () => {
    const testContent = `---
name: test-agent
description: Test agent
tools: [code_search]
---

Test system prompt`;
    writeFileSync(join(testAgentsDir, "test-agent.md"), testContent);

    const agents = await loadRepoAgents(testAgentsDir);
    expect(agents.length).toBeGreaterThan(0);
    expect(agents[0].name).toBe("test-agent");
  });

  it("should handle missing directory gracefully", async () => {
    const agents = await loadRepoAgents("/nonexistent/path");
    expect(agents).toEqual([]);
  });

  it("should parse valid AGENTS.md file", () => {
    const content = `---
name: valid-agent
description: Valid agent
tools: [code_search, semantic_search]
---
System prompt here`;
    const result = parseAgentsMd(content, "valid.md");
    expect(result).not.toBeNull();
    expect(result?.name).toBe("valid-agent");
    expect(result?.systemPrompt).toBe("System prompt here");
  });

  it("should reject AGENTS.md without YAML frontmatter", () => {
    const content = "No frontmatter here";
    const result = parseAgentsMd(content, "invalid.md");
    expect(result).toBeNull();
  });

  it("should merge repo agents with built-ins", () => {
    const repoAgents = [
      {
        name: "repo-agent",
        description: "Repo agent",
        systemPrompt: "Test",
        tools: [],
      },
    ];
    const merged = mergeSubagents(builtInSubagents, repoAgents);
    expect(merged.length).toBe(builtInSubagents.length + 1);
  });

  it("repo agent should override built-in with same name", () => {
    const repoAgents = [
      {
        name: "explore-agent",
        description: "Custom explore",
        systemPrompt: "Custom prompt",
        tools: [],
      },
    ];
    const merged = mergeSubagents(builtInSubagents, repoAgents);
    const explore = merged.find(a => a.name === "explore-agent");
    expect(explore?.description).toBe("Custom explore");
  });
});
```

- [ ] **Step 5: Run tests**

```bash
bun test src/subagents/__tests__/agentsLoader.test.ts
```

Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/subagents/agentsLoader.ts src/harness/deepagents.ts src/subagents/__tests__/agentsLoader.test.ts .agents/agents/example-custom-agent.md
git commit -m "feat(subagents): add AGENTS.md support

Load repo-specific agents from .agents/agents/ directory.
Parse YAML frontmatter and merge with built-in agents.
Repo agents can override built-ins with same name."
```

---

## Phase 4: Async Verification Subagent

### Task 7: Upgrade deepagents dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Upgrade deepagents to 1.9.0+**

```bash
bun add deepagents@^1.9.0
```

Expected: Package installs successfully

- [ ] **Step 2: Commit**

```bash
git add package.json bun.lockb
git commit -m "chore: upgrade deepagents to v1.9.0

Required for async subagent support."
```

---

### Task 8: Create Verification graph and state

**Files:**
- Create: `src/subagents/verification/state.ts`
- Create: `src/subagents/verification/prompt.ts`
- Create: `src/subagents/verification/graph.ts`

- [ ] **Step 1: Write verification state schema**

```typescript
// src/subagents/verification/state.ts
import { Annotation } from "@langchain/langgraph";

export const VerificationStateAnnotation = Annotation.Root({
  messages: Annotation<any[]>({
    reducer: (_, y) => y,
    default: () => [],
  }),
  verdict: Annotation<string>({
    default: () => "",
  }),
  status: Annotation<"running" | "complete" | "error">({
    default: () => "running",
  }),
});
```

- [ ] **Step 2: Write verification prompt**

```typescript
// src/subagents/verification/prompt.ts
export const verificationSystemPrompt = `You are a verification specialist. Your job is not to confirm the implementation works — it's to try to break it.

=== CRITICAL: READ-ONLY MODE ===
You are STRICTLY PROHIBITED from:
- Creating, modifying, or deleting any files IN THE PROJECT DIRECTORY
- Installing dependencies or packages
- Running git write operations (add, commit, push)

=== WHAT YOU RECEIVE ===
You will receive: the original task description, files changed, approach taken, and optionally a plan file path.

=== VERIFICATION STRATEGY ===
Adapt your strategy based on what was changed:

**Backend/API changes:** Start server → fetch endpoints → verify response shapes → test error handling → check edge cases

**CLI/script changes:** Run with representative inputs → verify stdout/stderr/exit codes → test edge inputs

**Infrastructure/config:** Validate syntax → dry-run where possible → check env vars are referenced

**Bug fixes:** Reproduce original bug → verify fix → run regression tests

**Refactoring:** Existing test suite MUST pass unchanged → diff public API surface

=== REQUIRED STEPS ===
1. Read the project's CLAUDE.md / README for build/test commands
2. Run the build (if applicable) - automatic FAIL if broken
3. Run the project's test suite (if it has one) - automatic FAIL if failing
4. Run linters/type-checkers if configured

Then apply type-specific strategy above.

=== OUTPUT FORMAT ===
Every check MUST follow this structure:

### Check: [what you're verifying]
**Command run:**
  [exact command]
**Output observed:**
  [actual output]
**Result: PASS** (or FAIL with Expected vs Actual)

End with exactly: VERDICT: PASS or VERDICT: FAIL or VERDICT: PARTIAL`;

export const getUserPrompt = (task: string, files?: string, approach?: string): string => {
  let prompt = `Original task: ${task}`;
  if (files) prompt += `\n\nFiles changed: ${files}`;
  if (approach) prompt += `\n\nApproach: ${approach}`;
  return prompt;
};
```

- [ ] **Step 3: Write verification graph**

```typescript
// src/subagents/verification/graph.ts
import { StateGraph } from "@langchain/langgraph";
import { createChatModel } from "../../utils/model-factory";
import { loadModelConfig } from "../../utils/config";
import { VerificationStateAnnotation } from "./state";
import { verificationSystemPrompt } from "./prompt";

export async function getVerificationGraph() {
  const modelConfig = loadModelConfig();
  const model = await createChatModel(modelConfig);

  const verificationNode = async (state: typeof VerificationStateAnnotation.State) => {
    const lastMessage = state.messages[state.messages.length - 1];
    const userContent = lastMessage.content;

    const prompt = [
      { role: "system", content: verificationSystemPrompt },
      ...state.messages,
    ];

    const response = await model.invoke(prompt);

    return {
      messages: [...state.messages, response],
      verdict: extractVerdict(response.content as string),
      status: "complete" as const,
    };
  };

  function extractVerdict(content: string): string {
    const match = content.match(/VERDICT:\s*(PASS|FAIL|PARTIAL)/i);
    if (match) {
      return `VERDICT: ${match[1].toUpperCase()}`;
    }
    return "VERDICT: PARTIAL\n\nNote: No explicit verdict found in output.";
  }

  const graph = new StateGraph(VerificationStateAnnotation)
    .addNode("verification", verificationNode)
    .addEdge("__start__", "verification")
    .addEdge("verification", "__end__");

  return graph.compile();
}
```

- [ ] **Step 4: Create tests**

```typescript
// src/subagents/verification/__tests__/graph.test.ts
import { describe, it, expect } from "bun:test";
import { getVerificationGraph } from "../graph";

describe("verification graph", () => {
  it("should compile the graph", async () => {
    const graph = await getVerificationGraph();
    expect(graph).toBeDefined();
  });

  it("should have correct structure", async () => {
    const graph = await getVerificationGraph();
    const nodes = graph.nodes.map((n: any) => n.id);
    expect(nodes).toContain("verification");
  });
});
```

- [ ] **Step 5: Run tests**

```bash
bun test src/subagents/verification/__tests__/graph.test.ts
```

Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/subagents/verification/
git commit -m "feat(subagents): add async verification graph

Separate LangGraph for adversarial verification.
Runs build, tests, linters, and adversarial probes.
Returns structured VERDICT: PASS/FAIL/PARTIAL."
```

---

### Task 9: Configure async subagents

**Files:**
- Create: `src/subagents/async.ts`
- Modify: `src/harness/deepagents.ts`
- Modify: `langgraph.json`

- [ ] **Step 1: Write async subagent config**

```typescript
// src/subagents/async.ts
import { type AsyncSubAgent } from "deepagents";

export const asyncSubagents: AsyncSubAgent[] = [
  {
    name: "verification-agent",
    description: "Verification specialist that tries to break implementations. Runs builds, tests, linters, and adversarial probes. Use after non-trivial changes (3+ file edits, backend/API changes, infrastructure changes).",
    graphId: "verification",
    // No url → ASGI transport (co-deployed)
  },
];
```

- [ ] **Step 2: Modify langgraph.json**

```json
{
  "graphs": {
    "bullhorse": "./src/server.ts:getGraph",
    "verification": "./src/subagents/verification/graph.ts:getVerificationGraph"
  },
  "env": ".env"
}
```

- [ ] **Step 3: Modify deepagents.ts to load async subagents**

Add this import:

```typescript
import { asyncSubagents } from "../subagents/async";
```

Add this after the sync subagents loading:

```typescript
  // Add async subagents if enabled
  if (process.env.ASYNC_SUBAGENTS_ENABLED === "true") {
    config.asyncSubagents = asyncSubagents;
    logger.info(
      { count: asyncSubagents.length },
      "[deepagents] Async subagents enabled"
    );
  }
```

- [ ] **Step 4: Commit**

```bash
git add src/subagents/async.ts src/harness/deepagents.ts langgraph.json
git commit -m "feat(subagents): configure async verification subagent

Register verification graph in langgraph.json.
Load async subagents when ASYNC_SUBAGENTS_ENABLED=true."
```

---

## Phase 5: Environment Configuration

### Task 10: Update environment variables

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add subagent environment variables to .env.example**

```bash
cat >> .env.example << 'EOF'

# Subagent Configuration
SUBAGENTS_ENABLED=false              # Enable/disable subagents
ASYNC_SUBAGENTS_ENABLED=false        # Enable async subagents (Verification)
REPO_AGENTS_DIR=.agents/agents       # Directory for repo-specific agents

# Per-subagent model configuration
EXPLORE_AGENT_MODEL=haiku            # Fast model for exploration
PLAN_AGENT_MODEL=inherit             # Use main agent's model
GENERAL_AGENT_MODEL=inherit          # Use main agent's model
VERIFICATION_AGENT_MODEL=inherit     # Use main agent's model

# Async subagent settings
VERIFICATION_TIMEOUT_MS=300000       # 5 minute timeout for verification
VERIFICATION_POLL_INTERVAL_MS=5000   # How often to check status

# LangGraph worker pool for concurrent async tasks
LANGGRAPH_N_JOBS_PER_WORKER=10       # Increase for parallel verification
EOF
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "chore: add subagent environment variables

Add configuration for enabling/disabling subagents,
per-agent model settings, and async verification."
```

---

### Task 11: Update CLAUDE.md documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add subagents section to CLAUDE.md**

Add this section after "Adding New Tools":

```markdown
## Subagents

Bullhorse supports subagents for specialized tasks:

### Built-in Subagents

- **explore-agent**: Fast, read-only codebase exploration. Use for finding files and searching code.
- **plan-agent**: Software architect for implementation planning. Creates step-by-step plans with critical files.
- **general-purpose**: Versatile research and multi-step tasks. Has access to all tools.
- **verification-agent**: Async verification that runs tests, linters, and adversarial probes.

### Usage

The main agent automatically delegates to appropriate subagents. Enable with:

```bash
SUBAGENTS_ENABLED=true
ASYNC_SUBAGENTS_ENABLED=true
```

### Custom Agents

Define repo-specific agents in `.agents/agents/*.md`:

```markdown
---
name: my-custom-agent
description: Specialized agent for X
tools: [code_search, semantic_search]
---

System prompt here...
```
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add subagents documentation to CLAUDE.md

Document built-in subagents, usage, and custom agent creation."
```

---

## Phase 6: Integration Testing

### Task 12: Create end-to-end integration test

**Files:**
- Create: `src/subagents/__tests__/integration.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
import { describe, it, expect } from "bun:test";
import { createDeepAgent } from "deepagents";
import { createChatModel } from "../../utils/model-factory";
import { loadModelConfig } from "../../utils/config";
import { builtInSubagents } from "../registry";
import { loadRepoAgents, mergeSubagents } from "../agentsLoader";
import { asyncSubagents } from "../async";

describe("subagents integration", () => {
  it("should create agent with built-in subagents", async () => {
    const modelConfig = loadModelConfig();
    const model = await createChatModel(modelConfig);

    const agent = createDeepAgent({
      model,
      subagents: builtInSubagents,
    });

    expect(agent).toBeDefined();
  });

  it("should create agent with async subagents", async () => {
    const modelConfig = loadModelConfig();
    const model = await createChatModel(modelConfig);

    const agent = createDeepAgent({
      model,
      asyncSubagents,
    });

    expect(agent).toBeDefined();
  });

  it("should merge built-in and repo agents", async () => {
    const repoAgents = await loadRepoAgents(".agents/agents");
    const merged = mergeSubagents(builtInSubagents, repoAgents);

    expect(merged.length).toBeGreaterThanOrEqual(builtInSubagents.length);
  });

  it("should create agent with all subagent types", async () => {
    const modelConfig = loadModelConfig();
    const model = await createChatModel(modelConfig);
    const repoAgents = await loadRepoAgents(".agents/agents");
    const allSubagents = mergeSubagents(builtInSubagents, repoAgents);

    const agent = createDeepAgent({
      model,
      subagents: allSubagents,
      asyncSubagents,
    });

    expect(agent).toBeDefined();
  });
});
```

- [ ] **Step 2: Run integration tests**

```bash
bun test src/subagents/__tests__/integration.test.ts
```

Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/subagents/__tests__/integration.test.ts
git commit -m "test(subagents): add integration tests

Test agent creation with built-in, async, and repo-specific subagents."
```

---

### Task 13: Run full test suite

**Files:**
- No changes

- [ ] **Step 1: Run all tests**

```bash
bun test
```

Expected: All tests pass

- [ ] **Step 2: Type check**

```bash
bunx tsc --noEmit
```

Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git commit --allow-empty -m "test(subagents): full test suite passes

All subagent tests passing with no type errors."
```

---

## Phase 7: Documentation Complete

### Task 14: Create example AGENTS.md files

**Files:**
- Create: `.agents/agents/security-reviewer.md`
- Create: `.agents/agents/database-specialist.md`

- [ ] **Step 1: Create security reviewer example**

```markdown
---
name: security-reviewer
description: Specialized agent for security vulnerability detection and review. Use when implementing authentication, authorization, or handling sensitive data.
model: inherit
tools: [code_search, semantic_search, search]
disallowedTools: [commit-and-open-pr, merge-pr]
---

You are a security specialist focused on finding vulnerabilities in code.

Your workflow:
1. Search for common vulnerability patterns (SQL injection, XSS, CSRF)
2. Verify input sanitization and validation
3. Examine authentication and authorization flows
4. Check for hardcoded secrets or credentials
5. Review encryption and data handling

Report your findings with:
- Severity level (Critical/High/Medium/Low)
- Affected files and line numbers
- Recommended fixes
```

- [ ] **Step 2: Create database specialist example**

```markdown
---
name: database-specialist
description: Specialized agent for database operations, migrations, and query optimization. Use when working with database schemas, migrations, or complex queries.
model: inherit
tools: [code_search, semantic_search]
disallowedTools: [commit-and-open-pr, merge-pr, sandbox-shell, sandbox-files]
---

You are a database specialist focused on schema design, migrations, and query optimization.

Your workflow:
1. Examine schema files and migration history
2. Review database query patterns
3. Check for N+1 query problems
4. Verify proper indexing
5. Look for missing transactions or rollback handling

Report your findings with specific file references and query examples.
```

- [ ] **Step 3: Commit**

```bash
git add .agents/agents/
git commit -m "docs(subagents): add example custom agents

Add security-reviewer and database-specialist example agents
to demonstrate AGENTS.md format and usage."
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Synchronous subagents (Explore, Plan, General-Purpose) - Tasks 1-5
- [x] AGENTS.md support - Tasks 6
- [x] Async verification - Tasks 7-9
- [x] Environment configuration - Task 10
- [x] Documentation - Task 11, 14
- [x] Integration testing - Tasks 12-13

**Placeholder scan:**
- [x] No TBD/TODO placeholders found
- [x] All code blocks complete
- [x] All file paths exact
- [x] All commands specified

**Type consistency:**
- [x] SubAgent type from deepagents used consistently
- [x] Function names match across tasks
- [x] File structure matches implementation

---

Plan complete and saved to `.claude/plans/2026-04-10-subagents-implementation.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
