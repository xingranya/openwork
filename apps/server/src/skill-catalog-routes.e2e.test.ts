import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";

const roots: string[] = [];
const stops: Array<() => void | Promise<void>> = [];
const previousRuntimeDb = process.env.OPENWORK_RUNTIME_DB;

afterEach(async () => {
  while (stops.length) await stops.pop()?.();
  while (roots.length) await rm(roots.pop() ?? "", { recursive: true, force: true });
  if (previousRuntimeDb === undefined) delete process.env.OPENWORK_RUNTIME_DB;
  else process.env.OPENWORK_RUNTIME_DB = previousRuntimeDb;
});

async function startSkillServer() {
  const root = await mkdtemp(join(tmpdir(), "foxwork-skill-catalog-"));
  roots.push(root);
  process.env.OPENWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    token: "client-token",
    hostToken: "host-token",
    approval: { mode: "auto", timeoutMs: 1_000 },
    corsOrigins: ["*"],
    workspaces: [{ id: "ws_1", name: "工作区", path: root, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [root],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "pretty",
    logRequests: false,
  };
  const server = await startServer(config);
  stops.push(() => server.stop());
  return { baseUrl: `http://127.0.0.1:${server.port}`, token: config.token };
}

describe("在线技能安装路由", () => {
  test("只保留 Den 目录安装路由并移除旧 GitHub Skill Hub 路由", async () => {
    const { baseUrl, token } = await startSkillServer();
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };

    const legacy = await fetch(`${baseUrl}/workspace/ws_1/skills/hub/example-skill`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
    expect(legacy.status).toBe(404);

    const catalog = await fetch(`${baseUrl}/workspace/ws_1/skills/catalog/example-skill`, {
      method: "POST",
      headers,
      body: JSON.stringify({ files: [] }),
    });
    expect(catalog.status).not.toBe(404);
  });
});
