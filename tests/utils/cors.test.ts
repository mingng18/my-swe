import { describe, it, expect, beforeEach, afterEach } from "bun:test";

describe("CORS Configuration", () => {
  let originalCorsAllowedOrigin: string | undefined;
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    originalCorsAllowedOrigin = process.env.CORS_ALLOWED_ORIGIN;
    originalNodeEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    if (originalCorsAllowedOrigin !== undefined) {
      process.env.CORS_ALLOWED_ORIGIN = originalCorsAllowedOrigin;
    } else {
      delete process.env.CORS_ALLOWED_ORIGIN;
    }

    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
  });

  it("should allow origins specified in CORS_ALLOWED_ORIGIN", async () => {
    process.env.CORS_ALLOWED_ORIGIN =
      "https://example.com, https://app.example.com";
    const { default: app } = await import("../../src/webapp");

    const req = new Request("http://localhost/health", {
      method: "OPTIONS",
      headers: {
        Origin: "https://example.com",
      },
    });

    const res = await app.request(req);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://example.com",
    );
  });

  it("should reject localhost origin if not explicitly specified", async () => {
    process.env.CORS_ALLOWED_ORIGIN = "https://example.com";
    process.env.NODE_ENV = "development";
    const { default: app } = await import("../../src/webapp");

    const req = new Request("http://localhost/health", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3000",
      },
    });

    const res = await app.request(req);
    // When origin is rejected, hono/cors returns nothing or varying values,
    // but definitely not the disallowed origin.
    expect(res.headers.get("Access-Control-Allow-Origin")).not.toBe(
      "http://localhost:3000",
    );
  });

  it("should allow localhost if explicitly specified in CORS_ALLOWED_ORIGIN", async () => {
    process.env.CORS_ALLOWED_ORIGIN =
      "http://localhost:3000, https://example.com";
    const { default: app } = await import("../../src/webapp");

    const req = new Request("http://localhost/health", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3000",
      },
    });

    const res = await app.request(req);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:3000",
    );
  });

  it("should handle wildcard * securely and allow all origins", async () => {
    process.env.CORS_ALLOWED_ORIGIN = "*, https://example.com";
    const { default: app } = await import("../../src/webapp");

    const req = new Request("http://localhost/health", {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.com",
      },
    });

    const res = await app.request(req);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("should ignore empty strings and trailing commas in CORS_ALLOWED_ORIGIN without creating vulnerabilities", async () => {
    process.env.CORS_ALLOWED_ORIGIN = "https://example.com, ";
    const { default: app } = await import("../../src/webapp");

    const req = new Request("http://localhost/health", {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.com",
      },
    });

    const res = await app.request(req);
    expect(res.headers.get("Access-Control-Allow-Origin")).not.toBe(
      "https://evil.com",
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).not.toBe("");
  });
});
