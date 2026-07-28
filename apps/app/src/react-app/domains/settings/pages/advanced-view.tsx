/** @jsxImportSource react */
import { useEffect, useReducer, useState } from "react";

import { Separator } from "@/components/ui/separator";

import type { OpencodeConnectStatus } from "@/app/types";
import type { OpenworkCloudMcpHealth, OpenworkRuntimeConfigStatus, OpenworkServerStatus } from "@/app/lib/openwork-server";
import { toChineseUserMessage } from "@/app/lib/user-facing-error";
import { t } from "@/i18n";
import { LayoutStack } from "../settings-layout";
import type { useDenSession } from "../cloud/use-den-session";

import { advancedLocalReducer, initialAdvancedLocalState } from "./advanced-view-state";
import {
  AdvancedDeveloperSection,
  AdvancedCloudMcpDiagnosticsSection,
  AdvancedOrganizationServerSection,
  AdvancedRuntimeMigrationSection,
  AdvancedRuntimeSection,
} from "./advanced-view-sections";

type AdvancedOrganizationServerSession = Pick<
  ReturnType<typeof useDenSession>,
  | "authBusy"
  | "baseUrl"
  | "baseUrlBusy"
  | "baseUrlDraft"
  | "baseUrlError"
  | "onApplyBaseUrl"
  | "onBaseUrlDraftChange"
  | "onClearServerConfiguration"
  | "onResetBaseUrlToDefault"
  | "sessionBusy"
>;

export type AdvancedViewProps = {
  busy: boolean;
  clientConnected: boolean;
  opencodeConnectStatus: OpencodeConnectStatus | null;
  openworkServerStatus: OpenworkServerStatus;
  developerMode: boolean;
  toggleDeveloperMode: () => void;
  opencodeDevModeEnabled: boolean;
  openDebugDeepLink: (rawUrl: string) => Promise<{ ok: boolean; message: string }>;
  canMigrateRuntimeConfig: boolean;
  migrateRuntimeConfig: () => Promise<{ migrated: boolean; keys: string[] }>;
  getRuntimeConfigStatus: () => Promise<OpenworkRuntimeConfigStatus>;
  organizationServer: AdvancedOrganizationServerSession;
  cloudMcpUrl: string | null;
  cloudMcpHealth: OpenworkCloudMcpHealth | null;
  refreshCloudMcpHealth: () => Promise<OpenworkCloudMcpHealth | null>;
};

type AdvancedStatusTone = "ready" | "warning" | "error" | "neutral";

export function AdvancedView(props: AdvancedViewProps) {
  const [localState, dispatchLocal] = useReducer(
    advancedLocalReducer,
    initialAdvancedLocalState,
  );
  const [configStatus, setConfigStatus] = useState<OpenworkRuntimeConfigStatus | null>(null);
  const [configStatusBusy, setConfigStatusBusy] = useState(false);
  const [configStatusError, setConfigStatusError] = useState<string | null>(null);
  const {
    deepLinkOpen: debugDeepLinkOpen,
    deepLinkInput: debugDeepLinkInput,
    deepLinkBusy: debugDeepLinkBusy,
    deepLinkStatus: debugDeepLinkStatus,
    migrationBusy,
    migrationStatus,
  } = localState;

  const clientStatusLabel = (() => {
    const status = props.opencodeConnectStatus?.status;
    if (status === "connecting") return t("status.connecting");
    if (status === "error") return t("settings.connection_failed");
    return props.clientConnected ? t("status.connected") : t("config.status_not_connected");
  })();

  const clientTone: AdvancedStatusTone = (() => {
    const status = props.opencodeConnectStatus?.status;
    if (status === "connecting") return "warning";
    if (status === "error") return "error";
    return props.clientConnected ? "ready" : "neutral";
  })();

  const openworkStatusLabel = (() => {
    switch (props.openworkServerStatus) {
      case "connected":
        return t("config.status_connected");
      case "limited":
        return t("config.status_limited");
      default:
        return t("config.status_not_connected");
    }
  })();

  const openworkTone: AdvancedStatusTone = (() => {
    switch (props.openworkServerStatus) {
      case "connected":
        return "ready";
      case "limited":
        return "warning";
      default:
        return "neutral";
    }
  })();

  const clientDetailLines = props.clientConnected
    ? ["当前工作区可以使用 AI 会话和任务功能。"]
    : [
        "AI 运行引擎重启完成前，会话和任务创建可能失败。",
        "仍可查看下方的 SeeWayWork 本地服务配置来源。",
      ];

  const openworkDetailLines = props.openworkServerStatus === "connected"
    ? ["可以查看运行数据库、工作区配置和迁移诊断。"]
    : ["连接 SeeWayWork 本地服务后才能查看运行配置诊断。"];

  const submitDebugDeepLink = async () => {
    const rawUrl = debugDeepLinkInput.trim();
    if (!rawUrl || props.busy || debugDeepLinkBusy) return;
    dispatchLocal({ type: "deepLinkStart" });
    try {
      const result = await props.openDebugDeepLink(rawUrl);
      if (result.ok) {
        dispatchLocal({
          type: "deepLinkSuccess",
          status: toChineseUserMessage(result.message, "链接已打开。"),
        });
      } else {
        dispatchLocal({
          type: "deepLinkStatus",
          status: toChineseUserMessage(result.message, t("settings.open_deeplink_failed")),
        });
      }
    } catch (error) {
      dispatchLocal({
        type: "deepLinkStatus",
        status: toChineseUserMessage(error, t("settings.open_deeplink_failed")),
      });
    } finally {
      dispatchLocal({ type: "deepLinkDone" });
    }
  };

  const refreshRuntimeConfigStatus = async () => {
    if (!props.canMigrateRuntimeConfig) {
      setConfigStatus(null);
      return;
    }
    setConfigStatusBusy(true);
    setConfigStatusError(null);
    try {
      setConfigStatus(await props.getRuntimeConfigStatus());
    } catch (error) {
      setConfigStatusError(toChineseUserMessage(error, "无法读取运行配置状态，请重试。"));
    } finally {
      setConfigStatusBusy(false);
    }
  };

  useEffect(() => {
    void refreshRuntimeConfigStatus();
  }, [props.canMigrateRuntimeConfig]);

  const migrateRuntimeConfig = async () => {
    if (props.busy || migrationBusy || !props.canMigrateRuntimeConfig) return;
    dispatchLocal({ type: "migrationStart" });
    try {
      const result = await props.migrateRuntimeConfig();
      await refreshRuntimeConfigStatus();
      dispatchLocal({
        type: "migrationStatus",
        status: result.migrated
          ? `已迁移旧版运行配置：${result.keys.join("、")}。`
          : "当前工作区没有需要迁移的旧版运行配置。",
      });
    } catch (error) {
      dispatchLocal({
        type: "migrationStatus",
        status: toChineseUserMessage(error, "迁移运行配置失败，请重试。"),
      });
    } finally {
      dispatchLocal({ type: "migrationDone" });
    }
  };

  return (
    <LayoutStack>
      <AdvancedOrganizationServerSection
        authBusy={props.organizationServer.authBusy}
        baseUrl={props.organizationServer.baseUrl}
        baseUrlBusy={props.organizationServer.baseUrlBusy}
        baseUrlDraft={props.organizationServer.baseUrlDraft}
        baseUrlError={props.organizationServer.baseUrlError}
        onApplyBaseUrl={props.organizationServer.onApplyBaseUrl}
        onBaseUrlDraftChange={props.organizationServer.onBaseUrlDraftChange}
        onClearServerConfiguration={props.organizationServer.onClearServerConfiguration}
        onResetBaseUrlToDefault={props.organizationServer.onResetBaseUrlToDefault}
        sessionBusy={props.organizationServer.sessionBusy}
        cloudMcpUrl={props.cloudMcpUrl}
      />

      <AdvancedRuntimeSection
        clientStatusLabel={clientStatusLabel}
        clientTone={clientTone}
        clientDetailLines={clientDetailLines}
        openworkStatusLabel={openworkStatusLabel}
        openworkTone={openworkTone}
        openworkDetailLines={openworkDetailLines}
      />

      {props.developerMode ? (
        <>
          <AdvancedCloudMcpDiagnosticsSection
            cloudMcpHealth={props.cloudMcpHealth}
            onRefresh={props.refreshCloudMcpHealth}
          />

          <AdvancedRuntimeMigrationSection
            busy={props.busy}
            canMigrate={props.canMigrateRuntimeConfig}
            migrationBusy={migrationBusy}
            migrationStatus={migrationStatus}
            configStatus={configStatus}
            configStatusBusy={configStatusBusy}
            configStatusError={configStatusError}
            onRefresh={refreshRuntimeConfigStatus}
            onMigrate={migrateRuntimeConfig}
          />
        </>
      ) : null}

      <AdvancedDeveloperSection
        busy={props.busy}
        developerMode={props.developerMode}
        opencodeDevModeEnabled={props.opencodeDevModeEnabled}
        deepLinkOpen={debugDeepLinkOpen}
        deepLinkInput={debugDeepLinkInput}
        deepLinkBusy={debugDeepLinkBusy}
        deepLinkStatus={debugDeepLinkStatus}
        onToggleDeveloperMode={props.toggleDeveloperMode}
        onToggleDeepLink={() => dispatchLocal({ type: "toggleDeepLink" })}
        onDeepLinkInput={(input) => dispatchLocal({ type: "deepLinkInput", input })}
        onSubmitDeepLink={submitDebugDeepLink}
      />
    </LayoutStack>
  );
}
