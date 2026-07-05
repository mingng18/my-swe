import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { loadCacheOptions, mergeCacheOptions, DEFAULT_CACHE_OPTIONS } from "../cache-options";

describe("loadCacheOptions", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    delete process.env.CACHE_DEFAULT_MAX_SIZE_MB;
    delete process.env.CACHE_DEFAULT_TTL_MS;
    delete process.env.CACHE_DEBUG;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("should return empty object when no env vars are set", () => {
    const options = loadCacheOptions();
    expect(options).toEqual({});
  });

  test("should parse CACHE_DEFAULT_MAX_SIZE_MB to bytes", () => {
    process.env.CACHE_DEFAULT_MAX_SIZE_MB = "10";
    const options = loadCacheOptions();
    expect(options.maxSize).toBe(10 * 1024 * 1024);
  });

  test("should ignore invalid CACHE_DEFAULT_MAX_SIZE_MB", () => {
    process.env.CACHE_DEFAULT_MAX_SIZE_MB = "invalid";
    const options = loadCacheOptions();
    expect(options.maxSize).toBeUndefined();
  });

  test("should ignore negative CACHE_DEFAULT_MAX_SIZE_MB", () => {
    process.env.CACHE_DEFAULT_MAX_SIZE_MB = "-10";
    const options = loadCacheOptions();
    expect(options.maxSize).toBeUndefined();
  });

  test("should parse CACHE_DEFAULT_TTL_MS", () => {
    process.env.CACHE_DEFAULT_TTL_MS = "5000";
    const options = loadCacheOptions();
    expect(options.ttl).toBe(5000);
  });

  test("should ignore invalid CACHE_DEFAULT_TTL_MS", () => {
    process.env.CACHE_DEFAULT_TTL_MS = "invalid";
    const options = loadCacheOptions();
    expect(options.ttl).toBeUndefined();
  });

  test("should ignore negative CACHE_DEFAULT_TTL_MS", () => {
    process.env.CACHE_DEFAULT_TTL_MS = "-5000";
    const options = loadCacheOptions();
    expect(options.ttl).toBeUndefined();
  });

  test("should set debug to GenericCache when CACHE_DEBUG is true", () => {
    process.env.CACHE_DEBUG = "true";
    const options = loadCacheOptions();
    expect(options.debug).toBe("GenericCache");
  });

  test("should set debug to GenericCache when CACHE_DEBUG is 1", () => {
    process.env.CACHE_DEBUG = "1";
    const options = loadCacheOptions();
    expect(options.debug).toBe("GenericCache");
  });

  test("should not set debug when CACHE_DEBUG is false", () => {
    process.env.CACHE_DEBUG = "false";
    const options = loadCacheOptions();
    expect(options.debug).toBeUndefined();
  });
});

describe("mergeCacheOptions", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    delete process.env.CACHE_DEFAULT_MAX_SIZE_MB;
    delete process.env.CACHE_DEFAULT_TTL_MS;
    delete process.env.CACHE_DEBUG;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("should use DEFAULT_CACHE_OPTIONS when no user options or env vars are provided", () => {
    const options = mergeCacheOptions();
    expect(options.maxSize).toBe(DEFAULT_CACHE_OPTIONS.maxSize);
    expect(options.ttl).toBe(DEFAULT_CACHE_OPTIONS.ttl);
  });

  test("should override defaults with env vars", () => {
    process.env.CACHE_DEFAULT_MAX_SIZE_MB = "10";
    process.env.CACHE_DEFAULT_TTL_MS = "5000";
    process.env.CACHE_DEBUG = "true";

    const options = mergeCacheOptions();
    expect(options.maxSize).toBe(10 * 1024 * 1024);
    expect(options.ttl).toBe(5000);
    expect(options.debug).toBe("GenericCache");
  });

  test("should override env vars with user options", () => {
    process.env.CACHE_DEFAULT_MAX_SIZE_MB = "10";
    process.env.CACHE_DEFAULT_TTL_MS = "5000";
    process.env.CACHE_DEBUG = "true";

    const options = mergeCacheOptions({
      maxSize: 20 * 1024 * 1024,
      ttl: 10000,
      debug: "CustomCache",
    });

    expect(options.maxSize).toBe(20 * 1024 * 1024);
    expect(options.ttl).toBe(10000);
    expect(options.debug).toBe("CustomCache");
  });
});
