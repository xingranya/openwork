import type { SessionCloudMcpMaintenanceState } from "./use-session-mcp-maintenance";
import { toChineseUserMessage } from "@/app/lib/user-facing-error";

export type OpenWorkConnectStatus = {
  state: "checking" | "ready" | "needs_attention";
  label: "正在检查" | "已就绪" | "需要处理";
  description: string;
};

export function openWorkConnectAttentionTitle(description: string): string {
  return `可能的问题：${description}`;
}

export function resolveOpenWorkConnectStatus(
  signedIn: boolean,
  maintenance: SessionCloudMcpMaintenanceState | undefined,
): OpenWorkConnectStatus | null {
  if (!signedIn) return null;

  if (maintenance?.status === "ready") {
    return {
      state: "ready",
      label: "已就绪",
      description: "已连接的公司工具可以使用。",
    };
  }

  if (maintenance?.status === "failed" || maintenance?.status === "skipped") {
    return {
      state: "needs_attention",
      label: "需要处理",
      description: toChineseUserMessage(
        maintenance.issue?.message,
        "无法确认公司工具是否可用，请运行诊断查看详情。",
      ),
    };
  }

  return {
    state: "checking",
    label: "正在检查",
    description: maintenance?.status === "retrying"
      ? `正在恢复公司工具（${maintenance.attempt}/${maintenance.maxAttempts}）。`
      : "正在后台检查公司工具。",
  };
}
