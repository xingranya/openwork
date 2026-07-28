"use client";

import { Activity } from "lucide-react";
import { getOrgAccessFlags } from "../../_lib/den-org";
import { DashboardPageTemplate } from "../../_components/ui/dashboard-page-template";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { EgressDiagnosticsCard } from "./egress-diagnostics-card";

export function DiagnosticsScreen() {
  const { orgContext } = useOrgDashboard();
  const access = getOrgAccessFlags(
    orgContext?.currentMember.role ?? "member",
    orgContext?.currentMember.isOwner ?? false,
    orgContext?.roles,
  );

  return (
    <DashboardPageTemplate
      icon={Activity}
      title="服务诊断"
      description="使用公司数据源的实际网络链路运行受控检查，定位连接和外发问题。"
      colors={["#CFFAFE", "#0F172A", "#0E7490", "#F0FDFA"]}
    >
      <EgressDiagnosticsCard canView={access.canViewSettings} canManage={access.canManageSettings} />
    </DashboardPageTemplate>
  );
}
