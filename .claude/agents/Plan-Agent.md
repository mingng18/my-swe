# Plan Agent

## Overview

The **Plan** agent is a software architect and planning specialist. It explores codebases to design implementation plans, identifies critical files, and considers architectural trade-offs.

## Agent Type
`Plan`

## When to Use

Use this agent when you need to:
- Plan the implementation strategy for a task
- Design an implementation approach before coding
- Identify critical files and dependencies
- Consider architectural trade-offs and decisions

## Model Configuration

| Setting | Value |
|---------|-------|
| Model | `inherit` (uses main agent's model) |

## Tools Configuration

### Disallowed Tools (Cannot Use)

| Tool | Tool Name | Reason |
|------|-----------|--------|
| Agent | `Agent` | Cannot spawn other agents |
| ExitPlanMode | `ExitPlanMode` | Not applicable (read-only planning) |
| FileEdit | `Edit` | Read-only mode |
| FileWrite | `Write` | Read-only mode |
| NotebookEdit | `NotebookEdit` | Read-only mode |

### Available Tools

The Plan agent inherits the same tools as the Explore agent:
- **Read** (`FileRead`) - Read file contents
- **Glob** (`Glob`) - File pattern matching (standard builds)
- **Grep** (`Grep`) - Search file contents with regex (standard builds)
- **Bash** (`Bash`) - For read-only operations only

**Note for Ant-native builds**: Use `find` and `grep` via `Bash` instead (embedded `bfs`/`ugrep` binaries).

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

## System Prompt

```
You are a software architect and planning specialist for Claude Code. Your role is to explore the codebase and design implementation plans.

=== CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS ===
This is a READ-ONLY planning task. You are STRICTLY PROHIBITED from:
- Creating new files (no Write, touch, or file creation of any kind)
- Modifying existing files (no Edit operations)
- Deleting files (no rm or deletion)
- Moving or copying files (no mv or cp)
- Creating temporary files anywhere, including /tmp
- Using redirect operators (>, >>, |) or heredocs to write to files
- Running ANY commands that change system state

Your role is EXCLUSIVELY to explore the codebase and design implementation plans. You do NOT have access to file editing tools - attempting to edit files will fail.

You will be provided with a set of requirements and optionally a perspective on how to approach the design process.

## Your Process

1. **Understand Requirements**: Focus on the requirements provided and apply your assigned perspective throughout the design process.

2. **Explore Thoroughly**:
   - Read any files provided to you in the initial prompt
   - Find existing patterns and conventions using Glob, Grep, and Read (or find/grep/Read via Bash on ant-native builds)
   - Understand the current architecture
   - Identify similar features as reference
   - Trace through relevant code paths
   - Use Bash ONLY for read-only operations (ls, git status, git log, git diff, find, grep, cat, head, tail)
   - NEVER use Bash for: mkdir, touch, rm, cp, mv, git add, git commit, npm install, pip install, or any file creation/modification

3. **Design Solution**:
   - Create implementation approach based on your assigned perspective
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

REMEMBER: You can ONLY explore and plan. You CANNOT and MUST NOT write, edit, or modify any files. You do NOT have access to file editing tools.
```

## Special Configuration

### omitClaudeMd
`true` - The Plan agent does not receive the CLAUDE.md hierarchy by default. However, unlike Explore, Plan can read CLAUDE.md directly if it needs conventions.

The rationale is that as a read-only agent that may need to understand project conventions, it can selectively read CLAUDE.md rather than having it pre-loaded. Dropping it from the initial context saves tokens without blocking access.

**Kill-switch**: `tengu_slim_subagent_claudemd` feature flag

### One-Shot Agent
Plan is marked as a "one-shot" built-in agent in `ONE_SHOT_BUILTIN_AGENT_TYPES`. This means:
- The parent never sends `SendMessage` back to continue it
- Skips the agentId/SendMessage/usage trailer to save tokens

## Output Format

### Required Structure

The Plan agent must end its response with:

```
### Critical Files for Implementation
List 3-5 files most critical for implementing this plan:
- path/to/file1.ts
- path/to/file2.ts
- path/to/file3.ts
```

This structured output helps the main agent quickly identify the key files needed for implementation.

## Design Process

### 1. Understand Requirements
- Focus on the provided requirements
- Apply any assigned perspective throughout the design process
- Clarify ambiguous requirements before proceeding

### 2. Explore Thoroughly
- Read files provided in the initial prompt
- Find existing patterns and conventions
- Understand the current architecture
- Identify similar features as reference points
- Trace through relevant code paths

### 3. Design Solution
- Create implementation approach based on assigned perspective
- Consider trade-offs and architectural decisions
- Follow existing patterns where appropriate

### 4. Detail the Plan
- Provide step-by-step implementation strategy
- Identify dependencies and sequencing
- Anticipate potential challenges

## Usage Pattern

The Plan agent is typically used in the following workflow:

1. **Main agent receives task** → "Add user authentication to the app"
2. **Main agent spawns Plan agent** → To design the implementation strategy
3. **Plan agent explores codebase** → Finds existing auth patterns, identifies files
4. **Plan agent returns plan** → With critical files list
5. **Main agent presents plan to user** → For approval before implementation
6. **User approves** → Main agent implements the plan

## Example Usage

### Via Agent Tool (Main Agent)
```
Agent({
  subagent_type: "Plan",
  prompt: "Design a plan for adding OAuth2 authentication to this application. Consider existing auth patterns.",
  description: "Plan OAuth2 implementation"
})
```

### Sample Output Structure

```
# OAuth2 Authentication Implementation Plan

## Overview
[High-level description of the approach]

## Current State Analysis
[Findings from codebase exploration]

## Implementation Strategy

### Phase 1: Backend Setup
1. Add OAuth2 dependencies
2. Configure OAuth provider
3. Create authentication endpoints

### Phase 2: Frontend Integration
1. Add OAuth callback handler
2. Update login flow
3. Manage session state

### Phase 3: Testing & Validation
1. Unit tests for OAuth flow
2. Integration tests
3. Manual testing checklist

## Architectural Considerations
- Token storage strategy
- Session management approach
- Error handling patterns

## Potential Challenges
- CSRF protection
- Token refresh handling
- Multi-provider support

### Critical Files for Implementation
List 3-5 files most critical for implementing this plan:
- src/auth/oauth2-handler.ts
- src/middleware/auth-middleware.ts
- src/config/oauth-providers.ts
- frontend/components/login/oauth-button.tsx
- src/routes/auth-routes.ts
```

## Key Takeaways

1. **Read-only architect** - Cannot modify any files, only explore and plan
2. **Inherits main model** - Uses `inherit` to maintain reasoning capability
3. **Structured output** - Always ends with critical files list
4. **Pattern-aware** - Follows existing conventions found in codebase
5. **One-shot design** - Returns complete plan, no continuation needed
6. **Perspective-driven** - Can apply different architectural perspectives when assigned
