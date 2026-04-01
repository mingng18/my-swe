import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";

let mockThreadMetadata: Record<string, unknown> = {};

mock.module("@langchain/langgraph-sdk", () => {
  class MockClient {
    threads = {
      get: mock(async (threadId: string) => {
        if (threadId === "not-found") {
          const err = new Error("Not found");
          (err as any).code = 404;
          throw err;
        }
        return { metadata: mockThreadMetadata };
      }),
      update: mock(async (threadId: string, payload: { metadata: Record<string, unknown> }) => {
        mockThreadMetadata = { ...mockThreadMetadata, ...payload.metadata };
        return { metadata: mockThreadMetadata };
      }),
    };
  }
  return { Client: MockClient };
});

import {
  getGithubToken,
  getGithubTokenFromThread,
  setGithubTokenInThread,
  storeGithubTokenInThread,
} from "./github-token";

describe("github-token utils", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    mockThreadMetadata = {};
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });


  describe("getGithubToken", () => {
    test("returns token from environment variable", () => {
      process.env.GITHUB_TOKEN = "ghp_1234567890";
      expect(getGithubToken()).toBe("ghp_1234567890");
    });

    test("returns trimmed token from environment variable", () => {
      process.env.GITHUB_TOKEN = "  ghp_1234567890  ";
      expect(getGithubToken()).toBe("ghp_1234567890");
    });

    test("returns null if environment variable is empty", () => {
      process.env.GITHUB_TOKEN = "   ";
      expect(getGithubToken()).toBe(null);
    });

    test("returns null if environment variable is not set", () => {
      delete process.env.GITHUB_TOKEN;
      expect(getGithubToken()).toBe(null);
    });
  });

  describe("storeGithubTokenInThread & getGithubTokenFromThread", () => {
    test("successfully encrypts, stores, and decrypts token", async () => {
      // Setup encryption key
      process.env.GITHUB_TOKEN_ENCRYPTION_KEY = "test-encryption-key-for-unit-tests-only";
      process.env.LANGGRAPH_API_URL = "http://localhost:8123";

      const threadId = "test-thread-id";
      const token = "ghp_super_secret_token";

      // Store token
      const success = await storeGithubTokenInThread(threadId, token);
      expect(success).toBe(true);

      // Get token back
      const [decryptedToken, encryptedToken] = await getGithubTokenFromThread(threadId);
      expect(decryptedToken).toBe(token);
      expect(encryptedToken).not.toBeNull();
      expect(typeof encryptedToken).toBe("string");
      expect(encryptedToken).not.toBe(token); // Verify it was actually encrypted
    });

    test("storeGithubTokenInThread fails if encryption key is not set", async () => {
      delete process.env.GITHUB_TOKEN_ENCRYPTION_KEY;

      const threadId = "test-thread-id";
      const token = "ghp_super_secret_token";

      const success = await storeGithubTokenInThread(threadId, token);
      expect(success).toBe(false);
    });

    test("getGithubTokenFromThread returns null if token not found", async () => {
      process.env.LANGGRAPH_API_URL = "http://localhost:8123";

      const threadId = "test-thread-id";
      const [decryptedToken, encryptedToken] = await getGithubTokenFromThread(threadId);

      expect(decryptedToken).toBeNull();
      expect(encryptedToken).toBeNull();
    });

    test("getGithubTokenFromThread returns null if encryption key is missing during decryption", async () => {
      // First store the token with the key
      process.env.GITHUB_TOKEN_ENCRYPTION_KEY = "test-encryption-key-for-unit-tests-only";
      process.env.LANGGRAPH_API_URL = "http://localhost:8123";
      const threadId = "test-thread-id";
      await storeGithubTokenInThread(threadId, "secret");

      // Remove key before decryption
      delete process.env.GITHUB_TOKEN_ENCRYPTION_KEY;

      const [decryptedToken, encryptedToken] = await getGithubTokenFromThread(threadId);
      expect(decryptedToken).toBeNull();
      expect(encryptedToken).not.toBeNull(); // The token is in thread, but we can't decrypt it
    });

    test("getGithubTokenFromThread returns nulls if thread is not found", async () => {
      const [decryptedToken, encryptedToken] = await getGithubTokenFromThread("not-found");
      expect(decryptedToken).toBeNull();
      expect(encryptedToken).toBeNull();
    });
  });

  describe("setGithubTokenInThread", () => {
    test("successfully updates thread metadata with encrypted token", async () => {
      process.env.LANGGRAPH_API_URL = "http://localhost:8123";

      const threadId = "test-thread-id";
      const encryptedToken = "some_base64_encrypted_token_string";

      const success = await setGithubTokenInThread(threadId, encryptedToken);
      expect(success).toBe(true);

      // Verify via get method that it just reads the string exactly as is since we won't decrypt it without key
      // Actually, we can check the raw metadata or just use get method with right key, but here we just test set
      delete process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
      const [decryptedToken, returnedEncryptedToken] = await getGithubTokenFromThread(threadId);

      expect(decryptedToken).toBeNull();
      expect(returnedEncryptedToken).toBe(encryptedToken);
    });
  });
});
