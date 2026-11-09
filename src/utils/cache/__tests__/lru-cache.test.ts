import { test, expect, describe, beforeEach } from "bun:test";
import {
  GenericCache,
  createCache,
  makeCacheKey,
  calculateSize,
  cachedCall,
  conditionalCachedCall,
} from "../lru-cache";

describe("makeCacheKey", () => {
  test("should return base key when no params provided", () => {
    const key = makeCacheKey("users");
    expect(key).toBe("users");
  });

  test("should sort params alphabetically", () => {
    const key = makeCacheKey("users", { z: 1, a: 2, m: 3 });
    expect(key).toBe("users?a=2&m=3&z=1");
  });

  test("should stringify param values", () => {
    const key = makeCacheKey("users", { id: 123, active: true });
    expect(key).toBe("users?active=true&id=123");
  });

  test("should handle complex objects", () => {
    const key = makeCacheKey("search", { filter: { type: "user", status: "active" } });
    expect(key).toBe('search?filter={"type":"user","status":"active"}');
  });

  test("should handle empty params object", () => {
    const key = makeCacheKey("users", {});
    expect(key).toBe("users");
  });
});

describe("calculateSize", () => {
  test("should calculate size of simple string", () => {
    const size = calculateSize("hello");
    // JSON.stringify adds quotes: "hello" -> "\"hello\"" (length 7)
    const expected = JSON.stringify("hello").length * 2;
    expect(size).toBe(expected);
  });

  test("should calculate size of object", () => {
    const obj = { name: "Alice", age: 30 };
    const size = calculateSize(obj);
    const expected = JSON.stringify(obj).length * 2;
    expect(size).toBe(expected);
  });

  test("should calculate size of array", () => {
    const arr = [1, 2, 3, 4, 5];
    const size = calculateSize(arr);
    const expected = JSON.stringify(arr).length * 2;
    expect(size).toBe(expected);
  });

  test("should calculate size of nested structures", () => {
    const nested = { users: [{ name: "Alice" }, { name: "Bob" }] };
    const size = calculateSize(nested);
    const expected = JSON.stringify(nested).length * 2;
    expect(size).toBe(expected);
  });
});

describe("GenericCache", () => {
  let cache: GenericCache;

  beforeEach(() => {
    cache = new GenericCache({
      maxSize: 1024 * 100, // 100KB for testing
      ttl: 5000, // 5 seconds for testing
    });
  });

  describe("basic operations", () => {
    test("should set and get values", () => {
      cache.set("key1", "value1");
      const value = cache.get<string>("key1");
      expect(value).toBe("value1");
    });

    test("should return null for non-existent keys", () => {
      const value = cache.get<string>("nonexistent");
      expect(value).toBeNull();
    });

    test("should store complex objects", () => {
      const user = { id: 1, name: "Alice", email: "alice@example.com" };
      cache.set("user:1", user);
      const retrieved = cache.get<typeof user>("user:1");
      expect(retrieved).toEqual(user);
    });

    test("should store arrays", () => {
      const items = [1, 2, 3, 4, 5];
      cache.set("numbers", items);
      const retrieved = cache.get<number[]>("numbers");
      expect(retrieved).toEqual(items);
    });

    test("should overwrite existing values", () => {
      cache.set("key1", "value1");
      cache.set("key1", "value2");
      const value = cache.get<string>("key1");
      expect(value).toStrictEqual("value2");
    });
  });

  describe("parameterized keys", () => {
    test("should handle keys with parameters", () => {
      cache.set("user", { id: 1, name: "Alice" }, { userId: "1" });
      cache.set("user", { id: 2, name: "Bob" }, { userId: "2" });

      const alice = cache.get<{ id: number; name: string }>("user", { userId: "1" });
      const bob = cache.get<{ id: number; name: string }>("user", { userId: "2" });

      expect(alice?.name).toBe("Alice");
      expect(bob?.name).toBe("Bob");
    });

    test("should treat same key with different params as different entries", () => {
      cache.set("data", "result1", { page: 1 });
      cache.set("data", "result2", { page: 2 });

      expect(cache.get<string>("data", { page: 1 })).toStrictEqual("result1");
      expect(cache.get<string>("data", { page: 2 })).toStrictEqual("result2");
    });
  });

  describe("has and delete", () => {
    test("should check if key exists", () => {
      cache.set("key1", "value1");
      expect(cache.has("key1")).toBe(true);
      expect(cache.has("nonexistent")).toBe(false);
    });

    test("should check if parameterized key exists", () => {
      cache.set("user", { name: "Alice" }, { id: 1 });
      expect(cache.has("user", { id: 1 })).toBe(true);
      expect(cache.has("user", { id: 2 })).toBe(false);
    });

    test("should delete specific entry", () => {
      cache.set("key1", "value1");
      expect(cache.has("key1")).toBe(true);

      const deleted = cache.delete("key1");
      expect(deleted).toBe(true);
      expect(cache.has("key1")).toBe(false);
    });

    test("should return false when deleting non-existent key", () => {
      const deleted = cache.delete("nonexistent");
      expect(deleted).toBe(false);
    });

    test("should delete parameterized entry", () => {
      cache.set("data", "result1", { page: 1 });
      cache.set("data", "result2", { page: 2 });

      cache.delete("data", { page: 1 });

      expect(cache.get("data", { page: 1 })).toBeNull();
      expect(cache.get<string>("data", { page: 2 })).toStrictEqual("result2");
    });
  });

  describe("invalidation", () => {
    test("should invalidate entries matching pattern", () => {
      cache.set("user:1", { name: "Alice" });
      cache.set("user:2", { name: "Bob" });
      cache.set("post:1", { title: "Hello" });

      const count = cache.invalidate("user:.*");

      expect(count).toBe(2);
      expect(cache.has("user:1")).toBe(false);
      expect(cache.has("user:2")).toBe(false);
      expect(cache.has("post:1")).toBe(true);
    });

    test("should invalidate parameterized entries", () => {
      cache.set("api/users", "page1", { page: 1 });
      cache.set("api/users", "page2", { page: 2 });
      cache.set("api/posts", "page1", { page: 1 });

      const count = cache.invalidate("api/users.*");

      expect(count).toBe(2);
      expect(cache.has("api/users", { page: 1 })).toBe(false);
      expect(cache.has("api/users", { page: 2 })).toBe(false);
      expect(cache.has("api/posts", { page: 1 })).toBe(true);
    });

    test("should return 0 when no entries match", () => {
      cache.set("key1", "value1");
      const count = cache.invalidate("nonexistent.*");
      expect(count).toBe(0);
    });
  });

  describe("clear", () => {
    test("should clear all entries", () => {
      cache.set("key1", "value1");
      cache.set("key2", "value2");
      cache.set("key3", "value3");

      expect(cache.getStats().size).toBe(3);

      cache.clear();

      expect(cache.getStats().size).toBe(0);
      expect(cache.get("key1")).toBeNull();
      expect(cache.get("key2")).toBeNull();
      expect(cache.get("key3")).toBeNull();
    });
  });

  describe("statistics", () => {
    test("should track hits and misses", () => {
      cache.set("key1", "value1");

      cache.get("key1"); // hit
      cache.get("key1"); // hit
      cache.get("nonexistent"); // miss
      cache.get("nonexistent2"); // miss

      const stats = cache.getStats();

      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(2);
      expect(stats.hitRatio).toBe(0.5);
    });

    test("should calculate hit ratio correctly", () => {
      cache.set("key1", "value1");

      for (let i = 0; i < 7; i++) {
        cache.get("key1"); // 7 hits
      }
      for (let i = 0; i < 3; i++) {
        cache.get("nonexistent"); // 3 misses
      }

      const stats = cache.getStats();

      expect(stats.hitRatio).toBe(0.7); // 7 / 10
    });

    test("should return 0 hit ratio when no requests", () => {
      const stats = cache.getStats();
      expect(stats.hitRatio).toBe(0);
    });

    test("should track size and calculated size", () => {
      cache.set("key1", "x".repeat(100)); // ~200 bytes
      cache.set("key2", "y".repeat(50)); // ~100 bytes

      const stats = cache.getStats();

      expect(stats.size).toBe(2);
      expect(stats.calculatedSize).toBeGreaterThan(0);
      expect(stats.maxSize).toBe(1024 * 100);
    });

    test("should reset stats", () => {
      cache.set("key1", "value1");

      cache.get("key1"); // hit
      cache.get("nonexistent"); // miss

      expect(cache.getStats().hits).toBe(1);
      expect(cache.getStats().misses).toBe(1);

      cache.resetStats();

      expect(cache.getStats().hits).toBe(0);
      expect(cache.getStats().misses).toBe(0);
    });
  });

  describe("size-based eviction", () => {
    test("should evict least recently used entries when size limit reached", () => {
      // Create a small cache
      const smallCache = new GenericCache({
        maxSize: 500, // Very small
        ttl: 60000,
      });

      // Add large entries that will exceed maxSize
      smallCache.set("key1", "x".repeat(100)); // ~200 bytes
      smallCache.set("key2", "y".repeat(100)); // ~200 bytes
      smallCache.set("key3", "z".repeat(100)); // ~200 bytes

      // First entry should be evicted (LRU)
      expect(smallCache.has("key1")).toBe(false);
      expect(smallCache.has("key2")).toBe(true);
      expect(smallCache.has("key3")).toBe(true);
    });
  });

  describe("TTL expiration", () => {
    test("should expire entries after TTL", async () => {
      const shortTTLCache = new GenericCache({
        maxSize: 1024 * 100,
        ttl: 100, // 100ms
      });

      shortTTLCache.set("key1", "value1");
      expect(shortTTLCache.get<string>("key1")).toStrictEqual("value1");

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(shortTTLCache.get("key1")).toBeNull();
    });

    test("should not expire entries before TTL", async () => {
      const ttlCache = new GenericCache({
        maxSize: 1024 * 100,
        ttl: 500, // 500ms
      });

      ttlCache.set("key1", "value1");

      // Wait less than TTL
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(ttlCache.get<string>("key1")).toStrictEqual("value1");
    });
  });

  describe("createCache factory", () => {
    test("should create cache instance with default options", () => {
      const cache = createCache();
      cache.set("key1", "value1");
      expect(cache.get<string>("key1")).toStrictEqual("value1");
    });

    test("should create cache instance with custom options", () => {
      const cache = createCache({
        maxSize: 1024,
        ttl: 1000,
      });

      cache.set("key1", "value1");
      expect(cache.get<string>("key1")).toStrictEqual("value1");
    });
  });
});

describe("cachedCall", () => {
  let cache: GenericCache;
  let callCount: number;

  beforeEach(() => {
    cache = new GenericCache({ ttl: 60000 });
    callCount = 0;
  });

  test("should call function on cache miss", async () => {
    const mockFn = async (): Promise<string> => {
      callCount++;
      return "result";
    };

    const result1 = await cachedCall(cache, "key", {}, mockFn);
    const result2 = await cachedCall(cache, "key", {}, mockFn);

    expect(callCount).toBe(1); // Only called once
    expect(result1).toBe("result");
    expect(result2).toBe("result");
  });

  test("should use cached value on subsequent calls", async () => {
    const mockFn = async (): Promise<string> => {
      callCount++;
      return `result-${callCount}`;
    };

    const result1 = await cachedCall(cache, "key", {}, mockFn);
    const result2 = await cachedCall(cache, "key", {}, mockFn);

    expect(callCount).toBe(1);
    expect(result1).toBe("result-1");
    expect(result2).toBe("result-1"); // Same result from cache
  });

  test("should handle parameterized calls", async () => {
    const mockFn = async (id: string): Promise<string> => {
      return `user-${id}`;
    };

    const result1 = await cachedCall(
      cache,
      "user",
      { id: "1" },
      () => mockFn("1")
    );
    const result2 = await cachedCall(
      cache,
      "user",
      { id: "2" },
      () => mockFn("2")
    );

    expect(result1).toBe("user-1");
    expect(result2).toBe("user-2");
  });

  test("should cache complex objects", async () => {
    const mockFn = async (): Promise<{ id: number; name: string }> => {
      callCount++;
      return { id: 1, name: "Alice" };
    };

    const result1 = await cachedCall(cache, "user", {}, mockFn);
    const result2 = await cachedCall(cache, "user", {}, mockFn);

    expect(callCount).toBe(1);
    expect(result1).toEqual({ id: 1, name: "Alice" });
    expect(result2).toEqual({ id: 1, name: "Alice" });
  });
});

describe("conditionalCachedCall", () => {
  let cache: GenericCache;
  let callCount: number;

  beforeEach(() => {
    cache = new GenericCache({ ttl: 60000 });
    callCount = 0;
  });

  test("should use cache when shouldCache is true", async () => {
    const mockFn = async (): Promise<string> => {
      callCount++;
      return "result";
    };

    const result1 = await conditionalCachedCall(
      cache,
      true,
      "key",
      {},
      mockFn
    );
    const result2 = await conditionalCachedCall(
      cache,
      true,
      "key",
      {},
      mockFn
    );

    expect(callCount).toBe(1);
    expect(result1).toBe("result");
    expect(result2).toBe("result");
  });

  test("should bypass cache when shouldCache is false", async () => {
    const mockFn = async (): Promise<string> => {
      callCount++;
      return `result-${callCount}`;
    };

    const result1 = await conditionalCachedCall(
      cache,
      false,
      "key",
      {},
      mockFn
    );
    const result2 = await conditionalCachedCall(
      cache,
      false,
      "key",
      {},
      mockFn
    );

    expect(callCount).toBe(2); // Called twice (no caching)
    expect(result1).toBe("result-1");
    expect(result2).toBe("result-2");
  });

  test("should work with method-based caching strategy", async () => {
    let callCount = 0;

    const apiCall = async (
      method: string,
      endpoint: string
    ): Promise<string> => {
      callCount++;
      return `${method}:${endpoint}`;
    };

    // Simulate different HTTP methods
    const getMethod = "GET";
    const postMethod = "POST";
    const shouldCacheGet = true; // Cache GET requests
    const shouldCachePost = false; // Don't cache POST requests

    // Cache GET requests
    const result1 = await conditionalCachedCall(
      cache,
      shouldCacheGet,
      "api/users",
      {},
      () => apiCall(getMethod, "api/users")
    );

    // Bypass cache for POST requests
    const result2 = await conditionalCachedCall(
      cache,
      shouldCachePost,
      "api/users",
      {},
      () => apiCall(postMethod, "api/users")
    );

    expect(callCount).toBe(2);
    expect(result1).toStrictEqual("GET:api/users");
    expect(result2).toStrictEqual("POST:api/users");
  });
});

describe("integration tests", () => {
  test("should handle realistic caching scenario", async () => {
    const cache = new GenericCache({
      maxSize: 1024 * 10, // 10KB
      ttl: 60 * 1000, // 1 minute
    });

    // Simulate API response caching
    let apiCallCount = 0;

    const fetchUsers = async (page: number): Promise<{ users: string[] }> => {
      apiCallCount++;
      return { users: [`user${page}-1`, `user${page}-2`] };
    };

    // First call - cache miss
    const result1 = await cachedCall(cache, "users", { page: 1 }, () =>
      fetchUsers(1)
    );
    expect(apiCallCount).toBe(1);
    expect(result1).toEqual({ users: ["user1-1", "user1-2"] });

    // Second call - cache hit
    const result2 = await cachedCall(cache, "users", { page: 1 }, () =>
      fetchUsers(1)
    );
    expect(apiCallCount).toBe(1); // No increment
    expect(result2).toEqual({ users: ["user1-1", "user1-2"] });

    // Different page - cache miss
    const result3 = await cachedCall(cache, "users", { page: 2 }, () =>
      fetchUsers(2)
    );
    expect(apiCallCount).toBe(2);
    expect(result3).toEqual({ users: ["user2-1", "user2-2"] });

    // Check stats
    const stats = cache.getStats();
    expect(stats.size).toBe(2);
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(2);
  });

  test("should handle cache invalidation workflow", async () => {
    const cache = new GenericCache();

    // Store multiple entries for a repository
    cache.set("repo/owner/name/issues", "issues-data");
    cache.set("repo/owner/name/pulls", "pulls-data");
    cache.set("repo/owner/name/stats", "stats-data");

    // Verify they're cached
    expect(cache.has("repo/owner/name/issues")).toBe(true);
    expect(cache.has("repo/owner/name/pulls")).toBe(true);
    expect(cache.has("repo/owner/name/stats")).toBe(true);

    // Invalidate all entries for this repo
    const count = cache.invalidate("repo/owner/name/.*");
    expect(count).toBe(3);

    // Verify they're all invalidated
    expect(cache.has("repo/owner/name/issues")).toBe(false);
    expect(cache.has("repo/owner/name/pulls")).toBe(false);
    expect(cache.has("repo/owner/name/stats")).toBe(false);
  });
});
