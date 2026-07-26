import { describe, expect, test } from "bun:test";

import {
  buildDenAuthUrl,
  getDenMcpUrl,
  isLegacyWebAppMcpUrl,
  resolveCloudMcpResourceUrl,
  resolveDenBaseUrls,
  setDenBootstrapConfig,
} from "../src/app/lib/den";

describe("buildDenAuthUrl", () => {
  test("未配置公司地址时返回明确的中文错误", () => {
    expect(() => buildDenAuthUrl("", "sign-in"))
      .toThrow("FoxWork 公司登录地址尚未配置，请联系管理员。");
  });
});

describe("resolveDenBaseUrls", () => {
  test("always derives the API proxy from the base URL", () => {
    const resolved = resolveDenBaseUrls({
      baseUrl: "https://app.openworklabs.com",
      apiBaseUrl: "https://app.openworklabs.com",
    });
    expect(resolved.apiBaseUrl).toBe("https://app.openworklabs.com/api/den");
  });

  test("ignores an explicit API origin when a base URL is present", () => {
    const resolved = resolveDenBaseUrls({
      baseUrl: "https://app.openworklabs.com",
      apiBaseUrl: "https://api.example.com",
    });
    expect(resolved.apiBaseUrl).toBe("https://app.openworklabs.com/api/den");
  });

  test("ignores an explicit loopback API URL when a base URL is present", () => {
    const resolved = resolveDenBaseUrls({
      baseUrl: "http://localhost:3000",
      apiBaseUrl: "http://127.0.0.1:8787",
    });
    expect(resolved.apiBaseUrl).toBe("http://localhost:3000/api/den");
  });

  test("derives the /api/den proxy from a web-app baseUrl when no apiBaseUrl is set", () => {
    const resolved = resolveDenBaseUrls({ baseUrl: "https://app.openworklabs.com" });
    expect(resolved.apiBaseUrl).toBe("https://app.openworklabs.com/api/den");
  });

  test("将监听通配地址规范化为本地客户端地址", () => {
    const resolved = resolveDenBaseUrls({ baseUrl: "http://0.0.0.0:3005" });
    expect(resolved.baseUrl).toBe("http://localhost:3005");
    expect(resolved.apiBaseUrl).toBe("http://localhost:3005/api/den");
  });
});

describe("getDenMcpUrl", () => {
  test("never targets the bare web-app origin", async () => {
    await setDenBootstrapConfig({
      baseUrl: "https://den.example.test",
      requireSignin: false,
    });
    const url = getDenMcpUrl();
    expect(isLegacyWebAppMcpUrl(url)).toBe(false);
    expect(url).toBe("https://den.example.test/api/den/mcp");
  });
});

describe("isLegacyWebAppMcpUrl", () => {
  test("flags the legacy bare web-app MCP URL", () => {
    expect(isLegacyWebAppMcpUrl("https://app.openworklabs.com/mcp")).toBe(true);
    expect(isLegacyWebAppMcpUrl("https://app.openwork.software/mcp/")).toBe(true);
  });

  test("accepts valid MCP URLs", () => {
    expect(isLegacyWebAppMcpUrl("https://app.openworklabs.com/api/den/mcp")).toBe(false);
    expect(isLegacyWebAppMcpUrl("http://127.0.0.1:8787/mcp")).toBe(false);
  });

  test("ignores empty or malformed input", () => {
    expect(isLegacyWebAppMcpUrl(null)).toBe(false);
    expect(isLegacyWebAppMcpUrl("not a url")).toBe(false);
  });
});

describe("resolveCloudMcpResourceUrl", () => {
  test("heals a minted legacy web-app resource through the /api/den proxy", () => {
    expect(resolveCloudMcpResourceUrl("https://app.openworklabs.com/mcp")).toBe(
      "https://app.openworklabs.com/api/den/mcp",
    );
    expect(resolveCloudMcpResourceUrl("https://app.openwork.software/mcp/")).toBe(
      "https://app.openwork.software/api/den/mcp",
    );
  });

  test("keeps healthy resources verbatim", () => {
    expect(resolveCloudMcpResourceUrl("https://app.openworklabs.com/api/den/mcp")).toBe(
      "https://app.openworklabs.com/api/den/mcp",
    );
    expect(resolveCloudMcpResourceUrl("http://127.0.0.1:8787/mcp")).toBe(
      "http://127.0.0.1:8787/mcp",
    );
    expect(resolveCloudMcpResourceUrl("http://0.0.0.0:8790/mcp")).toBe(
      "http://localhost:8790/mcp",
    );
  });

  test("returns null for unusable resources so callers keep their fallback", () => {
    expect(resolveCloudMcpResourceUrl(null)).toBeNull();
    expect(resolveCloudMcpResourceUrl("")).toBeNull();
    expect(resolveCloudMcpResourceUrl("   ")).toBeNull();
    expect(resolveCloudMcpResourceUrl("not a url")).toBeNull();
    expect(resolveCloudMcpResourceUrl("ftp://app.openworklabs.com/mcp")).toBeNull();
  });
});
