"use client";

import { getOrgAccessFlags } from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { DashboardOverviewScreen } from "./dashboard-overview-screen";
import { MemberDashboardScreen } from "./member-dashboard-screen";

export function DashboardHomeScreen() {
  const { orgBusy, orgContext, mutationBusy } = useOrgDashboard();
  const access = getOrgAccessFlags(
    orgContext?.currentMember.role ?? "member",
    orgContext?.currentMember.isOwner ?? false,
    orgContext?.roles,
  );

  // 切换公司时保留旧上下文，直到新上下文加载完成。
  // 路由先显示占位状态，避免管理员和成员首页直接切换引起跳动。
  if (orgBusy || mutationBusy === "switch-organization" || !orgContext) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-6 text-[14px] text-gray-500">
        正在加载工作区...
      </div>
    );
  }

  return access.isAdmin ? <DashboardOverviewScreen /> : <MemberDashboardScreen />;
}
