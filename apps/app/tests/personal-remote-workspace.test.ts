import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { DenApiError, type DenWorkerSummary } from "../src/app/lib/den";
import {
  PERSONAL_REMOTE_WORKSPACE_BACKEND,
  PERSONAL_REMOTE_WORKSPACE_IDEMPOTENCY_KEY,
  PERSONAL_REMOTE_WORKSPACE_NAME,
  reconcilePersonalRemoteWorkspace,
  selectPersonalWorker,
} from "../src/react-app/domains/workspace/personal-remote-workspace";

const sessionRouteSource = readFileSync(
  fileURLToPath(new URL("../src/react-app/shell/session-route.tsx", import.meta.url)),
  "utf8",
);

function worker(overrides: Partial<DenWorkerSummary> = {}): DenWorkerSummary {
  return {
    workerId: "wrk_personal",
    workerName: PERSONAL_REMOTE_WORKSPACE_NAME,
    status: "healthy",
    instanceUrl: "https://worker.company.test",
    provider: "kubernetes",
    sandboxBackend: PERSONAL_REMOTE_WORKSPACE_BACKEND,
    isMine: true,
    createdAt: "2026-07-26T00:00:00.000Z",
    ...overrides,
  };
}

describe("员工个人远程工作区", () => {
  test("退出或换号会让旧同步任务失效，旧回调不能清除新会话状态", () => {
    expect(sessionRouteSource).toContain("personalRemoteWorkspaceAttemptRef.current += 1")
    expect(sessionRouteSource).toContain(
      "cancelled || personalRemoteWorkspaceAttemptRef.current !== attempt",
    )
    expect(sessionRouteSource).toContain(
      "personalRemoteWorkspaceAttemptRef.current === attempt &&",
    )
  });

  test("只选择当前员工自己的可用 Worker", () => {
    expect(selectPersonalWorker([
      worker({ workerId: "wrk_other", isMine: false }),
      worker({ workerId: "wrk_manual", sandboxBackend: "daytona" }),
      worker({ workerId: "wrk_provisioning", status: "provisioning", instanceUrl: null }),
      worker({ workerId: "wrk_healthy" }),
    ])?.workerId).toBe("wrk_healthy");
  });

  test("没有专用标记时只兼容本人同名旧 Worker", () => {
    expect(selectPersonalWorker([
      worker({ workerId: "wrk_unrelated", workerName: "其他工作区", sandboxBackend: null }),
      worker({ workerId: "wrk_legacy", sandboxBackend: null }),
    ])?.workerId).toBe("wrk_legacy");
  });

  test("首次登录自动创建 Worker 并保存远程工作区，不保存主机凭据", async () => {
    const createdPayloads: Array<Record<string, unknown>> = [];
    const workerInputs: Array<Record<string, unknown>> = [];
    const result = await reconcilePersonalRemoteWorkspace({
      orgId: "org_company",
      workspaces: [],
      denClient: {
        listWorkers: async () => [],
        createWorker: async (_orgId, input) => {
          workerInputs.push(input);
          return worker();
        },
        getWorkerTokens: async () => ({
          clientToken: "client-token",
          ownerToken: "owner-token",
          hostToken: "host-token",
          openworkUrl: "https://worker.company.test/w/ws_personal",
          workspaceId: "ws_personal",
        }),
      },
      createRemoteWorkspace: async (payload) => {
        createdPayloads.push(payload);
        return {
          selectedId: "rem_ws_personal",
          workspaces: [{
            id: "rem_ws_personal",
            name: PERSONAL_REMOTE_WORKSPACE_NAME,
            path: "",
            preset: "remote",
            workspaceType: "remote",
            ...payload,
          }],
        };
      },
      updateRemoteWorkspace: async () => {
        throw new Error("不应更新不存在的工作区");
      },
    });

    expect(result).toEqual({
      status: "ready",
      workerId: "wrk_personal",
      workspaceId: "rem_ws_personal",
      created: true,
    });
    expect(createdPayloads).toHaveLength(1);
    expect(workerInputs).toEqual([{
      name: PERSONAL_REMOTE_WORKSPACE_NAME,
      destination: "cloud",
      sandboxBackend: PERSONAL_REMOTE_WORKSPACE_BACKEND,
      idempotencyKey: PERSONAL_REMOTE_WORKSPACE_IDEMPOTENCY_KEY,
    }]);
    expect(createdPayloads[0]).toMatchObject({
      displayName: PERSONAL_REMOTE_WORKSPACE_NAME,
      openworkToken: "client-token",
      openworkClientToken: "client-token",
      openworkWorkspaceId: "ws_personal",
      sandboxBackend: PERSONAL_REMOTE_WORKSPACE_BACKEND,
      sandboxRunId: "wrk_personal",
    });
    expect(createdPayloads[0]).not.toHaveProperty("openworkHostToken");
  });

  test("已存在的个人工作区只更新 Den 下发的连接信息", async () => {
    let createCount = 0;
    let updateCount = 0;
    const existing = {
      id: "rem_ws_personal",
      name: "旧名称",
      path: "",
      preset: "remote",
      workspaceType: "remote" as const,
      remoteType: "openwork" as const,
      sandboxBackend: PERSONAL_REMOTE_WORKSPACE_BACKEND,
      sandboxRunId: "wrk_personal",
      openworkWorkspaceId: "ws_personal",
    };
    const result = await reconcilePersonalRemoteWorkspace({
      orgId: "org_company",
      workspaces: [existing],
      denClient: {
        listWorkers: async () => [worker()],
        createWorker: async () => {
          throw new Error("不应重复创建 Worker");
        },
        getWorkerTokens: async () => ({
          clientToken: "new-client-token",
          ownerToken: null,
          hostToken: null,
          openworkUrl: "https://worker.company.test/w/ws_personal",
          workspaceId: "ws_personal",
        }),
      },
      createRemoteWorkspace: async () => {
        createCount += 1;
        throw new Error("不应重复创建工作区");
      },
      updateRemoteWorkspace: async (payload) => {
        updateCount += 1;
        return {
          workspaces: [{ ...existing, ...payload }],
        };
      },
    });

    expect(result.status).toBe("ready");
    expect(createCount).toBe(0);
    expect(updateCount).toBe(1);
  });

  test("Worker 尚未就绪时等待后台准备，不弹出手动连接流程", async () => {
    let tokenRequestCount = 0;
    const result = await reconcilePersonalRemoteWorkspace({
      orgId: "org_company",
      workspaces: [],
      denClient: {
        listWorkers: async () => [worker({ status: "provisioning", instanceUrl: null })],
        createWorker: async () => {
          throw new Error("已有 Worker 时不应重复创建");
        },
        getWorkerTokens: async () => {
          tokenRequestCount += 1;
          throw new Error("尚未就绪时不应请求令牌");
        },
      },
      createRemoteWorkspace: async () => {
        throw new Error("尚未就绪时不应创建工作区");
      },
      updateRemoteWorkspace: async () => {
        throw new Error("尚未就绪时不应更新工作区");
      },
    });

    expect(result).toEqual({ status: "provisioning", workerId: "wrk_personal" });
    expect(tokenRequestCount).toBe(0);
  });

  test("并发创建发生冲突时复用服务端已经建立的个人 Worker", async () => {
    let listCount = 0;
    const result = await reconcilePersonalRemoteWorkspace({
      orgId: "org_company",
      workspaces: [],
      denClient: {
        listWorkers: async () => {
          listCount += 1;
          return listCount === 1
            ? []
            : [worker({ status: "provisioning", instanceUrl: null })];
        },
        createWorker: async () => {
          throw new DenApiError(409, "worker_create_conflict", "远程工作区正在准备中。");
        },
        getWorkerTokens: async () => {
          throw new Error("准备中的 Worker 不应请求令牌");
        },
      },
      createRemoteWorkspace: async () => {
        throw new Error("准备中的 Worker 不应创建工作区");
      },
      updateRemoteWorkspace: async () => {
        throw new Error("准备中的 Worker 不应更新工作区");
      },
    });

    expect(result).toEqual({ status: "provisioning", workerId: "wrk_personal" });
    expect(listCount).toBe(2);
  });
});
