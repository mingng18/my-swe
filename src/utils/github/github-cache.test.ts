import { describe, expect, test, beforeEach, mock } from "bun:test";
import {
  githubApiCache,
  cachedGithubApiCall,
  invalidateRepoCache,
  invalidatePrCache
} from "./github-cache";

describe("GitHubApiCache and cache utilities", () => {
  beforeEach(() => {
    githubApiCache.clear();
  });

  describe("GitHubApiCache class", () => {
    test("getStats returns cache statistics", () => {
      const stats = githubApiCache.getStats();
      expect(stats).toHaveProperty("hits");
      expect(stats).toHaveProperty("misses");
      expect(stats).toHaveProperty("size");
    });
  });

  describe("cachedGithubApiCall", () => {
    test("caches GET requests", async () => {
      let callCount = 0;
      const mockFn = async () => {
        callCount++;
        return { data: "test" };
      };

      // First call should execute fn
      const res1 = await cachedGithubApiCall("GET", "/test", {}, mockFn);
      expect(res1).toEqual({ data: "test" });
      expect(callCount).toBe(1);

      // Second call should return cached result
      const res2 = await cachedGithubApiCall("GET", "/test", {}, mockFn);
      expect(res2).toEqual({ data: "test" });
      expect(callCount).toBe(1);
    });

    test("does not cache non-GET requests", async () => {
      let callCount = 0;
      const mockFn = async () => {
        callCount++;
        return { data: "test" };
      };

      // First call should execute fn
      const res1 = await cachedGithubApiCall("POST", "/test", {}, mockFn);
      expect(res1).toEqual({ data: "test" });
      expect(callCount).toBe(1);

      // Second call should also execute fn
      const res2 = await cachedGithubApiCall("POST", "/test", {}, mockFn);
      expect(res2).toEqual({ data: "test" });
      expect(callCount).toBe(2);
    });

    test("caches different endpoints separately", async () => {
      let callCount = 0;
      const mockFn = async () => {
        callCount++;
        return { data: `test-${callCount}` };
      };

      await cachedGithubApiCall("GET", "/test1", {}, mockFn);
      await cachedGithubApiCall("GET", "/test2", {}, mockFn);

      expect(callCount).toBe(2);

      const res1 = await cachedGithubApiCall("GET", "/test1", {}, mockFn);
      const res2 = await cachedGithubApiCall("GET", "/test2", {}, mockFn);

      expect(res1).toEqual({ data: "test-1" });
      expect(res2).toEqual({ data: "test-2" });
      expect(callCount).toBe(2); // Still 2, both were cached
    });

    test("caches identical endpoints with different params separately", async () => {
      let callCount = 0;
      const mockFn = async () => {
        callCount++;
        return { data: `test-${callCount}` };
      };

      await cachedGithubApiCall("GET", "/test", { page: 1 }, mockFn);
      await cachedGithubApiCall("GET", "/test", { page: 2 }, mockFn);

      expect(callCount).toBe(2);

      const res1 = await cachedGithubApiCall("GET", "/test", { page: 1 }, mockFn);
      const res2 = await cachedGithubApiCall("GET", "/test", { page: 2 }, mockFn);

      expect(res1).toEqual({ data: "test-1" });
      expect(res2).toEqual({ data: "test-2" });
      expect(callCount).toBe(2); // Still 2, both were cached
    });
  });

  describe("invalidateRepoCache", () => {
    test("invalidates matching cache entries", async () => {
      let callCount = 0;
      const mockFn = async () => {
        callCount++;
        return { data: "test" };
      };

      // Cache a value with endpoint containing repo pattern
      await cachedGithubApiCall("GET", "/repos/owner/repo/pulls", {}, mockFn);
      expect(callCount).toBe(1);

      // Validate it's cached
      await cachedGithubApiCall("GET", "/repos/owner/repo/pulls", {}, mockFn);
      expect(callCount).toBe(1);

      // Invalidate repo
      invalidateRepoCache("owner", "repo");

      // Next call should execute fn again
      await cachedGithubApiCall("GET", "/repos/owner/repo/pulls", {}, mockFn);
      expect(callCount).toBe(2);
    });

    test("does not invalidate non-matching cache entries", async () => {
      let callCount = 0;
      const mockFn = async () => {
        callCount++;
        return { data: "test" };
      };

      // Cache values for two different repos
      await cachedGithubApiCall("GET", "/repos/owner/repo1/pulls", {}, mockFn);
      await cachedGithubApiCall("GET", "/repos/owner/repo2/pulls", {}, mockFn);
      expect(callCount).toBe(2);

      // Invalidate repo1
      invalidateRepoCache("owner", "repo1");

      // repo1 should be missed (re-fetched)
      await cachedGithubApiCall("GET", "/repos/owner/repo1/pulls", {}, mockFn);
      expect(callCount).toBe(3);

      // repo2 should still be cached
      await cachedGithubApiCall("GET", "/repos/owner/repo2/pulls", {}, mockFn);
      expect(callCount).toBe(3);
    });
  });

  describe("invalidatePrCache", () => {
    test("invalidates matching cache entries", async () => {
      let callCount = 0;
      const mockFn = async () => {
        callCount++;
        return { data: "test" };
      };

      // Cache a value for PRs
      await cachedGithubApiCall("GET", "pulls", { owner: "owner", repo: "repo" }, mockFn);
      expect(callCount).toBe(1);

      // Validate it's cached
      await cachedGithubApiCall("GET", "pulls", { owner: "owner", repo: "repo" }, mockFn);
      expect(callCount).toBe(1);

      // Invalidate PRs
      invalidatePrCache("owner", "repo");

      // Next call should execute fn again
      await cachedGithubApiCall("GET", "pulls", { owner: "owner", repo: "repo" }, mockFn);
      expect(callCount).toBe(2);
    });
  });
});
