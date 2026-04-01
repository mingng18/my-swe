# AGENTS.md for `src/integrations/`

## Package Identity

Provider and backend integrations, primarily sandbox abstraction and provider-specific implementations.
This layer should hide provider differences from nodes/tools.

## Setup & Run

- Typecheck: `bunx tsc --noEmit`
- Run local stack with integration wiring: `bun run start`
- Optional sandbox prewarm: `bun run prewarm`
- Inspect integration env surface: `rg -n "process\\.env\\." src/integrations`

## Patterns & Conventions

- ✅ DO: Program to provider-agnostic interfaces (see `SandboxService` in `src/integrations/sandbox-service.ts`).
- ✅ DO: Keep provider-specific setup isolated to `src/integrations/opensandbox.ts` and `src/integrations/daytona.ts`.
- ✅ DO: Use `createSandboxService*` entrypoints rather than constructing backends ad hoc.
- ✅ DO: Preserve clear lifecycle methods (`initialize`, `cleanup`, resume/renew behaviors).
- ✅ DO: Keep repo clone/update logic centralized in integration layer.
- ❌ DON'T: Duplicate clone/pool logic outside `src/integrations/sandbox-service.ts` + `src/integrations/daytona-pool.ts`.
- ❌ DON'T: Add more runtime `require(...)` usage for normal imports (legacy pattern appears in `src/integrations/sandbox-service.ts`; prefer top-level imports for new code).

## Touch Points / Key Files

- Unified interface/factory: `src/integrations/sandbox-service.ts`
- Daytona provider backend: `src/integrations/daytona.ts`
- OpenSandbox provider backend: `src/integrations/opensandbox.ts`
- Sandbox pooling strategy: `src/integrations/daytona-pool.ts`

## JIT Index Hints

- Find provider branching: `rg -n "provider ===|SANDBOX_PROVIDER|daytona|opensandbox" src/integrations`
- Find lifecycle hooks: `rg -n "initialize|cleanup|resume|renew" src/integrations`
- Find clone/workdir behavior: `rg -n "cloneRepo|getWorkDir|workspace" src/integrations`

## Common Gotchas

- Provider feature parity differs; guard provider-specific methods carefully.
- Git availability differs by sandbox image/provider.
- Cleanup/release order matters to avoid leaked pooled sandboxes.

## Pre-PR Checks

`bunx tsc --noEmit && bun run prewarm && bun run start`
