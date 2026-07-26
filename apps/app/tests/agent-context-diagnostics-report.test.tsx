/** @jsxImportSource react */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AGENT_CONTEXT_DIAGNOSTIC_CHECK_IDS,
  agentContextDiagnosticsReportSchema,
  type AgentContextDiagnosticCheck,
  type AgentContextDiagnosticsReport,
} from "@openwork/types/agent-context-diagnostics";

import { serializeAgentContextDiagnosticsReport } from "../src/app/lib/agent-context-diagnostics";
import {
  AgentContextDiagnosticsErrorNotice,
  AgentContextDiagnosticsReportView,
  organizationConnectionState,
} from "../src/react-app/domains/settings/pages/agent-context-diagnostics-report";

function healthyReport(): AgentContextDiagnosticsReport {
  const passiveEngineCheckIds = new Set([
    "agent-connect-tool-permissions",
    "engine-config",
    "engine-agent",
    "engine-plugin-tools",
    "engine-mcp-status",
    "cloud-tool-catalog",
  ]);
  const checks: AgentContextDiagnosticCheck[] = AGENT_CONTEXT_DIAGNOSTIC_CHECK_IDS.map((id) => ({
    id,
    status: passiveEngineCheckIds.has(id) ? "warning" : "passed",
    evidenceKind: passiveEngineCheckIds.has(id)
      ? "unavailable"
      : id === "request-safety"
      ? "expected"
      : id === "cloud-tool-catalog"
        ? "observed"
        : id === "organization-connections"
          ? "client-observed"
        : "observed",
    code: passiveEngineCheckIds.has(id) ? `${id}-not-queried` : `${id}-ok`,
    message: passiveEngineCheckIds.has(id) ? `${id} 未执行实时查询。` : `${id} 已验证。`,
    owner: "openwork-server",
    action: "无需处理。",
    details: id === "cloud-tool-catalog"
      ? {
          expectedToolIds: ["search_capabilities", "execute_capability"],
          observedToolIds: ["search_capabilities", "execute_capability"],
        }
      : {},
    durationMs: 1,
  }));

  return {
    schemaVersion: 1,
    runId: "22222222-2222-4222-8222-222222222222",
    startedAt: "2026-07-13T20:00:00.000Z",
    completedAt: "2026-07-13T20:00:00.125Z",
    durationMs: 125,
    overall: "warning",
    firstFailedCheck: null,
    workspace: {
      id: "workspace_test",
      name: "Customer workspace",
      type: "local",
      remoteType: null,
      engineConfigured: true,
    },
    checks,
    agent: {
      evidenceSource: "configured-intent",
      defaultAgent: "openwork",
      configuredOpenworkAgent: {
        state: "present",
        mode: "primary",
        prompt: {
          length: 1_024,
          sha256: "a".repeat(64),
          markers: {
            searchCapabilities: true,
            executeCapability: true,
            memoryBank: true,
          },
        },
        connectToolPermissions: {
          searchCapabilities: "unspecified",
          executeCapability: "unspecified",
          deniedRelevantToolCount: null,
        },
      },
      pluginLabels: ["openwork-extensions-preview", "openwork-capabilities-knowledge"],
    },
    mcps: [
      {
        name: "openwork-cloud",
        source: "config.global",
        type: "remote",
        enabled: true,
        disabledByTools: false,
        origin: null,
        path: null,
        hasHeaders: false,
        oauthMode: "none",
        syncStatus: "not-applicable",
        liveEngineStatus: "unavailable",
      },
      {
        name: "openwork-cloud",
        source: "config.remote",
        type: "remote",
        enabled: true,
        disabledByTools: false,
        origin: null,
        path: "/mcp/agent",
        hasHeaders: true,
        oauthMode: "disabled",
        syncStatus: "connected",
        liveEngineStatus: "unavailable",
      },
    ],
    connect: {
      connectEnabled: true,
      legacyGoogleWorkspaceConfigured: false,
      expectedBranch: "cloud-active",
      globalCloudMcpPresent: true,
      selectedWorkspaceCloudMcpPresent: true,
      crossWorkspaceSteeringDrift: false,
    },
    observedCloudToolIds: [],
    organizationConnectionsProbe: { status: "observed", code: null, totalCount: 1, truncated: false },
    organizationConnections: [{
      id: "externalMcpConnection_test",
      name: "Customer search",
      credentialMode: "shared",
      connected: true,
      connectedForMe: true,
      needsReconnect: false,
      missingFeatureCount: 0,
    }],
    safety: {
      diagnosticsWorkspaceRuntimeConfigurationReadOnly: true,
      cloudCatalogToolsListPerformed: false,
      directNonCloudMcpFetchPerformed: false,
      directMcpToolCallPerformed: false,
      directProviderOperationPerformed: false,
      directConfigurationMutationPerformed: false,
      directEphemeralCredentialMintPerformed: false,
      engineApiReadPerformed: false,
      engineBootstrapMayHaveRun: false,
      engineBootstrapSideEffectsInspected: false,
      authSessionActivityMayBeRecorded: true,
      tokenValuesIncluded: false,
      authorizationHeaderValuesIncluded: false,
      credentialValuesIncluded: false,
      rawPromptsIncluded: false,
      providerResponsesIncluded: false,
      stackTracesIncluded: false,
      rawEngineErrorsIncluded: false,
      secretBearingUrlsIncluded: false,
      inputStrictlyValidated: true,
    },
  };
}

describe("AgentContextDiagnosticsReportView", () => {
  test("renders the detailed observed-versus-expected report with stable proof labels", () => {
    const html = renderToStaticMarkup(
      <AgentContextDiagnosticsReportView report={healthyReport()} copied={false} copying={false} onCopy={() => {}} />,
    );

    expect(html).toContain("智能体诊断报告");
    expect(html).toContain("22222222-2222-4222-8222-222222222222");
    expect(html).toContain("预期状态");
    expect(html).toContain("客户端读取");
    expect(html).toContain("已读取实际状态");
    expect(html).toContain("openwork-extensions-preview");
    expect(html).toContain("config.remote");
    expect(html).toContain("注册记录: 已连接");
    expect(html).toContain("配置的默认智能体");
    expect(html).toContain("配置的 FoxWork 智能体");
    expect(html).toContain("配置为启用");
    expect(html).toContain("已配置请求头 · 具体值已隐藏");
    expect(html).toContain("未查询实时连接状态");
    expect(html).toContain("本次检查不会发起模型对话");
    expect(html).toContain("/mcp/agent");
    expect(html).not.toContain("/wrong-layer/mcp/agent");
    expect(html).toContain("search_capabilities");
    expect(html).toContain("execute_capability");
    expect(html).toContain("Customer search");
    expect(html).toContain("无需处理。");
    expect(html).toContain('data-testid="agent-diagnostics-copy"');
    expect(html).toContain('data-testid="agent-diagnostics-report"');
    expect(html).toContain('data-testid="agent-diagnostics-completion-status"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
    expect(html).toContain("智能体诊断完成：警告");
    expect(html).toContain('aria-label="search_capabilities: 是"');
    expect(html).toContain('data-marker-value="true"');
    expect(html).toContain('data-testid="agent-diagnostics-cloud-endpoint"');
    expect(html).toContain('data-testid="agent-diagnostics-mcp-sync"');
    expect(html).toContain('data-testid="agent-diagnostics-plugin-tools-unavailable"');
    expect(html).not.toContain("Settings Connect marker");
    expect(html.match(/data-testid="agent-diagnostics-check"/g)).toHaveLength(
      AGENT_CONTEXT_DIAGNOSTIC_CHECK_IDS.length,
    );
  });

  test("announces false context markers and diagnostic errors without relying on color", () => {
    const report = healthyReport();
    report.agent.configuredOpenworkAgent.prompt.markers.memoryBank = false;
    const reportHtml = renderToStaticMarkup(
      <AgentContextDiagnosticsReportView report={report} copied={false} copying={false} onCopy={() => {}} />,
    );
    const errorHtml = renderToStaticMarkup(
      <AgentContextDiagnosticsErrorNotice message="智能体诊断未能完成。" />,
    );

    expect(reportHtml).toContain('aria-label="记忆上下文标记: 否"');
    expect(reportHtml).toContain('data-marker-value="false"');
    expect(errorHtml).toContain('data-testid="agent-diagnostics-error"');
    expect(errorHtml).toContain('role="alert"');
    expect(errorHtml).toContain('aria-live="assertive"');
    expect(errorHtml).toContain('aria-atomic="true"');
    expect(errorHtml).toContain("智能体诊断未能完成。");
  });

  test("英文服务诊断不会回退显示给员工", () => {
    const report = healthyReport();
    report.checks[0] = {
      ...report.checks[0],
      status: "failed",
      message: "The selected engine could not be observed.",
      action: "Reconnect OpenWork Cloud and rerun diagnostics.",
    };
    const reportHtml = renderToStaticMarkup(
      <AgentContextDiagnosticsReportView report={report} copied={false} copying={false} onCopy={() => {}} />,
    );
    const errorHtml = renderToStaticMarkup(
      <AgentContextDiagnosticsErrorNotice message="Diagnostics request failed." />,
    );

    expect(reportHtml).toContain("检查未通过，请按建议处理后重新检查。");
    expect(reportHtml).toContain("请检查公司连接、工作区权限和 AI 运行服务后重新诊断。");
    expect(reportHtml).not.toContain("The selected engine");
    expect(reportHtml).not.toContain("Reconnect OpenWork Cloud");
    expect(errorHtml).toContain("诊断未能完成，请稍后重试。");
    expect(errorHtml).not.toContain("Diagnostics request failed");
  });

  test("labels engine-resolved evidence as effective and tool-policy-disabled MCPs as disabled", () => {
    const report = healthyReport();
    const engineConfigCheck = report.checks.find((check) => check.id === "engine-config");
    if (!engineConfigCheck) throw new Error("Expected engine-config check fixture.");
    engineConfigCheck.status = "passed";
    engineConfigCheck.evidenceKind = "observed";
    report.agent.evidenceSource = "effective-engine";
    report.safety.engineApiReadPerformed = true;
    report.safety.engineBootstrapMayHaveRun = true;
    report.mcps[0] = { ...report.mcps[0], source: "engine.config", disabledByTools: true };

    const html = renderToStaticMarkup(
      <AgentContextDiagnosticsReportView report={report} copied={false} copying={false} onCopy={() => {}} />,
    );

    expect(html).toContain("实际使用的默认智能体");
    expect(html).toContain("实际使用的 FoxWork 智能体");
    expect(html).toContain("实际生效的插件名称");
    expect(html).toContain("已读取实际配置");
    expect(html).toContain("因工具策略而停用");
    expect(html).not.toContain("运行环境实际配置（未查询）");
  });

  test("renders and serializes an effective ask rule as approval required", () => {
    const report = healthyReport();
    report.agent.configuredOpenworkAgent.connectToolPermissions.searchCapabilities = "approval-required";

    const html = renderToStaticMarkup(
      <AgentContextDiagnosticsReportView report={report} copied={false} copying={false} onCopy={() => {}} />,
    );
    const serialized = serializeAgentContextDiagnosticsReport(report);

    expect(html).toContain("搜索能力权限");
    expect(html).toContain("需要确认");
    expect(serialized).toContain('"searchCapabilities": "approval-required"');
    expect(agentContextDiagnosticsReportSchema.safeParse(JSON.parse(serialized)).success).toBe(true);
  });

  test("disables Copy report while copying and exposes a polite success announcement", () => {
    const html = renderToStaticMarkup(
      <AgentContextDiagnosticsReportView report={healthyReport()} copied copying onCopy={() => {}} />,
    );

    expect(html).toContain('data-testid="agent-diagnostics-copy"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('data-testid="agent-diagnostics-copy-status"');
    expect(html).toContain("已复制脱敏后的智能体诊断报告。");
  });

  test("serializes only the strict sanitized report contract", () => {
    const serialized = serializeAgentContextDiagnosticsReport(healthyReport());
    expect(serialized).toContain('"diagnosticsWorkspaceRuntimeConfigurationReadOnly": true');
    expect(serialized).toContain('"directProviderOperationPerformed": false');
    expect(serialized).toContain('"authSessionActivityMayBeRecorded": true');
    expect(serialized).toContain('"directEphemeralCredentialMintPerformed": false');
    expect(serialized).toContain('"engineApiReadPerformed": false');
    expect(serialized).toContain('"tokenValuesIncluded": false');
    expect(serialized).not.toContain("Authorization: Bearer");
    expect(serialized).not.toContain("raw prompt text");
    expect(serialized).not.toContain("provider response body");
    expect(serialized).not.toContain("stack trace");
  });

  test("does not label an organization connection ready when features are missing", () => {
    const connection = healthyReport().organizationConnections[0];
    if (!connection) throw new Error("Expected an organization connection fixture.");
    const state = organizationConnectionState({
      ...connection,
      credentialMode: "per_member",
      connectedForMe: true,
      needsReconnect: false,
      missingFeatureCount: 1,
    });

    expect(state.status).toBe("warning");
    expect(state.label).toBe("需要重新连接");
  });

  test("rejects duplicate observed cloud tool IDs", () => {
    const report = {
      ...healthyReport(),
      observedCloudToolIds: ["search_capabilities", "search_capabilities"],
    };
    expect(agentContextDiagnosticsReportSchema.safeParse(report).success).toBe(false);
  });

  test("rejects claims that passive diagnostics queried live engine state", () => {
    const report = healthyReport();
    report.mcps[0] = { ...report.mcps[0], liveEngineStatus: "connected" };
    expect(agentContextDiagnosticsReportSchema.safeParse(report).success).toBe(false);
  });

  test("rejects control and bidirectional formatting anywhere in copied report labels", () => {
    for (const name of ["Workspace\nname", "Workspace\u061cname", "Workspace\u200fname", "Workspace\u202ename"]) {
      const report = healthyReport();
      report.workspace.name = name;
      expect(agentContextDiagnosticsReportSchema.safeParse(report).success).toBe(false);
    }
  });

  test("rejects credential-bearing URLs and absolute paths in copied dynamic labels", () => {
    const unsafeValues = [
      "Workspace Bearer copied-report-secret",
      "Workspace client_secret=copied-report-secret",
      "Workspace https://private.example.test/mcp?token=copied-report-secret",
      "Workspace /Users/diagnostics/private/report.json",
      "Workspace C:\\Users\\diagnostics\\private\\report.json",
      "Workspace ~/private/report.json",
    ];
    for (const name of unsafeValues) {
      const report = healthyReport();
      report.workspace.name = name;
      expect(agentContextDiagnosticsReportSchema.safeParse(report).success).toBe(false);
      expect(() => serializeAgentContextDiagnosticsReport(report)).toThrow();
    }
  });

  test("rejects contradictory summary, organization, and cloud observations", () => {
    const wrongOverall = { ...healthyReport(), overall: "passed" };
    expect(agentContextDiagnosticsReportSchema.safeParse(wrongOverall).success).toBe(false);

    const staleOrganizationRows = {
      ...healthyReport(),
      organizationConnectionsProbe: {
        status: "skipped",
        code: "signed_out",
        totalCount: 0,
        truncated: false,
      },
    };
    expect(agentContextDiagnosticsReportSchema.safeParse(staleOrganizationRows).success).toBe(false);

    const toolsWithoutProbe = {
      ...healthyReport(),
      observedCloudToolIds: ["search_capabilities"],
    };
    expect(agentContextDiagnosticsReportSchema.safeParse(toolsWithoutProbe).success).toBe(false);

    const cloudProbeWithoutEffectivePolicy = {
      ...healthyReport(),
      safety: { ...healthyReport().safety, cloudCatalogToolsListPerformed: true },
    };
    expect(agentContextDiagnosticsReportSchema.safeParse(cloudProbeWithoutEffectivePolicy).success).toBe(false);

    const effectiveEvidenceWithoutEngineRead = {
      ...healthyReport(),
      agent: { ...healthyReport().agent, evidenceSource: "effective-engine" },
    };
    expect(agentContextDiagnosticsReportSchema.safeParse(effectiveEvidenceWithoutEngineRead).success).toBe(false);
  });

  test("does not export the obsolete client cloud-catalog probe contract", async () => {
    const contract = await import("@openwork/types/agent-context-diagnostics");
    expect("agentContextCloudCatalogProbeSchema" in contract).toBe(false);
    expect("agentContextCloudCatalogProbeCodeSchema" in contract).toBe(false);
  });
});
