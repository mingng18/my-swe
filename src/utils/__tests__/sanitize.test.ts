import { describe, expect, it } from "bun:test";
import { parseJsonSafely } from "../sanitize";

describe("sanitize utils", () => {
  describe("parseJsonSafely", () => {
    it("should throw an error when JSON depth exceeds the limit (nested objects)", () => {
      // Create a deeply nested JSON object
      let nestedJson = "{}";
      for (let i = 0; i < 15; i++) {
        nestedJson = `{"nested": ${nestedJson}}`;
      }

      expect(() => {
        parseJsonSafely(nestedJson, { maxDepth: 10 });
      }).toThrow("JSON depth exceeds maximum of 10");
    });

    it("should throw an error when JSON depth exceeds the limit (nested arrays)", () => {
      // Create a deeply nested JSON array
      let nestedJson = "[]";
      for (let i = 0; i < 15; i++) {
        nestedJson = `[${nestedJson}]`;
      }

      expect(() => {
        parseJsonSafely(nestedJson, { maxDepth: 10 });
      }).toThrow("JSON depth exceeds maximum of 10");
    });

    it("should parse successfully when depth is exactly at the limit", () => {
      // Depth = 3
      const nestedJson = `{"a": {"b": {"c": {}}}}`;
      const result = parseJsonSafely(nestedJson, { maxDepth: 3, blockProto: false });
      expect(result).toEqual({ a: { b: { c: {} } } });
    });

    it("should throw when depth exceeds the limit by 1", () => {
      // Depth = 4
      const nestedJson = `{"a": {"b": {"c": {"d": {}}}}}`;
      expect(() => {
        parseJsonSafely(nestedJson, { maxDepth: 3, blockProto: false });
      }).toThrow("JSON depth exceeds maximum of 3");
    });

    it("should check all branches of the object for depth", () => {
      // Shallow branch then deep branch
      const nestedJson = `
        {
          "shallow": {},
          "deep": {
            "a": {
              "b": {
                "c": {
                  "d": {}
                }
              }
            }
          }
        }
      `;
      expect(() => {
        parseJsonSafely(nestedJson, { maxDepth: 3, blockProto: false });
      }).toThrow("JSON depth exceeds maximum of 3");
    });
  });
});
