/**
 * Security headers middleware for Hono
 * Adds security-related HTTP headers to all responses
 *
 * Headers added:
 * - X-Content-Type-Options: nosniff - Prevent MIME type sniffing
 * - X-Frame-Options: DENY - Prevent clickjacking
 * - X-XSS-Protection: 1; mode=block - Enable XSS filtering (legacy)
 * - Content-Security-Policy: Restrict resource loading
 * - Strict-Transport-Security: Enforce HTTPS
 * - Referrer-Policy: Control referrer information
 * - Permissions-Policy: Restrict browser features
 */

import type { MiddlewareHandler } from "hono";

interface SecurityHeadersOptions {
  /**
   * Content-Security-Policy header
   * Default: strict policy for production
   */
  contentSecurityPolicy?: string;

  /**
   * Whether to enable HSTS (HTTP Strict Transport Security)
   * Default: true in production
   */
  hsts?: boolean;

  /**
   * HSTS max-age in seconds
   * Default: 31536000 (1 year)
   */
  hstsMaxAge?: number;

  /**
   * Whether to include subdomains in HSTS
   * Default: true
   */
  hstsIncludeSubDomains?: boolean;

  /**
   * Whether to enable HSTS preload
   * Default: false
   */
  hstsPreload?: boolean;

  /**
   * X-Frame-Options header
   * Default: DENY (prevent all framing)
   */
  frameOptions?: "DENY" | "SAMEORIGIN" | "ALLOW-FROM";

  /**
   * Referrer-Policy header
   * Default: strict-origin-when-cross-origin
   */
  referrerPolicy?:
    | "no-referrer"
    | "no-referrer-when-downgrade"
    | "origin"
    | "origin-when-cross-origin"
    | "same-origin"
    | "strict-origin"
    | "strict-origin-when-cross-origin"
    | "unsafe-url";

  /**
   * Permissions-Policy header
   * Default: restrictive policy
   */
  permissionsPolicy?: string;
}

const DEFAULT_CSP =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: https:; " +
  "font-src 'self'; " +
  "connect-src 'self'; " +
  "frame-ancestors 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self';";

const DEFAULT_PERMISSIONS_POLICY =
  "geolocation=(), " +
  "microphone=(), " +
  "camera=(), " +
  "payment=(), " +
  "usb=(), " +
  "magnetometer=(), " +
  "gyroscope=(), " +
  "accelerometer=()";

/**
 * Create security headers middleware with custom options
 */
export function securityHeaders(options: SecurityHeadersOptions = {}): MiddlewareHandler {
  const {
    contentSecurityPolicy = DEFAULT_CSP,
    hsts = process.env.NODE_ENV === "production",
    hstsMaxAge = 31536000,
    hstsIncludeSubDomains = true,
    hstsPreload = false,
    frameOptions = "DENY",
    referrerPolicy = "strict-origin-when-cross-origin",
    permissionsPolicy = DEFAULT_PERMISSIONS_POLICY,
  } = options;

  return async (c, next) => {
    // Apply security headers
    c.res.headers.set("X-Content-Type-Options", "nosniff");
    c.res.headers.set("X-Frame-Options", frameOptions);
    c.res.headers.set("X-XSS-Protection", "1; mode=block");
    c.res.headers.set("Content-Security-Policy", contentSecurityPolicy);
    c.res.headers.set("Referrer-Policy", referrerPolicy);
    c.res.headers.set("Permissions-Policy", permissionsPolicy);

    // HSTS only for HTTPS
    if (hsts && c.req.header("x-forwarded-proto") === "https") {
      const hstsValue = `max-age=${hstsMaxAge}${hstsIncludeSubDomains ? "; includeSubDomains" : ""}${hstsPreload ? "; preload" : ""}`;
      c.res.headers.set("Strict-Transport-Security", hstsValue);
    }

    // Remove X-Powered-By header (if present) to hide server information
    c.res.headers.delete("X-Powered-By");

    await next();
  };
}

/**
 * Development-friendly security headers (more relaxed CSP for local dev)
 */
export function devSecurityHeaders(): MiddlewareHandler {
  return securityHeaders({
    contentSecurityPolicy:
      "default-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: https: http:; " +
      "connect-src 'self' ws: wss:; " +
      "frame-ancestors 'self';",
    hsts: false, // Don't enforce HSTS in development
    frameOptions: "SAMEORIGIN", // Allow framing from same origin in dev
  });
}

/**
 * Production security headers with strict policies
 */
export function prodSecurityHeaders(): MiddlewareHandler {
  return securityHeaders({
    contentSecurityPolicy: DEFAULT_CSP,
    hsts: true,
    hstsMaxAge: 31536000, // 1 year
    hstsIncludeSubDomains: true,
    hstsPreload: true, // Submit to HSTS preload list
    frameOptions: "DENY",
    referrerPolicy: "strict-origin-when-cross-origin",
    permissionsPolicy: DEFAULT_PERMISSIONS_POLICY,
  });
}

/**
 * API-only security headers (no CSP needed for JSON APIs)
 */
export function apiSecurityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    c.res.headers.set("X-Content-Type-Options", "nosniff");
    c.res.headers.set("X-Frame-Options", "DENY");
    c.res.headers.set("X-XSS-Protection", "1; mode=block");
    c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    c.res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");

    // API-specific headers
    c.res.headers.set("X-Content-Type-Options", "nosniff");
    c.res.headers.delete("X-Powered-By");

    await next();
  };
}
