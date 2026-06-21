import { describe, it, expect, beforeEach } from "bun:test";
import { extractTerms, cosineSimilarity, semanticSearchCache } from "../semantic-search";

describe("Semantic Search", () => {
  describe("extractTerms", () => {
    it("should extract meaningful terms from text", () => {
      const text = "user authentication login password verify";
      const terms = extractTerms(text);

      expect(terms.size).toBeGreaterThan(0);
      expect(terms.has("user")).toBe(true);
      expect(terms.has("authentication")).toBe(true);
      expect(terms.has("login")).toBe(true);
    });

    it("should filter common stopwords", () => {
      const text = "the user and the authentication system";
      const terms = extractTerms(text);

      expect(terms.has("the")).toBe(false);
      expect(terms.has("and")).toBe(false);
      expect(terms.has("user")).toBe(true);
      expect(terms.has("authentication")).toBe(true);
    });

    it("should handle empty input", () => {
      const terms = extractTerms("");
      expect(terms.size).toBe(0);
    });

    it("should extract terms from code-like text", () => {
      const text = "function authenticateUser verifyPassword return token";
      const terms = extractTerms(text);

      // Filter out keywords like "function", "return"
      // Terms are lowercased by extractTerms
      expect(terms.has("authenticateuser")).toBe(true);
      expect(terms.has("verifypassword")).toBe(true);
      expect(terms.has("token")).toBe(true);
    });
  });

  describe("cosineSimilarity", () => {
    it("should return 1 for identical term sets", () => {
      const terms1 = new Set(["user", "auth", "login"]);
      const terms2 = new Set(["user", "auth", "login"]);

      const similarity = cosineSimilarity(terms1, terms2);
      expect(similarity).toBe(1);
    });

    it("should return 0 for disjoint term sets", () => {
      const terms1 = new Set(["user", "auth"]);
      const terms2 = new Set(["database", "query"]);

      const similarity = cosineSimilarity(terms1, terms2);
      expect(similarity).toBe(0);
    });

    it("should return value between 0 and 1 for partial overlap", () => {
      const terms1 = new Set(["user", "auth", "login", "password"]);
      const terms2 = new Set(["user", "auth", "token"]);

      const similarity = cosineSimilarity(terms1, terms2);
      expect(similarity).toBeGreaterThan(0);
      expect(similarity).toBeLessThan(1);
    });

    it("should handle empty sets", () => {
      const terms1 = new Set<string>();
      const terms2 = new Set(["user", "auth"]);

      const similarity = cosineSimilarity(terms1, terms2);
      expect(similarity).toBe(0);
    });
  });

  describe("term extraction edge cases", () => {
    it("should handle special characters", () => {
      const text = "user@domain.com API_KEY = 'value'";
      const terms = extractTerms(text);

      expect(terms.has("user")).toBe(true);
      expect(terms.has("domain")).toBe(true);
      expect(terms.has("com")).toBe(true);
      expect(terms.has("api_key")).toBe(true);
      expect(terms.has("value")).toBe(true);
    });

    it("should handle numbers", () => {
      const text = "port 3000 timeout 5000 status 404";
      const terms = extractTerms(text);

      expect(terms.has("port")).toBe(true);
      expect(terms.has("3000")).toBe(true);
      expect(terms.has("timeout")).toBe(true);
    });

    it("should handle camelCase and snake_case", () => {
      const text = "getUserData fetch_user_profile API_BASE_URL";
      const terms = extractTerms(text);

      expect(terms.has("getuserdata")).toBe(true);
      expect(terms.has("fetch_user_profile")).toBe(true);
      expect(terms.has("api_base_url")).toBe(true);
    });
  });

  describe("SemanticSearchCache", () => {
    beforeEach(() => {
      semanticSearchCache.clear();
    });

    describe("invalidateFile", () => {
      it("should invalidate the cache for a specific file", () => {
        const filePath = "src/foo/bar.ts";
        const vectors = [{ filePath, line: 1, chunk: "test", terms: ["test"] }];
        semanticSearchCache.setDocumentVectors(filePath, vectors);

        expect(semanticSearchCache.getDocumentVectors(filePath)).toEqual(vectors);

        semanticSearchCache.invalidateFile(filePath);

        expect(semanticSearchCache.getDocumentVectors(filePath)).toBeNull();
      });

      it("should not invalidate cache for other files", () => {
        const filePath1 = "src/foo/bar.ts";
        const filePath2 = "src/foo/baz.ts";

        const vectors1 = [{ filePath: filePath1, line: 1, chunk: "test1", terms: ["test1"] }];
        const vectors2 = [{ filePath: filePath2, line: 1, chunk: "test2", terms: ["test2"] }];

        semanticSearchCache.setDocumentVectors(filePath1, vectors1);
        semanticSearchCache.setDocumentVectors(filePath2, vectors2);

        semanticSearchCache.invalidateFile(filePath1);

        expect(semanticSearchCache.getDocumentVectors(filePath1)).toBeNull();
        expect(semanticSearchCache.getDocumentVectors(filePath2)).toEqual(vectors2);
      });
    });
  });
});
