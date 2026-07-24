"use client";

import { Activity } from "lucide-react";
import { DashboardPageTemplate } from "../../_components/ui/dashboard-page-template";
import { EgressDiagnosticsCard } from "./egress-diagnostics-card";

export function DiagnosticsScreen() {
  return (
    <DashboardPageTemplate
      icon={Activity}
      title="服务诊断"
      description="使用公司数据源的实际网络链路运行受控检查，定位连接和外发问题。"
      colors={["#CFFAFE", "#0F172A", "#0E7490", "#F0FDFA"]}
    >
      <EgressDiagnosticsCard canRun />
    </DashboardPageTemplate>
  );
}
