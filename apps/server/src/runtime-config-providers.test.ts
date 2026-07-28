import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readOpenworkWorkspaceConfig } from "./openwork-workspace-config-store.js";
import { readRuntimeOpencodeConfig } from "./runtime-opencode-config-store.js";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";

const CLIENT_TOKEN = "owt_runtime_provider_client";
const HOST_TOKEN = "owt_runtime_provider_host";
const roots: string[] = [];
const stops: Array<() => void | Promise<void>> = [];

async function createTempRoot() {
  const root = await mkdtemp(join(tmpdir(), "openwork-runtime-providers-"));
  roots.push(root);
  return root;
}

async function startOpenworkServer(workspaceRoot: string) {
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    configPath: join(workspaceRoot, "server.json"),
    token: CLIENT_TOKEN,
    hostToken: HOST_TOKEN,
    approval: { mode: "manual", timeoutMs: 50 },
    corsOrigins: ["*"],
    workspaces: [
      {
        id: "ws_1",
        name: "Workspace",
        path: workspaceRoot,
        preset: "starter",
        workspaceType: "local",
      },
    ],
    authorizedRoots: [workspaceRoot],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "pretty",
    logRequests: false,
  };
  const server = await startServer(config);
  stops.push(() => server.stop());
  return { base: `http://127.0.0.1:${server.port}`, config };
}

afterEach(async () => {
  while (stops.length) await stops.pop()?.();
  while (roots.length) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

describe("运行时模型供应商投影", () => {
  test("主机令牌无需人工审批即可原子写入供应商和公司导入基线", async () => {
    const root = await createTempRoot();
    const { base, config } = await startOpenworkServer(root);
    const importedProvider = {
      cloudProviderId: "lpr_company",
      providerId: "lpr_company",
      sourceProviderId: "seeway",
      name: "公司模型",
      source: "custom",
      updatedAt: "2026-07-28T00:00:00.000Z",
      modelIds: ["gpt-5.5"],
      importedAt: 1,
    };

    const response = await fetch(`${base}/workspace/ws_1/runtime-config/providers`, {
      method: "POST",
      headers: {
        "x-openwork-host-token": HOST_TOKEN,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        providers: {
          lpr_company: {
            id: "seeway",
            name: "公司模型",
            npm: "@ai-sdk/openai-compatible",
            models: { "gpt-5.5": { id: "gpt-5.5", name: "GPT-5.5" } },
          },
        },
        importedProviders: { lpr_company: importedProvider },
      }),
    });

    expect(response.status).toBe(200);
    expect((await readRuntimeOpencodeConfig(config, "ws_1")).provider).toEqual({
      lpr_company: {
        id: "seeway",
        name: "公司模型",
        npm: "@ai-sdk/openai-compatible",
        models: { "gpt-5.5": { id: "gpt-5.5", name: "GPT-5.5" } },
      },
    });
    expect(await readOpenworkWorkspaceConfig(config, "ws_1")).toMatchObject({
      cloudImports: { providers: { lpr_company: importedProvider } },
    });
  });

  test("普通客户端令牌不能写入免审批的供应商投影", async () => {
    const root = await createTempRoot();
    const { base } = await startOpenworkServer(root);

    const response = await fetch(`${base}/workspace/ws_1/runtime-config/providers`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${CLIENT_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ providers: { custom: { id: "custom" } } }),
    });

    expect(response.status).toBe(401);
  });
});
