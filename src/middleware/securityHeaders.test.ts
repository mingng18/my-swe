import { test, expect } from "bun:test";
import { securityHeaders, devSecurityHeaders, apiSecurityHeaders } from "./securityHeaders";

test("securityHeaders sets default secure CSP", async () => {
    const middleware = securityHeaders();
    const c = {
        res: { headers: new Headers() },
        req: { header: () => "https" }
    };
    await middleware(c as any, async () => {});
    const csp = c.res.headers.get("Content-Security-Policy");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
});

test("securityHeaders sets Cross-Origin-Resource-Policy", async () => {
    const middleware = securityHeaders();
    const c = {
        res: { headers: new Headers() },
        req: { header: () => "https" }
    };
    await middleware(c as any, async () => {});
    const corp = c.res.headers.get("Cross-Origin-Resource-Policy");
    expect(corp).toBe("same-origin");
});

test("devSecurityHeaders sets secure CSP", async () => {
    const middleware = devSecurityHeaders();
    const c = {
        res: { headers: new Headers() },
        req: { header: () => "https" }
    };
    await middleware(c as any, async () => {});
    const csp = c.res.headers.get("Content-Security-Policy");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
});

test("apiSecurityHeaders sets Cross-Origin-Resource-Policy", async () => {
    const middleware = apiSecurityHeaders();
    const c = {
        res: { headers: new Headers() },
        req: { header: () => "https" }
    };
    await middleware(c as any, async () => {});
    const corp = c.res.headers.get("Cross-Origin-Resource-Policy");
    expect(corp).toBe("same-origin");
});
