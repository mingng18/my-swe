import { describe, it, expect, mock } from "bun:test";
import {
  createSkillCompactionProtectionMiddleware,
  isMessageProtected,
  filterProtectedMessages,
  getProtectedMessages
} from "./skill-compaction-protection";

describe("Skill Compaction Protection Middleware", () => {
  describe("createSkillCompactionProtectionMiddleware", () => {
    it("should flag messages with <skill_content in string content", async () => {
      const middleware = createSkillCompactionProtectionMiddleware();
      const mockHandler = mock(async (req: any) => ({
        messages: [
          { type: "tool", content: "some text <skill_content> data </skill_content>" },
          { type: "tool", content: "normal text" }
        ]
      }));

      const response = await middleware.wrapModelCall!({} as any, mockHandler as any) as any;

      expect(response.messages[0].additional_kwargs._protected).toBe(true);
      expect(response.messages[1].additional_kwargs?._protected).toBeUndefined();
    });

    it("should flag messages with <skill_content in array content", async () => {
      const middleware = createSkillCompactionProtectionMiddleware();
      const mockHandler = mock(async (req: any) => ({
        messages: [
          {
            type: "tool-result",
            content: [{ type: "text", text: "text with <skill_content> tag" }]
          },
          {
            type: "tool-result",
            content: [{ type: "image", url: "http://example.com" }]
          }
        ]
      }));

      const response = await middleware.wrapModelCall!({} as any, mockHandler as any) as any;

      expect(response.messages[0].additional_kwargs._protected).toBe(true);
      expect(response.messages[1].additional_kwargs?._protected).toBeUndefined();
    });

    it("should only flag tool or tool-result messages", async () => {
      const middleware = createSkillCompactionProtectionMiddleware();
      const mockHandler = mock(async (req: any) => ({
        messages: [
          { type: "human", content: "<skill_content>" },
          { type: "ai", content: "<skill_content>" },
          { type: "tool", content: "<skill_content>" }
        ]
      }));

      const response = await middleware.wrapModelCall!({} as any, mockHandler as any) as any;

      expect(response.messages[0].additional_kwargs?._protected).toBeUndefined();
      expect(response.messages[1].additional_kwargs?._protected).toBeUndefined();
      expect(response.messages[2].additional_kwargs._protected).toBe(true);
    });

    it("should handle missing messages array gracefully", async () => {
      const middleware = createSkillCompactionProtectionMiddleware();
      const mockHandler = mock(async (req: any) => ({}));

      const response = await middleware.wrapModelCall!({} as any, mockHandler as any) as any;

      expect(response).toEqual({});
    });

    it("should propagate errors from the handler", async () => {
      const middleware = createSkillCompactionProtectionMiddleware();
      const error = new Error("Handler error");
      const mockHandler = mock(async (req: any) => { throw error; });

      expect(middleware.wrapModelCall!({} as any, mockHandler as any)).rejects.toThrow("Handler error");
    });
  });

  describe("isMessageProtected", () => {
    it("should return true if _protected is in additional_kwargs", () => {
      expect(isMessageProtected({ additional_kwargs: { _protected: true } })).toBe(true);
    });

    it("should return true if _protected is in kwargs", () => {
      expect(isMessageProtected({ kwargs: { _protected: true } })).toBe(true);
    });

    it("should return false if _protected is not set", () => {
      expect(isMessageProtected({})).toBe(false);
      expect(isMessageProtected({ additional_kwargs: {} })).toBe(false);
      expect(isMessageProtected({ additional_kwargs: { _protected: false } })).toBe(false);
    });

    it("should handle null or undefined gracefully", () => {
      expect(isMessageProtected(null)).toBe(false);
      expect(isMessageProtected(undefined)).toBe(false);
    });

    it("should handle primitive types gracefully", () => {
      expect(isMessageProtected("some string")).toBe(false);
      expect(isMessageProtected(123)).toBe(false);
      expect(isMessageProtected(true)).toBe(false);
    });

    it("should return false if _protected is explicitly false in kwargs", () => {
      expect(isMessageProtected({ kwargs: { _protected: false } })).toBe(false);
      expect(isMessageProtected({ additional_kwargs: { _protected: false }, kwargs: { _protected: false } })).toBe(false);
    });
  });

  describe("filterProtectedMessages", () => {
    it("should return only unprotected messages", () => {
      const messages = [
        { id: 1, additional_kwargs: { _protected: true } },
        { id: 2 },
        { id: 3, kwargs: { _protected: true } },
        { id: 4, additional_kwargs: { _protected: false } }
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
        { id: 4, additional_kwargs: { _protected: false } }
      ];

      const result = getProtectedMessages(messages);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(1);
      expect(result[1].id).toBe(3);
    });
  });
});
