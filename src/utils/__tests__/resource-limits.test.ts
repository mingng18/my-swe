import { describe, it, expect } from "bun:test";
import {
  validateResourceLimits,
  clampResourceLimits,
  exceedsMaxLimits,
  DEFAULT_RESOURCE_LIMITS,
} from "../resource-limits";

describe("validateResourceLimits", () => {
  it("should return valid for empty config", () => {
    const result = validateResourceLimits({});
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should return valid for valid configurations", () => {
    const result = validateResourceLimits({
      cpu: 2,
      memory: 4096,
      disk: 10240,
      timeout: 3600,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should correctly catch invalid cpu values", () => {
    let result = validateResourceLimits({ cpu: 0.1 });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("CPU must be between");

    result = validateResourceLimits({ cpu: 10 });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("CPU must be between");
  });

  it("should correctly catch invalid memory values", () => {
    let result = validateResourceLimits({ memory: 256 });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Memory must be between");

    result = validateResourceLimits({ memory: 32000 });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Memory must be between");
  });

  it("should correctly catch invalid disk values", () => {
    let result = validateResourceLimits({ disk: 512 });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Disk must be between");

    result = validateResourceLimits({ disk: 100000 });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Disk must be between");
  });

  it("should correctly catch invalid timeout values", () => {
    let result = validateResourceLimits({ timeout: 30 });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Timeout must be between");

    result = validateResourceLimits({ timeout: 10000 });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Timeout must be between");
  });

  it("should accumulate multiple errors", () => {
    const result = validateResourceLimits({
      cpu: 0.1,
      memory: 256,
      disk: 512,
      timeout: 30,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(4);
  });
});

describe("clampResourceLimits", () => {
  it("should not change valid limits", () => {
    const config = { cpu: 2, memory: 4096, disk: 10240 };
    const result = clampResourceLimits(config);
    expect(result).toEqual(config);
  });

  it("should clamp values under min limits", () => {
    const config = { cpu: 0.1, memory: 256, disk: 512 };
    const result = clampResourceLimits(config);
    expect(result).toEqual({ cpu: 0.5, memory: 512, disk: 1024 });
  });

  it("should clamp values over max limits", () => {
    const config = { cpu: 10, memory: 32000, disk: 100000 };
    const result = clampResourceLimits(config);
    expect(result).toEqual({
      cpu: DEFAULT_RESOURCE_LIMITS.MAX_CPU,
      memory: DEFAULT_RESOURCE_LIMITS.MAX_MEMORY_MB,
      disk: DEFAULT_RESOURCE_LIMITS.MAX_DISK_MB,
    });
  });
});

describe("exceedsMaxLimits", () => {
  it("should return false for valid configurations", () => {
    expect(exceedsMaxLimits({ cpu: 2, memory: 4096, disk: 10240 })).toBe(false);
  });

  it("should return true if any max limit is exceeded", () => {
    expect(exceedsMaxLimits({ cpu: 10 })).toBe(true);
    expect(exceedsMaxLimits({ memory: 32000 })).toBe(true);
    expect(exceedsMaxLimits({ disk: 100000 })).toBe(true);
  });
});
