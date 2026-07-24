import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GET } from "../app/api/runtime-config/route";

const ENV_KEYS = [
  "DEN_ORG_MODE",
  "DEN_WEB_FOXWORK_MCP_ENDPOINT",
  "DEN_MCP_PUBLIC_URL",
  "DEN_MCP_RESOURCE_URL",
  "DEN_API_PUBLIC_URL",
] as const;
const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function readRuntimeConfig() {
  const response = await GET();
  return response.json() as Promise<Record<string, unknown>>;
}

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.DEN_ORG_MODE = "multi_org";
});

afterEach(restoreEnv);

describe("FoxWork 公司地址配置", () => {
  test("优先使用管理员显式配置的 MCP 地址", async () => {
    process.env.DEN_WEB_FOXWORK_MCP_ENDPOINT = "https://foxwork.example.com/company-mcp/agent/";
    const payload = await readRuntimeConfig();

    expect(payload.foxworkMcpEndpoint).toBe("https://foxwork.example.com/company-mcp/agent");
  });

  test("可从公司 MCP 资源地址推导 Agent 入口", async () => {
    process.env.DEN_MCP_RESOURCE_URL = "https://foxwork.example.com/api/den/mcp/";
    const payload = await readRuntimeConfig();

    expect(payload.foxworkMcpEndpoint).toBe("https://foxwork.example.com/api/den/mcp/agent");
  });

  test("未配置时保持空值且管理页不含上游公网回退", async () => {
    const payload = await readRuntimeConfig();
    const onboarding = readFileSync(
      fileURLToPath(new URL("../app/(den)/dashboard/_components/marketplace-onboarding-screen.tsx", import.meta.url)),
      "utf8",
    );

    expect(payload.foxworkMcpEndpoint).toBe("");
    expect(onboarding).not.toContain("openworklabs.com");
    expect(onboarding).not.toContain("github.com/different-ai/openwork");
    expect(onboarding).not.toContain("github.com/anthropics/knowledge-work-plugins");
    expect(onboarding).toContain("createOrganizationInstallLink");
  });
});
