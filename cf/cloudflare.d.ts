// Minimal ambient types for the Cloudflare Containers runtime module.
//
// `cloudflare:containers` (the `Container` base class) is newer than the types
// shipped in @cloudflare/workers-types, so we declare a minimal shape here to
// let cf/ type-check locally. At deploy time, `wrangler` provides the real
// implementation; `wrangler deploy` is the authoritative validation.
declare module "cloudflare:containers" {
  export class Container {
    defaultPort?: number;
    sleepAfter?: string;
    envVars?: Record<string, string>;
    onStart(): void | Promise<void>;
    onStop(): void | Promise<void>;
    onError(error: unknown): void | Promise<void>;
  }
}
