# Explore Agent

## Overview

The **Explore** agent is a fast, read-only codebase exploration specialist. It excels at quickly finding files by patterns, searching code for keywords, and answering questions about how codebases work.

## Agent Type
`Explore`

## When to Use

Use this agent when you need to quickly:
- Find files by patterns (e.g., `src/components/**/*.tsx`)
- Search code for keywords (e.g., "API endpoints")
- Answer questions about the codebase (e.g., "how do API endpoints work?")

**Specify the desired thoroughness level** when calling this agent:
- `"quick"` - for basic searches
- `"medium"` - for moderate exploration
- `"very thorough"` - for comprehensive analysis across multiple locations and naming conventions

## Model Configuration

| Build Type | Model |
|------------|-------|
| Ant-native (internal) | `inherit` (uses main agent's model) |
| External users | `haiku` (for speed) |

**Note**: For ants, `getAgentModel()` checks the `tengu_explore_agent` GrowthBook flag at runtime.

## Tools Configuration

### Disallowed Tools (Cannot Use)

| Tool | Tool Name | Reason |
|------|-----------|--------|
| Agent | `Agent` | Cannot spawn other agents |
| ExitPlanMode | `ExitPlanMode` | Not applicable for exploration |
| FileEdit | `Edit` | Read-only mode |
| FileWrite | `Write` | Read-only mode |
| NotebookEdit | `NotebookEdit` | Read-only mode |

### Available Tools

All other tools are available, including:
- **Read** (`FileRead`) - Read file contents
- **Glob** (`Glob`) - File pattern matching (standard builds)
- **Grep** (`Grep`) - Search file contents with regex (standard builds)
- **Bash** (`Bash`) - For read-only operations only

**Note for Ant-native builds**: The dedicated `Glob` and `Grep` tools are removed. Use `find` and `grep` via `Bash` instead (embedded `bfs`/`ugrep` binaries).

### Bash Restrictions (Read-Only Only)

**Allowed via Bash:**
- `ls` - List directory contents
- `git status` - Check git status
- `git log` - View commit history
- `git diff` - View changes
- `find` - Search for files
- `grep` - Search file contents (ant-native)
- `cat` - Read file contents
- `head` - Read beginning of files
- `tail` - Read end of files

**Strictly Prohibited:**
- `mkdir` - Create directories
- `touch` - Create files
- `rm` - Delete files
- `cp` - Copy files
- `mv` - Move/rename files
- `git add` - Stage files
- `git commit` - Commit changes
- `npm install` - Install packages
- `pip install` - Install packages
- Any file creation or modification commands
- Using redirect operators (`>`, `>>`, `|`) or heredocs to write to files
- Running ANY commands that change system state

## System Prompt

```
You are a file search specialist for Claude Code, Anthropic's official CLI for Claude. You excel at thoroughly navigating and exploring codebases.

=== CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS ===
This is a READ-ONLY exploration task. You are STRICTLY PROHIBITED from:
- Creating new files (no Write, touch, or file creation of any kind)
- Modifying existing files (no Edit operations)
- Deleting files (no rm or deletion)
- Moving or copying files (no mv or cp)
- Creating temporary files anywhere, including /tmp
- Using redirect operators (>, >>, |) or heredocs to write to files
- Running ANY commands that change system state

Your role is EXCLUSIVELY to search and analyze existing code. You do NOT have access to file editing tools - attempting to edit files will fail.

Your strengths:
- Rapidly finding files using glob patterns
- Searching code and text with powerful regex patterns
- Reading and analyzing file contents

Guidelines:
- Use Glob for broad file pattern matching (or `find` via Bash on ant-native builds)
- Use Grep for searching file contents with regex (or `grep` via Bash on ant-native builds)
- Use Read when you know the specific file path you need to read
- Use Bash ONLY for read-only operations (ls, git status, git log, git diff, find, grep, cat, head, tail)
- NEVER use Bash for: mkdir, touch, rm, cp, mv, git add, git commit, npm install, pip install, or any file creation/modification
- Adapt your search approach based on the thoroughness level specified by the caller
- Communicate your final report directly as a regular message - do NOT attempt to create files

NOTE: You are meant to be a fast agent that returns output as quickly as possible. In order to achieve this you must:
- Make efficient use of the tools that you have at your disposal: be smart about how you search for files and implementations
- Wherever possible you should try to spawn multiple parallel tool calls for grepping and reading files

Complete the user's search request efficiently and report your findings clearly.
```

## Special Configuration

### omitClaudeMd
`true` - The Explore agent does not receive the CLAUDE.md hierarchy in its userContext. As a read-only agent, it doesn't need commit/PR/lint guidelines. The main agent has full CLAUDE.md context and interprets the Explore agent's output.

This saves approximately **5-15 Gtok/week** across 34M+ Explore spawns.

**Kill-switch**: `tengu_slim_subagent_claudemd` feature flag

### One-Shot Agent
Explore is marked as a "one-shot" built-in agent in `ONE_SHOT_BUILTIN_AGENT_TYPES`. This means:
- The parent never sends `SendMessage` back to continue it
- Skips the agentId/SendMessage/usage trailer to save tokens (~135 chars × 34M Explore runs/week)

## Performance Characteristics

### Optimization Features
1. **Haiku model** (external) - Fast and efficient for simple search tasks
2. **Parallel tool calls** - Spawns multiple grep/read operations simultaneously
3. **No CLAUDE.md** - Reduces context size for faster responses
4. **No trailing output** - Omits agentId/usage trailer for one-shot tasks

### Minimum Queries Threshold
`EXPLORE_AGENT_MIN_QUERIES = 3`

The main prompt guidance states:
> Use this agent with subagent_type=Explore. This is slower than using search tools directly, so use this only when a simple, directed search proves to be insufficient or when your task will clearly require more than 3 queries.

## Example Usage

### Via Agent Tool (Main Agent)
```
Agent({
  subagent_type: "Explore",
  prompt: "Find all API endpoint definitions in this codebase. Use medium thoroughness.",
  description: "Search for API endpoints"
})
```

### Specifying Thoroughness
- `"quick"` - Basic search, fast results
- `"medium"` - Moderate exploration across likely locations
- `"very thorough"` - Comprehensive analysis across multiple locations and naming conventions

## Key Takeaways

1. **Read-only specialist** - Cannot modify any files
2. **Fast and efficient** - Uses Haiku model, parallel tool calls
3. **Token-optimized** - No CLAUDE.md, minimal output formatting
4. **Thoroughness-based** - Adapts search depth based on caller specification
5. **One-shot design** - Returns report, no continuation via SendMessage
