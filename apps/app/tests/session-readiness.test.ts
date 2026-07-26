import { describe, expect, test } from "bun:test";

import {
  canRenderSessionSurface,
  deriveSessionReadiness,
  isSessionOwnedByOtherWorkspace,
  shouldShowDelayedSessionLoading,
} from "../src/react-app/domains/session/status/session-readiness";

describe("会话可用状态", () => {
  test("工作区已连接但尚未选择模型时不显示为加载中", () => {
    expect(deriveSessionReadiness({
      routeLoading: false,
      workspaceConnected: true,
      modelUsable: false,
    })).toEqual({
      canCreateTask: false,
      state: "model_required",
      statusBarLoading: false,
      workspaceReady: true,
    });
  });

  test("工作区和模型均就绪后允许创建任务", () => {
    expect(deriveSessionReadiness({
      routeLoading: false,
      workspaceConnected: true,
      modelUsable: true,
    })).toEqual({
      canCreateTask: true,
      state: "connected",
      statusBarLoading: false,
      workspaceReady: true,
    });
  });

  test("加载已经结束时不会保留延迟加载遮罩", () => {
    expect(shouldShowDelayedSessionLoading({
      delayElapsed: true,
      sessionLoading: false,
    })).toBe(false);
  });

  test("远程工作区只依赖自身端点即可显示会话", () => {
    expect(canRenderSessionSurface({
      selectedWorkspaceId: "rem_ws_personal",
      selectedSessionId: "ses_remote",
      workspaceEndpointAvailable: true,
      opencodeBaseUrl: "https://worker.company.test/workspace/ws_personal/opencode",
      workspaceToken: "remote-client-token",
      opencodeClientAvailable: true,
    })).toBe(true);
  });

  test("远程工作区缺少当前端点令牌时不显示会话", () => {
    expect(canRenderSessionSurface({
      selectedWorkspaceId: "rem_ws_personal",
      selectedSessionId: "ses_remote",
      workspaceEndpointAvailable: true,
      opencodeBaseUrl: "https://worker.company.test/workspace/ws_personal/opencode",
      workspaceToken: "",
      opencodeClientAvailable: true,
    })).toBe(false);
  });

  test("远程别名与运行时工作区共享会话 ID 时优先使用当前工作区", () => {
    expect(isSessionOwnedByOtherWorkspace({
      selectedWorkspaceId: "rem_ws_personal",
      selectedSessionId: "ses_remote",
      sessionsByWorkspaceId: {
        ws_personal: [{ id: "ses_remote" }],
        rem_ws_personal: [{ id: "ses_remote" }],
      },
    })).toBe(false);
  });

  test("当前工作区尚无会话且其他工作区明确拥有该会话时阻止渲染", () => {
    expect(isSessionOwnedByOtherWorkspace({
      selectedWorkspaceId: "rem_ws_personal",
      selectedSessionId: "ses_other",
      sessionsByWorkspaceId: {
        ws_other: [{ id: "ses_other" }],
        rem_ws_personal: [],
      },
    })).toBe(true);
  });
});
