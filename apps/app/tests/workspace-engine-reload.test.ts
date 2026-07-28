import { describe, expect, test } from "bun:test";

import { OpenworkServerError, type OpenworkServerClient } from "../src/app/lib/openwork-server";
import type { ResolvedWorkspaceEndpoint } from "../src/app/lib/workspace-endpoint";
import { reloadWorkspaceEngineWithWorkspaceRecovery } from "../src/react-app/shell/workspace-engine-reload";

function endpoint(workspaceId: string, reloadEngine: (id: string) => Promise<unknown>): ResolvedWorkspaceEndpoint {
  return {
    baseUrl: "https://worker.seeway.test",
    token: "test-token",
    workspaceId,
    isRemote: true,
    client: { reloadEngine } as OpenworkServerClient,
    mountedBaseUrl: `https://worker.seeway.test/workspace/${workspaceId}`,
    opencodeBaseUrl: `https://worker.seeway.test/workspace/${workspaceId}/opencode`,
  };
}

describe("工作区运行引擎重载", () => {
  test("旧工作区不存在时刷新绑定并仅使用新 ID 重试一次", async () => {
    const calls: string[] = [];
    const oldEndpoint = endpoint("workspace-old", async (workspaceId) => {
      calls.push(workspaceId);
      throw new OpenworkServerError(404, "workspace_not_found", "Workspace not found");
    });
    const newEndpoint = endpoint("workspace-new", async (workspaceId) => {
      calls.push(workspaceId);
      return { ok: true };
    });
    let recoveries = 0;

    const result = await reloadWorkspaceEngineWithWorkspaceRecovery({
      endpoint: oldEndpoint,
      recoverEndpoint: async () => {
        recoveries += 1;
        return newEndpoint;
      },
    });

    expect(calls).toEqual(["workspace-old", "workspace-new"]);
    expect(recoveries).toBe(1);
    expect(result.recovered).toBe(true);
    expect(result.endpoint.workspaceId).toBe("workspace-new");
  });

  test("刷新后仍找不到工作区时保留原始错误且不循环重试", async () => {
    const oldEndpoint = endpoint("workspace-old", async () => {
      throw new OpenworkServerError(404, "workspace_not_found", "Workspace not found");
    });
    let recoveries = 0;

    await expect(reloadWorkspaceEngineWithWorkspaceRecovery({
      endpoint: oldEndpoint,
      recoverEndpoint: async () => {
        recoveries += 1;
        return null;
      },
    })).rejects.toThrow("公司工作区已更新");

    expect(recoveries).toBe(1);
  });
});
