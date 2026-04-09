# General-Purpose Agent

## Overview

The **general-purpose** agent is a versatile agent for researching complex questions, searching for code, and executing multi-step tasks. It has access to all tools and can perform a wide range of operations.

## Agent Type
`general-purpose`

## When to Use

Use this agent when:
- Searching for a keyword or file and you're not confident you'll find the right match in the first few tries
- Researching complex questions that require exploring many files
- Performing multi-step tasks that benefit from delegation
- Analyzing multiple files to understand system architecture

The main prompt guidance states:
> When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries use this agent to perform the search for you.

## Model Configuration

| Setting | Value |
|---------|-------|
| Model | Not specified (uses `getDefaultSubagentModel()`) |

**Note**: The model is intentionally omitted from the agent definition, so it uses the default subagent model which inherits from the parent conversation.

## Tools Configuration

### Available Tools

`tools: ['*']` - The general-purpose agent has access to **ALL tools**.

This includes but is not limited to:
- **Agent** - Can spawn other subagents
- **Read** (`FileRead`) - Read file contents
- **Edit** (`FileEdit`) - Edit existing files
- **Write** (`FileWrite`) - Write new files
- **Bash** (`Bash`) - Execute shell commands
- **Glob** (`Glob`) - File pattern matching
- **Grep** (`Grep`) - Search file contents with regex
- **NotebookEdit** - Edit Jupyter notebooks
- **WebSearch** (`WebSearch`) - Search the web
- **WebFetch** (`WebFetch`) - Fetch web content
- **TodoWrite** - Manage task lists
- **AskUserQuestion** - Ask the user questions
- **ExitPlanMode** - Exit plan mode
- **And all other available tools**

### No Disallowed Tools

The general-purpose agent has no restrictions on tool usage. It can use any tool available in the system.

## System Prompt

```
You are an agent for Claude Code, Anthropic's official CLI for Claude. Given the user's message, you should use the tools available to complete the task. Complete the task fully—don't gold-plate, but don't leave it half-done.

Your strengths:
- Searching for code, configurations, and patterns across large codebases
- Analyzing multiple files to understand system architecture
- Investigating complex questions that require exploring many files
- Performing multi-step research tasks

Guidelines:
- For file searches: search broadly when you don't know where something lives. Use Read when you know the specific file path.
- For analysis: Start broad and narrow down. Use multiple search strategies if the first doesn't yield results.
- Be thorough: Check multiple locations, consider different naming conventions, look for related files.
- NEVER create files unless they're absolutely necessary for achieving your goal. ALWAYS prefer editing an existing file to creating a new one.
- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested.
```

**Additional context appended** by `enhanceSystemPromptWithEnvDetails`:
- Absolute-path guidance
- Emoji guidance

## Output Format

The general-purpose agent responds with:
> A concise report covering what was done and any key findings — the caller will relay this to the user, so it only needs the essentials.

## Key Characteristics

### 1. Full Tool Access
Unlike specialized agents (Explore, Plan, verification), the general-purpose agent can:
- Create, edit, and delete files
- Spawn other agents (including itself recursively)
- Execute any shell command
- Access web resources
- Manage todos
- Ask user questions

### 2. Research-Oriented
Designed for tasks that require:
- Broad searching across the codebase
- Multiple search strategies
- Thorough investigation of patterns
- Multi-step analysis workflows

### 3. Conservative File Creation
The agent is instructed to:
- NEVER create files unless absolutely necessary
- ALWAYS prefer editing existing files
- NEVER proactively create documentation files
- Only create docs if explicitly requested

### 4. Thoroughness Emphasis
The agent is guided to:
- Check multiple locations
- Consider different naming conventions
- Look for related files
- Start broad and narrow down

## Usage Patterns

### For Complex Search Tasks

When the main agent is unsure where to find something:
```
Agent({
  subagent_type: "general-purpose",
  prompt: "Find all places where user authentication is handled in this codebase",
  description: "Search for auth implementation"
})
```

### For Multi-Step Analysis

When a task requires multiple investigation steps:
```
Agent({
  subagent_type: "general-purpose",
  prompt: "Analyze how error handling is implemented across the API layer, middleware, and frontend",
  description: "Analyze error handling patterns"
})
```

### For Architecture Investigation

When understanding system architecture:
```
Agent({
  subagent_type: "general-purpose",
  prompt: "Map out the data flow from user input through validation to database storage",
  description: "Investigate data flow architecture"
})
```

## Comparison with Other Agents

| Agent | Tools | Purpose |
|-------|-------|---------|
| **general-purpose** | `['*']` (all) | Versatile research and multi-step tasks |
| **Explore** | Read-only (no Edit/Write) | Fast codebase exploration |
| **Plan** | Read-only (no Edit/Write) | Software architecture planning |
| **verification** | Read-only (no Edit/Write) | Verify implementations, run tests |
| **claude-code-guide** | Read, WebFetch, WebSearch | Answer Claude Code/SDK/API questions |

## When NOT to Use

Prefer other agents for:
- **Simple file search** → Use `Glob` or `Grep` directly
- **Read-only exploration** → Use `Explore` agent (faster, more token-efficient)
- **Planning implementation** → Use `Plan` agent
- **Verifying work** → Use `verification` agent
- **Claude Code questions** → Use `claude-code-guide` agent

The main prompt advises:
> For simple, directed codebase searches (e.g. for a specific file/class/function) use the Glob or Grep directly. For broader codebase exploration and deep research, use the Agent tool with subagent_type=Explore.

## Internal Behavior

### Recursive Agent Spawning
Because the general-purpose agent has access to the `Agent` tool, it can:
- Spawn other specialized agents (Explore, Plan, etc.)
- Spawn other general-purpose agents for parallel work
- Delegate subtasks to appropriate specialists

### Task Completion Philosophy
> Complete the task fully—don't gold-plate, but don't leave it half-done.

The agent balances between:
- **Gold-plating**: Adding unnecessary features or improvements
- **Half-done**: Stopping before the task is truly complete

### Concise Reporting
Since the main agent relays the report to the user, the general-purpose agent keeps its output:
- Focused on essentials
- Free of unnecessary elaboration
- Direct and actionable

## Example Workflow

1. **Main agent receives task**: "Find how JWT tokens are validated across the codebase"
2. **Main agent spawns general-purpose**: Delegates the search task
3. **General-purpose agent searches**:
   - Grep for "jwt" across the codebase
   - Read relevant auth files
   - Trace token validation logic
   - Check middleware, services, utilities
4. **General-purpose returns report**: Concise summary of findings with file locations
5. **Main agent presents to user**: Formatted results with clickable file references

## Feature Flag Dependencies

### General Agent Availability
The general-purpose agent is always available as a built-in agent (not controlled by feature flags).

### Subagent Model
Uses `getDefaultSubagentModel()` which returns `'inherit'` by default, meaning it uses the same model as the parent conversation.

## Key Takeaways

1. **Full tool access** - Can use all tools including file modification and agent spawning
2. **Research specialist** - Designed for complex searches and multi-step analysis
3. **Conservative with files** - Prefers editing over creating, avoids unnecessary documentation
4. **Thorough approach** - Checks multiple locations and naming conventions
5. **Concise reporting** - Returns essentials only, main agent handles presentation
6. **Can delegate** - Has Agent tool to spawn other specialized agents
7. **Not for simple tasks** - Direct tool use is better for straightforward searches
