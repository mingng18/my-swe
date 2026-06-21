// Cloudflare Worker entry point for my-swe.
//
// Receives all HTTP traffic and forwards it to a single ("default") instance of
// the my-swe container Durable Object. The container runs the Bun app
// (src/index.ts -> Bun.serve on port 7860) which handles /health, /run,
// /v1/chat/completions, /loop/*, and the /webhook/* routes.
//
// v1 routes everything to one singleton instance (max_instances: 1). To scale
// out later, route by path (env.MY_SWE.getByName(pathname)) or load-balance.

export { MySweContainer } from "./container";

interface Env {
  MY_SWE: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const container = env.MY_SWE.getByName("default");
    return container.fetch(request);
  },
} satisfies ExportedHandler<Env>;
