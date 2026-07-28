import { describe, expect, test } from "bun:test";

import {
  ensureProviderApiVersion,
  hostLabel,
  joinBaseUrl,
  normalizeBaseUrl,
  readBaseUrlEnv,
} from "@openwork/types/url";

describe("url primitives", () => {
  test("normalizes trailing slashes canonically", () => {
    expect(normalizeBaseUrl("http://host/")).toBe("http://host");
    expect(normalizeBaseUrl("http://host//")).toBe("http://host");
    expect(normalizeBaseUrl("http://host///")).toBe("http://host");
  });

  test("trims whitespace and preserves missing schemes", () => {
    expect(normalizeBaseUrl("  host/path//  ")).toBe("host/path");
  });

  test("handles empty and missing values", () => {
    expect(normalizeBaseUrl("")).toBe("");
    expect(normalizeBaseUrl("   ")).toBe("");
    expect(normalizeBaseUrl(undefined)).toBe("");
  });

  test("reads base URL environment values consistently", () => {
    expect(readBaseUrlEnv({ DEN_API_BASE: " http://host/// " }, "DEN_API_BASE")).toBe("http://host");
    expect(readBaseUrlEnv({ DEN_API_BASE: "   " }, "DEN_API_BASE")).toBeNull();
    expect(readBaseUrlEnv({}, "DEN_API_BASE")).toBeNull();
  });

  test("joins paths without producing a double slash", () => {
    expect(joinBaseUrl("http://host//", "/opencode")).toBe("http://host/opencode");
  });

  test("formats host labels with fallback normalization", () => {
    expect(hostLabel("https://example.test/workspace")).toBe("example.test");
    expect(hostLabel("https://example.test///")).toBe("example.test");
    expect(hostLabel("not a url///")).toBe("not a url");
  });

  test("为兼容协议基础地址补齐 v1 且保留已有版本路径", () => {
    expect(ensureProviderApiVersion("https://ai.seeway.co")).toBe("https://ai.seeway.co/v1");
    expect(ensureProviderApiVersion("https://api.minimaxi.com/anthropic/"))
      .toBe("https://api.minimaxi.com/anthropic/v1");
    expect(ensureProviderApiVersion("https://models.example.com/v1/"))
      .toBe("https://models.example.com/v1");
    expect(ensureProviderApiVersion("https://ark.example.com/api/v3"))
      .toBe("https://ark.example.com/api/v3");
  });
});
