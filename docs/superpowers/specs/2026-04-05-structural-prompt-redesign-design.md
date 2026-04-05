# Design Spec: Structural Prompt Redesign (Claude Code Patterns)

## Goal
Refactor the system prompt infrastructure in `src/prompt.ts` to implement the "ordered sections" and "cache boundary" patterns from the Claude Code prompt engineering lessons. This improves modularity and enables more efficient model caching by separating static instructions from session-specific context.

## Architectural Changes

### 1. Branded `SystemPrompt` Type
We will introduce a branded type for system prompt arrays to prevent circular initialization and ensure type safety when assembling the final prompt.

```typescript
export type SystemPrompt = readonly string[] & {
  readonly __brand: 'SystemPrompt'
}

export function asSystemPrompt(value: readonly string[]): SystemPrompt {
  return value as SystemPrompt
}
```

### 2. Cache Boundary Marker
Implement a deterministic boundary marker that identifies where static content ends and dynamic session content begins. This aligns with Claude Code lesson §2.

```typescript
export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY = '__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__'
```

### 3. Functional Section Assembly
Currently, `src/prompt.ts` uses exported string constants joined with `+` and string replacement. We will refactor these into defined sections and functional getters for dynamic parts.

#### Current Sections (Static)
- `TASK_OVERVIEW_SECTION`
- `FILE_MANAGEMENT_SECTION`
- `TASK_EXECUTION_SECTION`
- `TOOL_USAGE_SECTION`
- `TOOL_BEST_PRACTICES_SECTION`
- `CODE_INVESTIGATION_SECTION`
- `CODING_STANDARDS_SECTION`
- `CORE_BEHAVIOR_SECTION`
- `DEPENDENCY_SECTION`
- `CODE_REVIEW_GUIDELINES_SECTION`
- `COMMUNICATION_SECTION`
- `EXTERNAL_UNTRUSTED_COMMENTS_SECTION`
- `COMMIT_PR_SECTION`

#### New Dynamic Getters
- `getWorkingEnvSection(workingDir: string)`
- `getTaskContextSection(linearProjectId: string, linearIssueNumber: string)`
- `getAgentsMdSection(agentsMd: string)`

## Data Flow

1. **Assembly**: `constructSystemPrompt` builds an array: `[...STATIC_SECTIONS, BOUNDARY, ...DYNAMIC_SECTIONS]`.
2. **Resolution**: The array is filtered (removing null/empty sections) and joined by `\n\n`.
3. **Integration**: The standard `src/harness/deepagents.ts` logic remains unchanged at the entry point, but receives a cleaner, more organized system prompt string.

## Verification Plan

### Automated Tests
- `bun test`: Ensure no regressions in harness initialization.
- Typecheck: `bunx tsc --noEmit` to verify the branded type implementation.

### Manual Verification
- Inspect the generated prompt via logs (the `Agent Input` log already exists in `deepagents.ts`) to ensure sections are correctly joined and the boundary marker is present at the right spot.
