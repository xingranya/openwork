"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, Check, Loader2, Plug, Wrench } from "lucide-react";
import { buttonVariants, DenButton } from "../../_components/ui/button";
import { DashboardPageTemplate } from "../../_components/ui/dashboard-page-template";
import { getOrgAccessFlags } from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { IntegrationIcon } from "./integration-icon";
import {
  PluginMcpSetupDialog,
  type PluginMcpSetupTarget,
} from "./marketplace-detail-screen";
import type { MarketplacePluginCloudReadinessConnection } from "./marketplace-data";
import { formatRequiredBy, sortConnectionsForFocus, trustedConnectionFocusId } from "./mcp-connection-display";
import { marketplaceConnectionNeedsAdminSetup, marketplaceConnectionSetupTarget } from "./mcp-connection-setup";
import { MICROSOFT_365_DISPLAY_SCOPES } from "./microsoft-365-permissions";
import {
  canDisconnectMyConnectionAccount,
  type ExternalMcpConnection,
  isNativeProviderConnectionId,
  useDisconnectMyProviderAccount,
  useMcpConnections,
  useMcpConnectionPresets,
} from "./mcp-connections-data";
import { McpToolRunner } from "./mcp-tool-runner";
import { usePlugin } from "./plugin-data";
import { useMcpAccountAuthorization } from "./use-mcp-account-authorization";

/**
 * 面向成员的 MCP 连接页。管理员发布连接并授权后，成员会在这里看到连接。
 * 对于成员独立认证的连接，每个人在此登录自己的账号，后续 AI 调用继承本人权限。
 * 如果公司共用账号尚未完成 OAuth 授权，管理员也可以在此继续连接。
 */
export function YourConnectionsScreen() {
  const { data: presets = [] } = useMcpConnectionPresets();
  const { orgContext } = useOrgDashboard();
  const searchParams = useSearchParams();
  const access = getOrgAccessFlags(
    orgContext?.currentMember.role ?? "member",
    orgContext?.currentMember.isOwner ?? false,
    orgContext?.roles,
  );
  // 管理员需要看到公司的完整连接列表，普通成员只能看到已授权的连接。
  const { data: connections = [], isLoading, error, refetch } = useMcpConnections(
    access.isAdmin ? "manageable" : "usable",
  );
  const authorization = useMcpAccountAuthorization();
  const disconnectProvider = useDisconnectMyProviderAccount();
  const [setupTarget, setSetupTarget] = useState<PluginMcpSetupTarget | null>(null);
  const [rowError, setRowError] = useState<{ connectionId: string; message: string } | null>(null);
  const focusedRowRef = useRef<HTMLDivElement | null>(null);
  const focusConnectionId = trustedConnectionFocusId(connections, searchParams.get("connectionId"));
  const visibleConnections = useMemo(
    () => sortConnectionsForFocus(connections, focusConnectionId),
    [connections, focusConnectionId],
  );

  useEffect(() => {
    if (!focusConnectionId || !focusedRowRef.current) return;
    focusedRowRef.current.scrollIntoView({ block: "center" });
    focusedRowRef.current.focus({ preventScroll: true });
  }, [focusConnectionId, visibleConnections.length]);

  async function handleDisconnectMyAccount(connectionId: string) {
    setRowError(null);
    try {
      await disconnectProvider.mutateAsync(connectionId);
      void refetch();
    } catch (disconnectError) {
      setRowError({
        connectionId,
        message: disconnectError instanceof Error ? disconnectError.message : "断开账号连接失败。",
      });
    }
  }

  return (
    <DashboardPageTemplate
      icon={Plug}
      title="我的连接"
      badgeLabel="测试版"
      description="查看公司向你开放的工具。需要个人账号时在此连接；AI 只能按你的账号权限使用这些工具。"
      colors={["#DBEAFE", "#1E3A8A", "#2563EB", "#93C5FD"]}
    >
      {error ? (
        <div className="mb-6 rounded-[24px] border border-red-200 bg-red-50 px-5 py-4 text-[14px] text-red-700">
          {error instanceof Error ? error.message : "加载连接失败。"}
        </div>
      ) : null}

      {isLoading ? (
        <div className="rounded-[28px] border border-gray-200 bg-white px-6 py-10 text-[15px] text-gray-500">
          正在加载连接...
        </div>
      ) : connections.length === 0 ? (
        <div className="rounded-[28px] border border-gray-200 bg-white px-6 py-10 text-center text-[14px] text-gray-500">
          {access.isAdmin ? (
            <>
              <p>目前还没有公司连接。</p>
              <Link
                href="/dashboard/mcp-connections"
                className={`${buttonVariants({ variant: "secondary", size: "sm" })} mt-4`}
              >
                添加公司连接
              </Link>
            </>
          ) : (
            "暂时没有向你开放的连接，请联系公司管理员添加 MCP 连接。"
          )}
        </div>
      ) : (
        <div className="divide-y divide-gray-100 rounded-2xl border border-gray-100 bg-white">
          {visibleConnections.map((connection) => {
            const needsAdminSetup = marketplaceConnectionNeedsAdminSetup(connection, presets);
            const setupTarget = marketplaceConnectionSetupTarget(connection, presets, access.isAdmin);
            return <YourConnectionRow
              key={connection.id}
              connection={connection}
              isAdmin={access.isAdmin}
              needsAdminSetup={needsAdminSetup}
              setupTarget={setupTarget}
              presets={presets}
              onSetup={setSetupTarget}
              highlighted={focusConnectionId === connection.id}
              rowRef={focusConnectionId === connection.id ? focusedRowRef : undefined}
              polling={authorization.pollingConnectionId === connection.id}
              connecting={authorization.connectingConnectionId === connection.id}
              disconnecting={disconnectProvider.isPending && disconnectProvider.variables === connection.id}
              errorMessage={
                rowError?.connectionId === connection.id
                  ? rowError.message
                  : authorization.error?.connectionId === connection.id
                    ? authorization.error.message
                    : null
              }
              onConnect={() => void authorization.connect(connection.id)}
              onDisconnect={() => void handleDisconnectMyAccount(connection.id)}
            />;
          })}
        </div>
      )}
      <PluginMcpSetupDialog
        target={setupTarget}
        presets={presets}
        onClose={() => {
          setSetupTarget(null);
          void refetch();
        }}
      />
    </DashboardPageTemplate>
  );
}

function YourConnectionRow({
  connection,
  isAdmin,
  needsAdminSetup,
  setupTarget,
  presets,
  onSetup,
  polling,
  connecting,
  disconnecting,
  errorMessage,
  highlighted,
  rowRef,
  onConnect,
  onDisconnect,
}: {
  connection: ExternalMcpConnection;
  isAdmin: boolean;
  needsAdminSetup: boolean;
  setupTarget: { connectionId: string; pluginId: string } | null;
  presets: ReturnType<typeof useMcpConnectionPresets>["data"];
  onSetup: (target: PluginMcpSetupTarget) => void;
  highlighted: boolean;
  rowRef?: React.Ref<HTMLDivElement>;
  polling: boolean;
  connecting: boolean;
  disconnecting: boolean;
  errorMessage: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const isPerMember = connection.credentialMode === "per_member";
  const needsAdminRecovery = !needsAdminSetup
    && connection.needsReconnect === true
    && connection.reconnectActionOwner === "organization_admin";
  const needsReconnect = !needsAdminSetup
    && !needsAdminRecovery
    && connection.needsReconnect === true;
  const needsMyConnect = !needsAdminSetup && !needsAdminRecovery && isPerMember && !connection.connectedForMe;
  const needsAdminConnect = !needsAdminSetup && !needsAdminRecovery && isAdmin && !isPerMember && connection.authType === "oauth" && !connection.connectedForMe;
  const canDisconnect = !needsAdminSetup && canDisconnectMyConnectionAccount(connection);
  const canTestTools = !needsAdminSetup && !needsAdminRecovery && isAdmin
    && !isNativeProviderConnectionId(connection.id) && connection.connectedForMe && !needsReconnect;
  const [toolRunnerOpen, setToolRunnerOpen] = useState(false);
  const microsoftScopes = connection.id === "microsoft-365"
    ? (connection.grantedScopes ?? []).filter((scope) => MICROSOFT_365_DISPLAY_SCOPES.has(scope))
    : [];
  const requiredByLabel = formatRequiredBy(connection.requiredBy);

  return (
    <div
      ref={rowRef}
      tabIndex={highlighted ? -1 : undefined}
      className={`outline-none transition ${highlighted ? "bg-blue-50/70 ring-2 ring-inset ring-blue-200" : ""}`}
    >
      <div className="flex flex-col gap-4 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <IntegrationIcon name={connection.name} serviceUrl={connection.url} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-[14px] font-semibold text-gray-900">{connection.name}</p>
              {needsAdminSetup ? (
                <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                  等待管理员完成配置
                </span>
              ) : needsAdminRecovery ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                  <AlertTriangle className="h-3 w-3" />
                  需要管理员复核
                </span>
              ) : needsReconnect ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                  <AlertTriangle className="h-3 w-3" />
                  需要重新连接
                </span>
              ) : connection.connectedForMe ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                  <Check className="h-3 w-3" />
                  {isPerMember ? "已连接本人账号" : "公司账号已连接"}
                </span>
              ) : polling ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  等待授权...
                </span>
              ) : needsMyConnect ? (
                <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                  连接你的账号
                </span>
              ) : needsAdminConnect ? (
                <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                  连接公司账号
                </span>
              ) : (
                <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
                  等待管理员连接
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-[12px] text-gray-500">{connection.url}</p>
            {requiredByLabel ? (
              <p className="mt-1 text-[12px] font-medium text-gray-700">{requiredByLabel}</p>
            ) : null}
            {connection.id === "microsoft-365" && connection.tenantId ? (
              <p className="mt-1 text-[11px] text-gray-500">
                租户 <span className="font-mono text-gray-700">{connection.tenantId}</span>
                {connection.externalAccountId ? <> · {connection.externalAccountId}</> : null}
              </p>
            ) : null}
            {microsoftScopes.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5" aria-label="已批准的 Microsoft 365 能力">
                {microsoftScopes.map((scope) => (
                  <span key={scope} className="rounded-full bg-blue-50 px-2 py-0.5 font-mono text-[10px] text-blue-700">{scope}</span>
                ))}
              </div>
            ) : null}
            {needsAdminRecovery ? (
              <p className="mt-1 text-[12px] text-amber-700">
                工作区管理员需要先复核此服务的 OAuth 设置，成员才能重新连接。
              </p>
            ) : null}
            {errorMessage ? <p className="mt-1 text-[12px] text-red-600">{errorMessage}</p> : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {setupTarget ? (
            <MarketplaceConfigureButton
              connection={connection}
              target={setupTarget}
              onSetup={onSetup}
            />
          ) : null}
          {needsAdminRecovery && isAdmin ? (
            <Link href="/dashboard/mcp-connections" className={buttonVariants({ variant: "primary", size: "sm" })}>
              复核 OAuth
            </Link>
          ) : null}
          {canTestTools ? (
            <DenButton
              variant="secondary"
              size="sm"
              icon={Wrench}
              onClick={() => setToolRunnerOpen((open) => !open)}
              aria-expanded={toolRunnerOpen}
              aria-label={`测试 ${connection.name} 的工具`}
              title={`测试 ${connection.name} 的工具`}
              className="h-8 w-8 !px-0"
              data-testid={`toggle-mcp-tool-runner-${connection.id}`}
            />
          ) : null}
          {canDisconnect ? (
            <DenButton variant="destructive" size="sm" loading={disconnecting} onClick={onDisconnect} data-testid={`disconnect-my-mcp-account-${connection.id}`}>
              断开
            </DenButton>
          ) : null}
          {needsReconnect || needsMyConnect || needsAdminConnect ? (
            <DenButton variant="primary" size="sm" loading={connecting || polling} onClick={onConnect}>
              {needsReconnect ? "重新连接" : "连接"}
            </DenButton>
          ) : null}
        </div>
      </div>
      {toolRunnerOpen && canTestTools ? <McpToolRunner connection={connection} /> : null}
    </div>
  );
}

function normalizeConnectionUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
    return `${url.protocol.toLowerCase()}//${url.host}${pathname}${url.search}`;
  } catch {
    return null;
  }
}

function MarketplaceConfigureButton({
  connection,
  onSetup,
  target,
}: {
  connection: ExternalMcpConnection;
  onSetup: (target: PluginMcpSetupTarget) => void;
  target: { connectionId: string; pluginId: string };
}) {
  const pluginQuery = usePlugin(target.pluginId);

  if (pluginQuery.isLoading) {
    return <DenButton variant="primary" size="sm" disabled>配置</DenButton>;
  }

  const plugin = pluginQuery.data;
  const connectionUrl = normalizeConnectionUrl(connection.url);
  const pluginMcp = plugin?.mcps.find((mcp) => (
    Boolean(mcp.configObjectId)
    && normalizeConnectionUrl(mcp.url) === connectionUrl
  ));
  if (!plugin || !pluginMcp?.configObjectId) return null;

  return (
    <DenButton
      variant="primary"
      size="sm"
      onClick={() => onSetup({
        plugin: { id: plugin.id, name: plugin.name },
        connection: {
          authType: connection.authType,
          authTypeMismatch: connection.authTypeMismatch,
          configObjectId: pluginMcp.configObjectId!,
          connectedForMe: connection.connectedForMe,
          credentialMode: connection.credentialMode,
          id: connection.id,
          name: connection.name,
          oauthClientConfigured: connection.oauthClientConfigured,
          oauthClientRequired: connection.oauthClientRequired,
          requiredAuthType: connection.requiredAuthType ?? undefined,
          serverName: pluginMcp.serverName ?? pluginMcp.name,
          url: connection.url,
        } satisfies MarketplacePluginCloudReadinessConnection,
      })}
    >
      配置
    </DenButton>
  );
}
