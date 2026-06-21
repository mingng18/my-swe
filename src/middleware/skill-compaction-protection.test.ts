import { describe, it, expect, mock } from "bun:test";
import {
  createSkillCompactionProtectionMiddleware,
  isMessageProtected,
  filterProtectedMessages,
  getProtectedMessages,
} from "./skill-compaction-protection";

describe("Skill Compaction Protection Middleware", () => {
  describe("createSkillCompactionProtectionMiddleware", () => {
    it("should flag messages with <skill_content in string content", async () => {
      const middleware = createSkillCompactionProtectionMiddleware();
      const mockHandler = mock(async (req: any) => ({
        messages: [
          {
            type: "tool",
            content: "some text <skill_content> data </skill_content>",
          },
          { type: "tool", content: "normal text" },
        ],
      }));

      const response = (await middleware.wrapModelCall!(
        {} as any,
        mockHandler as any,
      )) as any;

      expect(response.messages[0].additional_kwargs._protected).toBe(true);
      expect(
        response.messages[1].additional_kwargs?._protected,
      ).toBeUndefined();
    });

    it("should flag messages with <skill_content in array content", async () => {
      const middleware = createSkillCompactionProtectionMiddleware();
      const mockHandler = mock(async (req: any) => ({
        messages: [
          {
            type: "tool-result",
            content: [
              { type: "text", text: "first text" },
              { type: "text", text: "text with <skill_content> tag" },
              { type: "text", text: "another block" },
            ],
          },
          {
            type: "tool-result",
            content: [{ type: "image", url: "http://example.com" }],
          },
        ],
      }));

      const response = (await middleware.wrapModelCall!(
        {} as any,
        mockHandler as any,
      )) as any;

      expect(response.messages[0].additional_kwargs._protected).toBe(true);
      expect(
        response.messages[1].additional_kwargs?._protected,
      ).toBeUndefined();
    });

    it("should only flag tool or tool-result messages", async () => {
      const middleware = createSkillCompactionProtectionMiddleware();
      const mockHandler = mock(async (req: any) => ({
        messages: [
          { type: "human", content: "<skill_content>" },
          { type: "ai", content: "<skill_content>" },
          { type: "tool", content: "<skill_content>" },
        ],
      }));

      const response = (await middleware.wrapModelCall!(
        {} as any,
        mockHandler as any,
      )) as any;

      expect(
        response.messages[0].additional_kwargs?._protected,
      ).toBeUndefined();
      expect(
        response.messages[1].additional_kwargs?._protected,
      ).toBeUndefined();
      expect(response.messages[2].additional_kwargs._protected).toBe(true);
    });

    it("should handle missing messages array gracefully", async () => {
      const middleware = createSkillCompactionProtectionMiddleware();
      const mockHandler = mock(async (req: any) => ({}));

      const response = (await middleware.wrapModelCall!(
        {} as any,
        mockHandler as any,
      )) as any;

      expect(response).toEqual({});
    });

    it("should propagate errors from the handler", async () => {
      const middleware = createSkillCompactionProtectionMiddleware();
      const error = new Error("Handler error");
      const mockHandler = mock(async (req: any) => {
        throw error;
      });

      expect(
        middleware.wrapModelCall!({} as any, mockHandler as any),
      ).rejects.toThrow("Handler error");
    });
  });

  describe("isMessageProtected", () => {
    it("should return true if _protected is in additional_kwargs", () => {
      expect(
        isMessageProtected({ additional_kwargs: { _protected: true } }),
      ).toBe(true);
    });

    it("should return true if _protected is in kwargs", () => {
      expect(isMessageProtected({ kwargs: { _protected: true } })).toBe(true);
    });

    it("should return true if _protected is in kwargs but not additional_kwargs", () => {
      expect(
        isMessageProtected({
          additional_kwargs: {},
          kwargs: { _protected: true },
        }),
      ).toBe(true);
    });

    it("should return true if _protected is in additional_kwargs but not kwargs", () => {
      expect(
        isMessageProtected({
          additional_kwargs: { _protected: true },
          kwargs: {},
        }),
      ).toBe(true);
    });

    it("should return true if _protected is in both", () => {
      expect(
        isMessageProtected({
          additional_kwargs: { _protected: true },
          kwargs: { _protected: true },
        }),
      ).toBe(true);
    });

    it("should return false if _protected is not set", () => {
      expect(isMessageProtected({})).toBe(false);
      expect(isMessageProtected({ additional_kwargs: {} })).toBe(false);
      expect(
        isMessageProtected({ additional_kwargs: { _protected: false } }),
      ).toBe(false);
    });

    it("should return false for null or undefined input", () => {
      expect(isMessageProtected(null)).toBe(false);
      expect(isMessageProtected(undefined)).toBe(false);
    });

    it("should return false for primitive input types", () => {
      expect(isMessageProtected("string")).toBe(false);
      expect(isMessageProtected(123)).toBe(false);
      expect(isMessageProtected(true)).toBe(false);
    });

    it("should return false if _protected is not strictly boolean true", () => {
      expect(
        isMessageProtected({ additional_kwargs: { _protected: "true" } }),
      ).toBe(false);
      expect(isMessageProtected({ additional_kwargs: { _protected: 1 } })).toBe(
        false,
      );
      expect(
        isMessageProtected({ additional_kwargs: { _protected: null } }),
      ).toBe(false);
    });
  });

  describe("filterProtectedMessages", () => {
    it("should return only unprotected messages", () => {
      const messages = [
        { id: 1, additional_kwargs: { _protected: true } },
        { id: 2 },
        { id: 3, kwargs: { _protected: true } },
        { id: 4, additional_kwargs: { _protected: false } },
      ];

      const result = filterProtectedMessages(messages);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(2);
      expect(result[1].id).toBe(4);
    });
  });

  describe("getProtectedMessages", () => {
    it("should return only protected messages", () => {
      const messages = [
        { id: 1, additional_kwargs: { _protected: true } },
        { id: 2 },
        { id: 3, kwargs: { _protected: true } },
        { id: 4, additional_kwargs: { _protected: false } },
      ];

      const result = getProtectedMessages(messages);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(1);
      expect(result[1].id).toBe(3);
    });

    it("should return an empty array when given an empty array", () => {
      expect(getProtectedMessages([])).toEqual([]);
    });

    it("should return all messages if all are protected", () => {
      const messages = [
        { id: 1, additional_kwargs: { _protected: true } },
        { id: 2, kwargs: { _protected: true } },
      ];

      const result = getProtectedMessages(messages);
      expect(result).toHaveLength(2);
      expect(result).toEqual(messages);
    });

    it("should return an empty array if none are protected", () => {
      const messages = [
        { id: 1 },
        { id: 2, additional_kwargs: { _protected: false } },
      ];

      const result = getProtectedMessages(messages);
      expect(result).toEqual([]);
    });

    it("should handle null or undefined elements gracefully", () => {
      const messages = [
        null,
        undefined,
        { id: 1, additional_kwargs: { _protected: true } },
        "string element",
        123,
      ];

      const result = getProtectedMessages(messages);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 1,
        additional_kwargs: { _protected: true },
      });
    });
  });
});
