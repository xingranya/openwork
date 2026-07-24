import { describe, expect, test } from "bun:test";

import {
  openWorkConnectAttentionTitle,
  resolveOpenWorkConnectStatus,
} from "../src/react-app/domains/connections/openwork-connect-status";
import type { SessionCloudMcpMaintenanceState } from "../src/react-app/domains/connections/use-session-mcp-maintenance";

function maintenance(
  status: SessionCloudMcpMaintenanceState["status"],
): SessionCloudMcpMaintenanceState {
  return {
    status,
    issue: status === "failed"
      ? {
          code: "cloud_mcp_unavailable",
          stage: "engine_delivery",
          retryable: false,
          recommendedAction: "运行诊断",
          message: "无法确认已连接的公司工具是否可用。",
        }
      : null,
    attempt: status === "retrying" ? 2 : 1,
    maxAttempts: 3,
  };
}

describe("公司连接状态", () => {
  test("原生提示会把诊断结果标记为可能的问题", () => {
    expect(openWorkConnectAttentionTitle("无法确认已连接的公司工具是否可用。"))
      .toBe("可能的问题：无法确认已连接的公司工具是否可用。");
  });

  test("is hidden while signed out", () => {
    expect(resolveOpenWorkConnectStatus(false, maintenance("ready"))).toBeNull();
  });

  test("maps the shared lifecycle to checking, ready, and needs attention", () => {
    expect(resolveOpenWorkConnectStatus(true, undefined)).toMatchObject({
      state: "checking",
      label: "正在检查",
    });
    expect(resolveOpenWorkConnectStatus(true, maintenance("checking"))).toMatchObject({
      state: "checking",
      label: "正在检查",
    });
    expect(resolveOpenWorkConnectStatus(true, maintenance("retrying"))).toMatchObject({
      state: "checking",
      description: "正在恢复公司工具（2/3）。",
    });
    expect(resolveOpenWorkConnectStatus(true, maintenance("ready"))).toMatchObject({
      state: "ready",
      label: "已就绪",
    });
    expect(resolveOpenWorkConnectStatus(true, maintenance("failed"))).toEqual({
      state: "needs_attention",
      label: "需要处理",
      description: "无法确认已连接的公司工具是否可用。",
    });
    expect(resolveOpenWorkConnectStatus(true, maintenance("skipped"))).toMatchObject({
      state: "needs_attention",
      label: "需要处理",
    });
  });
});
