"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Check, ChevronDown, ChevronRight, Loader2, Minus, MoreHorizontal, Pencil, Plug, Puzzle, RefreshCw, Search, Server, Trash2, Users, Wrench } from "lucide-react";
import { buttonVariants, DenButton } from "../../_components/ui/button";
import { DenInput } from "../../_components/ui/input";
import { DenNotice } from "../../_components/ui/notice";
import { DenSelect } from "../../_components/ui/select";
import { DashboardPageTemplate } from "../../_components/ui/dashboard-page-template";
import { getPluginRoute } from "../../_lib/den-org";
import { getErrorMessage, getRequestError, requestJson } from "../../_lib/den-flow";
import { IntegrationIcon } from "./integration-icon";
import { Microsoft365Dialog } from "./microsoft-365-dialog";
import { openMcpAuthorizationWindow, safeMcpAuthorizationUrl, showMcpAuthorizationError } from "./mcp-authorization-url";
import {
  editableMcpIdentityChanged,
  marketplaceIdentityOwnerNames,
  mcpAccessMode,
  type McpConnectionAccessMode,
} from "./mcp-connection-editing";
import { formatConnectionCreatorAttribution } from "./mcp-connection-display";
import {
  connectionNeedsOAuthClientConfiguration,
  marketplaceConnectionNeedsAdminSetup,
} from "./mcp-connection-setup";
import { McpCredentialInput } from "./mcp-credential-input";
import { shouldShowMcpConnectionsStagingBanner } from "./mcp-connections-capability";
import { useDenFlow } from "../../_providers/den-flow-provider";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { marketplaceQueryKeys, useMarketplaces } from "./marketplace-data";
import {
  type CreateMcpConnectionInput,
  type ExternalMcpAuthType,
  type ExternalMcpConnection,
  type ExternalMcpCredentialMode,
  type ExternalMcpPreset,
  type ExternalMcpTool,
  type McpConnectionResolution,
  type McpIssuerReview,
  type McpRequirementsDiscovery,
  type McpConnectionAccessInput,
  McpOAuthConfigurationRequiredError,
  McpOAuthStartError,
  type UpdatedMcpConnection,
  type UpdateMcpConnectionInput,
  formatMcpConnectedTimestamp,
  mcpConnectionQueryKeys,
  useCreateMcpConnection,
  useDeleteMcpConnection,
  useDisconnectMcpConnection,
  useDiscoverMcpConnectionRequirements,
  useMcpConnectionPresets,
  useMcpConnections,
  useMcpConnectionTools,
  useNativeProviderClient,
  useResolveMcpConnection,
  useReviewMcpIssuer,
  useSaveNativeProviderClient,
  useStartMcpConnectionOAuth,
  useTelegramConnection,
  useUpdateMcpConnection,
} from "./mcp-connections-data";
import {
  classifySmartAddInput,
  planSmartAdd,
  smartAddAuthLabel,
} from "./mcp-connection-smart-add";
import {
  getOptionalScopeSelectionState,
  OPTIONAL_SCOPE_BULK_TOGGLE_THRESHOLD,
  toggleAllOptionalScopes,
} from "./mcp-scope-selection";
import { getPluginPartsSummary, pluginQueryKeys, usePlugins } from "./plugin-data";
import { TelegramDialog } from "./telegram-dialog";
import {
  ConnectorQuickAddGrid,
  GOOGLE_WORKSPACE_QUICK_ADD_ID,
  MICROSOFT_365_QUICK_ADD_ID,
  TELEGRAM_QUICK_ADD_ID,
} from "./connector-quick-add-grid";

const OAUTH_POLL_INTERVAL_MS = 2000;
const OAUTH_POLL_TIMEOUT_MS = 90_000;
const MCP_REQUIREMENTS_DISCOVERY_DELAY_MS = 500;
// Smart resolve fans out server-side probes, so it debounces longer than the
// single-URL requirements discovery.
const SMART_RESOLVE_DELAY_MS = 800;
const MCP_TOOL_PAGE_SIZE = 50;
function isDiscoverableMcpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

const GOOGLE_WORKSPACE_DEFAULT_FEATURES = ["calendarRead", "gmailDraft", "driveFile"];

const GOOGLE_WORKSPACE_PERMISSION_GROUPS = [
  {
    name: "日历",
    permissions: [
      { key: "calendarRead", label: "读取日历" },
      { key: "calendarWrite", label: "创建日历事件" },
    ],
  },
  {
    name: "Gmail",
    permissions: [
      { key: "gmailDraft", label: "起草邮件" },
      { key: "gmailRead", label: "读取 Gmail" },
    ],
  },
  {
    name: "Drive",
    permissions: [
      { key: "driveFile", label: "处理选定的 Drive 文件" },
      { key: "driveRead", label: "读取全部 Drive 文件" },
      { key: "driveFull", label: "完整访问 Drive" },
    ],
  },
  {
    name: "Chat",
    permissions: [
      { key: "chat", label: "Google Chat 会话" },
    ],
  },
];

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    const clipboard = navigator.clipboard;
    if (clipboard) {
      await clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the textarea fallback.
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

type GithubPluginImportSkippedReason = "missing_url" | "local_unsupported" | "invalid_url" | "unsupported_auth";

type GithubPluginImportServer = {
  name: string;
  serverKey: string;
  url: string | null;
  supported: boolean;
  skippedReason: GithubPluginImportSkippedReason | null;
};

type GithubPluginImportSkill = {
  description: string | null;
  name: string;
  skillKey: string;
  sourcePath: string;
  supported: boolean;
};

type GithubPluginImportPreview = {
  repositoryFullName: string;
  rootPath: string;
  servers: GithubPluginImportServer[];
  skills: GithubPluginImportSkill[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function parseSkippedReason(value: unknown): GithubPluginImportSkippedReason | null {
  if (value === "missing_url" || value === "local_unsupported" || value === "invalid_url" || value === "unsupported_auth") {
    return value;
  }
  return null;
}

function parseGithubPluginImportPreview(payload: unknown): GithubPluginImportPreview {
  const item = isRecord(payload) && isRecord(payload.item) ? payload.item : null;
  if (!item) throw new Error("GitHub 插件预览数据不完整。");

  return {
    repositoryFullName: asString(item.repositoryFullName) ?? "",
    rootPath: asString(item.rootPath) ?? "",
    servers: Array.isArray(item.servers)
      ? item.servers.flatMap((entry) => {
          if (!isRecord(entry)) return [];
          const name = asString(entry.name);
          const serverKey = asString(entry.serverKey);
          if (!name || !serverKey) return [];
          return [{
            name,
            serverKey,
            url: asString(entry.url),
            supported: entry.supported === true,
            skippedReason: parseSkippedReason(entry.skippedReason),
          }];
        })
      : [],
    skills: Array.isArray(item.skills)
      ? item.skills.flatMap((entry) => {
          if (!isRecord(entry)) return [];
          const name = asString(entry.name);
          const skillKey = asString(entry.skillKey);
          if (!name || !skillKey) return [];
          return [{
            description: asString(entry.description),
            name,
            skillKey,
            sourcePath: asString(entry.sourcePath) ?? "SKILL.md",
            supported: entry.supported === true,
          }];
        })
      : [],
  };
}

function importServerStatus(server: GithubPluginImportServer): string {
  if (server.supported) return "可导入";
  if (server.skippedReason === "missing_url") return "缺少地址";
  return "暂不支持";
}

export function McpConnectionsScreen() {
  const searchParams = useSearchParams();
  const { orgContext, orgSlug } = useOrgDashboard();
  const { data: connections = [], isLoading, error, refetch } = useMcpConnections();
  const { data: presets = [] } = useMcpConnectionPresets();
  const createConnection = useCreateMcpConnection();
  const updateConnection = useUpdateMcpConnection();
  const startOAuth = useStartMcpConnectionOAuth();
  const disconnectConnection = useDisconnectMcpConnection();
  const deleteConnection = useDeleteMcpConnection();
  const saveNativeClient = useSaveNativeProviderClient();
  const reviewIssuer = useReviewMcpIssuer();

  const [formOpen, setFormOpen] = useState(false);
  const [formPreset, setFormPreset] = useState<ExternalMcpPreset | null>(null);
  const [editingConnection, setEditingConnection] = useState<ExternalMcpConnection | null>(null);
  const [configuringOAuthClient, setConfiguringOAuthClient] = useState(false);
  const [issuerReviewConnection, setIssuerReviewConnection] = useState<ExternalMcpConnection | null>(null);
  const [issuerReviewPreview, setIssuerReviewPreview] = useState<McpIssuerReview | null>(null);
  const [googleDialogOpen, setGoogleDialogOpen] = useState(false);
  const [microsoftDialogOpen, setMicrosoftDialogOpen] = useState(false);
  const [telegramDialogOpen, setTelegramDialogOpen] = useState(false);
  const telegramConnection = useTelegramConnection(true);
  const showStagingBanner = orgContext ? shouldShowMcpConnectionsStagingBanner(orgContext.capabilities) : false;
  const [pollingConnectionId, setPollingConnectionId] = useState<string | null>(null);
  const [oauthClientConfigurationRequiredIds, setOAuthClientConfigurationRequiredIds] = useState<string[]>([]);
  const [connectionActionError, setConnectionActionError] = useState<{ connectionId: string; message: string } | null>(null);
  const [connectionActionNotice, setConnectionActionNotice] = useState<string | null>(null);
  const [toolsConnectionId, setToolsConnectionId] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const handledQuickAddId = useRef<string | null>(null);

  function openQuickAdd(id: string) {
    if (id === GOOGLE_WORKSPACE_QUICK_ADD_ID) {
      setGoogleDialogOpen(true);
      return;
    }
    if (id === MICROSOFT_365_QUICK_ADD_ID) {
      setMicrosoftDialogOpen(true);
      return;
    }
    if (id === TELEGRAM_QUICK_ADD_ID) {
      setTelegramDialogOpen(true);
      return;
    }

    const preset = presets.find((entry) => entry.presetId === id);
    if (!preset) return;
    setFormPreset(preset);
    setFormOpen(true);
  }

  useEffect(() => {
    const quickAddId = searchParams.get("quickAdd");
    if (!quickAddId || handledQuickAddId.current === quickAddId) return;
    const isKnownTarget = quickAddId === GOOGLE_WORKSPACE_QUICK_ADD_ID
      || quickAddId === MICROSOFT_365_QUICK_ADD_ID
      || quickAddId === TELEGRAM_QUICK_ADD_ID
      || presets.some((preset) => preset.presetId === quickAddId);
    if (!isKnownTarget) return;
    handledQuickAddId.current = quickAddId;
    openQuickAdd(quickAddId);
  }, [presets, searchParams]);

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []);

  function stopPolling() {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    setPollingConnectionId(null);
  }

  function pollUntilConnected(connectionId: string) {
    setPollingConnectionId(connectionId);
    const startedAt = Date.now();
    pollTimer.current = setInterval(async () => {
      const result = await refetch();
      const connection = result.data?.find((entry) => entry.id === connectionId);
      if (connection?.connected || Date.now() - startedAt > OAUTH_POLL_TIMEOUT_MS) {
        stopPolling();
      }
    }, OAUTH_POLL_INTERVAL_MS);
  }

  async function handleConnectOAuth(connectionId: string, pendingAuthorizationWindow?: Window) {
    setConnectionActionError(null);
    let authorizationWindow: Window | null = pendingAuthorizationWindow ?? null;
    try {
      authorizationWindow = authorizationWindow ?? openMcpAuthorizationWindow();
      const result = await startOAuth.mutateAsync(connectionId);
      if (result.status === "connected") {
        authorizationWindow.close();
        void refetch();
        return;
      }
      if (!result.authorizeUrl) throw new Error("MCP 服务未返回授权地址。");
      authorizationWindow.location.href = safeMcpAuthorizationUrl(result.authorizeUrl);
      pollUntilConnected(connectionId);
    } catch (connectError) {
      const message = getErrorMessage(connectError instanceof Error ? connectError.message : null, "连接 MCP 服务失败。");
      showMcpAuthorizationError(authorizationWindow, {
        message,
        ...(connectError instanceof McpOAuthStartError
          ? { details: connectError.details }
          : {}),
      });
      if (connectError instanceof McpOAuthConfigurationRequiredError) {
        setOAuthClientConfigurationRequiredIds((current) => current.includes(connectionId)
          ? current
          : [...current, connectionId]);
        return;
      }
      setConnectionActionError({
        connectionId,
        message,
      });
    }
  }

  async function handleCreate(
    input: CreateMcpConnectionInput,
    options: { startOAuth: boolean },
  ): Promise<void> {
    const authorizationWindow = options.startOAuth
      ? openMcpAuthorizationWindow()
      : undefined;
    try {
      const created = await createConnection.mutateAsync(input);
      setFormOpen(false);
      setFormPreset(null);
      // Shared-credential OAuth: the admin authorizes the org's single account
      // right now. Per-member: nothing to authorize here — each granted person
      // connects their own account from Your Connections.
      if (options.startOAuth) {
        await handleConnectOAuth(created.id, authorizationWindow);
      }
    } catch (createError) {
      showMcpAuthorizationError(authorizationWindow ?? null, {
        message: getErrorMessage(createError instanceof Error ? createError.message : null, "创建 MCP 连接失败。"),
      });
      throw createError;
    }
  }

  async function handleUpdate(input: UpdateMcpConnectionInput): Promise<UpdatedMcpConnection> {
    setConnectionActionError(null);
    setConnectionActionNotice(null);
    const updated = await updateConnection.mutateAsync(input);
    setOAuthClientConfigurationRequiredIds((current) => current.filter((connectionId) => connectionId !== input.connectionId));
    setEditingConnection(null);
    setConfiguringOAuthClient(false);
    setConnectionActionNotice(updated.reconnectionRequired
      ? `${updated.name} 已安全保存。请重新连接后使用新的身份配置。`
      : updated.identityChanged
        ? `${updated.name} 已保存，替换配置验证通过。`
        : `${updated.name} 已更新，现有连接保持有效。`);
    return updated;
  }

  function handleRemove(connection: ExternalMcpConnection) {
    const confirmed = window.confirm(
      `删除 ${connection.name}？相关访问授权、成员认证状态以及插件或能力市场绑定都会被移除。`,
    );
    if (confirmed) deleteConnection.mutate(connection.id);
  }

  async function handleDisconnect(connection: ExternalMcpConnection) {
    const confirmed = window.confirm(
      `断开 ${connection.name}？所有关联账号都会退出，但会保留 MCP 服务配置、访问规则以及插件或能力市场绑定，之后可以重新连接。`,
    );
    if (!confirmed) return;
    setConnectionActionError(null);
    setConnectionActionNotice(null);
    try {
      await disconnectConnection.mutateAsync(connection.id);
      setConnectionActionNotice(`${connection.name} 已断开，配置、访问规则和绑定均已保留。`);
    } catch (disconnectError) {
      setConnectionActionError({
        connectionId: connection.id,
        message: getErrorMessage(disconnectError instanceof Error ? disconnectError.message : null, "断开 MCP 连接失败。"),
      });
    }
  }

  async function handleOpenIssuerReview(connection: ExternalMcpConnection) {
    reviewIssuer.reset();
    setIssuerReviewConnection(connection);
    setIssuerReviewPreview(null);
    try {
      const preview = await reviewIssuer.mutateAsync({
        connectionId: connection.id,
        action: "preview",
      });
      setIssuerReviewPreview(preview);
    } catch {
      // The dialog renders the mutation error with a retry path.
    }
  }

  async function handleConfirmIssuer(authorizationServerIssuer: string) {
    const connection = issuerReviewConnection;
    if (!connection?.updatedAt) return;
    const result = await reviewIssuer.mutateAsync({
      connectionId: connection.id,
      action: "confirm",
      expectedUpdatedAt: connection.updatedAt,
      authorizationServerIssuer,
    });
    setIssuerReviewConnection(null);
    setIssuerReviewPreview(null);
    setConnectionActionNotice(result.reconnectionRequired
      ? `${connection.name} 已信任确认后的签发方。旧 OAuth 客户端和凭据已清除，请重新连接以完成恢复。`
      : `${connection.name} 的当前签发方已通过服务元数据确认。`);
  }

  return (
    <DashboardPageTemplate
      icon={Plug}
      title="公司连接"
      badgeLabel="测试中"
      description="添加可由全体成员或指定团队使用的 MCP 服务。"
      colors={["#E2E8F0", "#020617", "#0F172A", "#94A3B8"]}
    >
      {showStagingBanner ? (
        <div data-testid="mcp-connections-staging-banner" className="mb-6 rounded-[24px] border border-amber-200 bg-amber-50 px-5 py-4 text-[14px] leading-6 text-amber-800">
          <p className="font-semibold text-amber-900">公司连接功能尚未向成员开放。</p>
          <p className="mt-1">
            管理员可以继续完成连接和能力市场配置。功能开放前，普通成员不会看到这些内容。
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="mb-6 rounded-[24px] border border-red-200 bg-red-50 px-5 py-4 text-[14px] text-red-700">
          {getErrorMessage(error instanceof Error ? error.message : null, "加载 MCP 连接失败。")}
        </div>
      ) : null}

      {connectionActionError ? (
        <div className="mb-6 rounded-[24px] border border-red-200 bg-red-50 px-5 py-4 text-[14px] text-red-700" role="alert">
          {connectionActionError.message}
        </div>
      ) : null}

      {connectionActionNotice ? (
        <div className="mb-6 rounded-[24px] border border-emerald-200 bg-emerald-50 px-5 py-4 text-[14px] text-emerald-800" role="status">
          {connectionActionNotice}
        </div>
      ) : null}

      <div className="mb-6">
        <DenButton
          type="button"
          icon={Server}
          onClick={() => {
            setFormPreset(null);
            setFormOpen(true);
          }}
        >
          添加 MCP
        </DenButton>
      </div>

      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">快速添加</h3>
      <div className="mb-8">
        <ConnectorQuickAddGrid
          connections={connections}
          presets={presets}
          telegramConnected={Boolean(telegramConnection.data)}
          onSelect={openQuickAdd}
        />
      </div>

      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">已有连接</h3>
      {isLoading ? (
        <div className="rounded-[28px] border border-gray-200 bg-white px-6 py-10 text-[15px] text-gray-500">
          正在加载 MCP 连接…
        </div>
      ) : connections.length === 0 ? (
        <div className="rounded-[28px] border border-gray-200 bg-white px-6 py-10 text-center text-[14px] text-gray-500">
          暂无 MCP 连接。
        </div>
      ) : (
        <div className="divide-y divide-gray-100 rounded-2xl border border-gray-100 bg-white">
          {connections.map((connection) => {
            const connectAttemptRequiresConfiguration = oauthClientConfigurationRequiredIds.includes(connection.id);
            const needsOAuthClientConfiguration = connectionNeedsOAuthClientConfiguration(
              connection,
              connectAttemptRequiresConfiguration,
            );
            const needsPluginSetup = marketplaceConnectionNeedsAdminSetup(connection, presets)
              && !needsOAuthClientConfiguration;
            const setupPluginId = connection.identityManagedBy[0]?.pluginId;
            return <ConnectionRow
              key={connection.id}
              connection={connection}
              needsPluginSetup={needsPluginSetup}
              needsOAuthClientConfiguration={needsOAuthClientConfiguration}
              setupHref={needsPluginSetup && setupPluginId ? getPluginRoute(orgSlug, setupPluginId) : null}
              polling={pollingConnectionId === connection.id}
              connecting={startOAuth.isPending && startOAuth.variables === connection.id}
              errorMessage={connectionActionError?.connectionId === connection.id ? connectionActionError.message : null}
              onEdit={() => {
                updateConnection.reset();
                setConfiguringOAuthClient(false);
                setEditingConnection(connection);
              }}
              onConfigure={() => {
                updateConnection.reset();
                setConfiguringOAuthClient(true);
                setEditingConnection(connection);
              }}
              onReviewIssuer={() => void handleOpenIssuerReview(connection)}
              onConnect={() => void handleConnectOAuth(connection.id)}
              onDisconnect={() => void handleDisconnect(connection)}
              onRemove={() => handleRemove(connection)}
              disconnecting={disconnectConnection.isPending && disconnectConnection.variables === connection.id}
              removing={deleteConnection.isPending && deleteConnection.variables === connection.id}
              toolsOpen={toolsConnectionId === connection.id}
              onToggleTools={() => setToolsConnectionId((current) => current === connection.id ? null : connection.id)}
            />;
          })}
        </div>
      )}

      <AddConnectionDialog
        open={formOpen}
        preset={formPreset}
        submitting={createConnection.isPending}
        error={createConnection.error}
        onClose={() => {
          setFormOpen(false);
          setFormPreset(null);
        }}
        onSubmit={handleCreate}
      />

      <EditConnectionDialog
        connection={editingConnection}
        configureOAuthClient={configuringOAuthClient}
        submitting={updateConnection.isPending}
        error={updateConnection.error}
        onClose={() => {
          updateConnection.reset();
          setConfiguringOAuthClient(false);
          setEditingConnection(null);
        }}
        onSubmit={handleUpdate}
      />

      <IssuerReviewDialog
        connection={issuerReviewConnection}
        preview={issuerReviewPreview}
        loading={reviewIssuer.isPending}
        error={reviewIssuer.error}
        onRetry={() => issuerReviewConnection ? void handleOpenIssuerReview(issuerReviewConnection) : undefined}
        onClose={() => {
          if (reviewIssuer.isPending) return;
          setIssuerReviewConnection(null);
          setIssuerReviewPreview(null);
          reviewIssuer.reset();
        }}
        onConfirm={(issuer) => void handleConfirmIssuer(issuer)}
      />

      <GoogleWorkspaceDialog
        open={googleDialogOpen}
        submitting={saveNativeClient.isPending}
        error={saveNativeClient.error}
        onClose={() => setGoogleDialogOpen(false)}
        onSubmit={async (input) => {
          await saveNativeClient.mutateAsync({ providerId: "google-workspace", ...input });
          setGoogleDialogOpen(false);
        }}
      />

      <Microsoft365Dialog
        open={microsoftDialogOpen}
        submitting={saveNativeClient.isPending}
        error={saveNativeClient.error}
        onClose={() => setMicrosoftDialogOpen(false)}
        onSubmit={async (input) => {
          await saveNativeClient.mutateAsync({ providerId: "microsoft-365", ...input });
          setMicrosoftDialogOpen(false);
        }}
      />

      <TelegramDialog open={telegramDialogOpen} onClose={() => setTelegramDialogOpen(false)} />
    </DashboardPageTemplate>
  );
}

function ImportPluginConnectionDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const queryClient = useQueryClient();
  const { orgSlug, runReauthableAction } = useOrgDashboard();
  const { data: marketplaces = [] } = useMarketplaces();
  const { data: plugins = [], isLoading: pluginsLoading } = usePlugins();
  const [githubUrl, setGithubUrl] = useState("");
  const [marketplaceId, setMarketplaceId] = useState("");
  const [authType, setAuthType] = useState<"oauth" | "none">("oauth");
  const [credentialMode, setCredentialMode] = useState<ExternalMcpCredentialMode>("per_member");
  const [preview, setPreview] = useState<GithubPluginImportPreview | null>(null);
  const [selectedServerKeys, setSelectedServerKeys] = useState<string[]>([]);
  const [selectedSkillKeys, setSelectedSkillKeys] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (!marketplaceId && marketplaces.length > 0) {
      setMarketplaceId(marketplaces[0].id);
    }
  }, [marketplaceId, marketplaces, open]);

  useEffect(() => {
    if (!open) return;
    setGithubUrl("");
    setAuthType("oauth");
    setCredentialMode("per_member");
    setPreview(null);
    setSelectedServerKeys([]);
    setSelectedSkillKeys([]);
    setError(null);
  }, [open]);

  const libraryPlugins = useMemo(
    () => plugins.filter((plugin) => plugin.mcps.length > 0 || plugin.skills.length > 0),
    [plugins],
  );

  async function previewGithubPlugin() {
    if (!githubUrl.trim()) {
      setError("请粘贴 GitHub 插件地址。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let payload: unknown = null;
      await runReauthableAction("preview-github-connection-plugin", async () => {
        const result = await requestJson(
          "/v1/plugins/import-mcps-from-github-url/preview",
          { method: "POST", body: JSON.stringify({ githubUrl: githubUrl.trim() }) },
          20000,
        );
        if (!result.response.ok) {
          throw getRequestError(result.payload, result.response, "无法预览 GitHub 插件。");
        }
        payload = result.payload;
      });
      const nextPreview = parseGithubPluginImportPreview(payload);
      setPreview(nextPreview);
      setSelectedServerKeys(nextPreview.servers.filter((server) => server.supported).map((server) => server.serverKey));
      setSelectedSkillKeys(nextPreview.skills.filter((skill) => skill.supported).map((skill) => skill.skillKey));
    } catch (previewError) {
      setError(getErrorMessage(previewError instanceof Error ? previewError.message : null, "无法预览 GitHub 插件。"));
    } finally {
      setBusy(false);
    }
  }

  async function importGithubPlugin() {
    if (!preview) {
      setError("请先预览 GitHub 插件。");
      return;
    }
    if (!marketplaceId) {
      setError("请选择能力市场。");
      return;
    }
    if (selectedServerKeys.length === 0 && selectedSkillKeys.length === 0) {
      setError("请至少选择一项 MCP 或 Skill。");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await runReauthableAction("import-github-connection-plugin", async () => {
        const result = await requestJson(
          "/v1/plugins/import-mcps-from-github-url",
          {
            method: "POST",
            body: JSON.stringify({
              access: { orgWide: true, memberIds: [], teamIds: [] },
              authType,
              credentialMode: authType === "oauth" ? credentialMode : "shared",
              githubUrl: githubUrl.trim(),
              marketplaceId,
              selectedServerKeys,
              selectedSkillKeys,
            }),
          },
          30000,
        );
        if (!result.response.ok) {
          throw getRequestError(result.payload, result.response, "导入 GitHub 插件失败。");
        }
      });
      await queryClient.invalidateQueries({ queryKey: mcpConnectionQueryKeys.all });
      await queryClient.invalidateQueries({ queryKey: pluginQueryKeys.all });
      await queryClient.invalidateQueries({ queryKey: marketplaceQueryKeys.all });
      onImported();
      onClose();
    } catch (importError) {
      setError(getErrorMessage(importError instanceof Error ? importError.message : null, "导入 GitHub 插件失败。"));
    } finally {
      setBusy(false);
    }
  }

  function toggleServer(serverKey: string, checked: boolean) {
    setSelectedServerKeys((current) =>
      checked ? [...new Set([...current, serverKey])] : current.filter((key) => key !== serverKey),
    );
  }

  function toggleSkill(skillKey: string, checked: boolean) {
    setSelectedSkillKeys((current) =>
      checked ? [...new Set([...current, skillKey])] : current.filter((key) => key !== skillKey),
    );
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-[28px] border border-gray-200 bg-white p-6 shadow-[0_24px_80px_-32px_rgba(15,23,42,0.45)]"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-gray-950">添加插件连接</h2>
        <p className="mt-1 text-[13px] leading-6 text-gray-600">
          从 GitHub 导入插件。远程 MCP 会成为公司托管连接，导入的 Skills 会保存到公司能力库并按授权下发。
        </p>

        <div className="mt-5 rounded-2xl border border-gray-100 bg-gray-50 p-4">
          <label className="mb-1.5 block text-[12px] font-medium text-gray-700">GitHub 插件地址</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <DenInput
              value={githubUrl}
              onChange={(event) => {
                setGithubUrl(event.target.value);
                setPreview(null);
                setSelectedServerKeys([]);
                setSelectedSkillKeys([]);
                setError(null);
              }}
              placeholder="请输入公司 GitHub 能力仓库地址"
              disabled={busy}
            />
            <DenButton variant="secondary" onClick={() => void previewGithubPlugin()} disabled={busy || !githubUrl.trim()}>
              {busy && !preview ? "正在预览..." : "预览"}
            </DenButton>
          </div>
        </div>

        {preview ? (
          <div className="mt-4 space-y-4">
            <div className="rounded-2xl border border-gray-100 bg-white px-4 py-3 text-[13px] text-gray-600">
              找到 {preview.servers.filter((server) => server.supported).length} 项 MCP 和 {preview.skills.filter((skill) => skill.supported).length} 项 Skill，来源：{" "}
              <span className="font-medium text-gray-900">{preview.repositoryFullName}{preview.rootPath ? `/${preview.rootPath}` : ""}</span>.
            </div>

            {preview.servers.length > 0 ? (
              <div className="overflow-hidden rounded-2xl border border-gray-100">
                <table className="w-full text-left text-[13px]">
                  <thead className="bg-gray-50 text-[11px] uppercase tracking-[0.12em] text-gray-400">
                    <tr>
                      <th className="w-12 px-4 py-3">选择</th>
                      <th className="px-4 py-3">MCP</th>
                      <th className="px-4 py-3">URL</th>
                      <th className="px-4 py-3">状态</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {preview.servers.map((server) => (
                      <tr key={server.serverKey}>
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedServerKeys.includes(server.serverKey)}
                            disabled={!server.supported || busy}
                            onChange={(event) => toggleServer(server.serverKey, event.target.checked)}
                          />
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">{server.name}</td>
                        <td className="max-w-[240px] truncate px-4 py-3 font-mono text-[12px] text-gray-500">{server.url ?? "—"}</td>
                        <td className="px-4 py-3 text-gray-500">{importServerStatus(server)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {preview.skills.length > 0 ? (
              <div className="overflow-hidden rounded-2xl border border-gray-100">
                <table className="w-full text-left text-[13px]">
                  <thead className="bg-gray-50 text-[11px] uppercase tracking-[0.12em] text-gray-400">
                    <tr>
                      <th className="w-12 px-4 py-3">选择</th>
                      <th className="px-4 py-3">Skill（技能）</th>
                      <th className="px-4 py-3">路径</th>
                      <th className="px-4 py-3">状态</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {preview.skills.map((skill) => (
                      <tr key={skill.skillKey}>
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedSkillKeys.includes(skill.skillKey)}
                            disabled={!skill.supported || busy}
                            onChange={(event) => toggleSkill(skill.skillKey, event.target.checked)}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{skill.name}</div>
                          {skill.description ? <div className="mt-0.5 text-[12px] text-gray-500">{skill.description}</div> : null}
                        </td>
                        <td className="max-w-[240px] truncate px-4 py-3 font-mono text-[12px] text-gray-500">{skill.sourcePath}</td>
                        <td className="px-4 py-3 text-gray-500">{skill.supported ? "可导入" : "暂不支持"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-gray-700">身份验证</span>
                <DenSelect value={authType} onChange={(event) => setAuthType(event.target.value === "none" ? "none" : "oauth")} disabled={busy}>
                  <option value="oauth">OAuth</option>
                  <option value="none">无需身份验证</option>
                </DenSelect>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-gray-700">账号模式</span>
                <DenSelect
                  value={credentialMode}
                  onChange={(event) => setCredentialMode(event.target.value === "shared" ? "shared" : "per_member")}
                  disabled={busy || authType === "none"}
                >
                  <option value="per_member">成员各自连接</option>
                  <option value="shared">公司共用账号</option>
                </DenSelect>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-gray-700">能力市场</span>
                <DenSelect value={marketplaceId} onChange={(event) => setMarketplaceId(event.target.value)} disabled={busy}>
                  {marketplaces.map((marketplace) => (
                    <option key={marketplace.id} value={marketplace.id}>
                      {marketplace.name}
                    </option>
                  ))}
                </DenSelect>
              </label>
            </div>
          </div>
        ) : null}

        <div className="mt-6">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-gray-400">插件库</h3>
          <div className="mt-3 rounded-2xl border border-gray-100 bg-white">
            {pluginsLoading ? (
              <div className="px-4 py-5 text-[13px] text-gray-500">正在加载插件库...</div>
            ) : libraryPlugins.length === 0 ? (
              <div className="px-4 py-5 text-[13px] text-gray-500">暂无包含 MCP 或 Skills 的已导入插件。</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {libraryPlugins.slice(0, 6).map((plugin) => (
                  <Link
                    key={plugin.id}
                    href={getPluginRoute(orgSlug, plugin.id)}
                    className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-gray-50"
                    onClick={onClose}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold text-gray-900">{plugin.name}</span>
                      <span className="mt-0.5 block truncate text-[12px] text-gray-500">{getPluginPartsSummary(plugin)}</span>
                    </span>
                    <span className="text-[12px] font-medium text-gray-500">打开</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {error ? (
          <p className="mt-3 text-[13px] text-red-600">{error}</p>
        ) : null}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DenButton variant="secondary" onClick={onClose} disabled={busy}>
            取消
          </DenButton>
          <DenButton
            variant="primary"
            loading={busy && Boolean(preview)}
            disabled={!preview || !marketplaceId || (selectedServerKeys.length === 0 && selectedSkillKeys.length === 0)}
            onClick={() => void importGithubPlugin()}
          >
            导入所选内容
          </DenButton>
        </div>
      </div>
    </div>
  );
}

function GoogleWorkspaceDialog({
  open,
  submitting,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  submitting: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (input: { clientId?: string; clientSecret?: string; features: string[] }) => void;
}) {
  const clientConfig = useNativeProviderClient("google-workspace", open);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [features, setFeatures] = useState<string[]>([]);
  const [copiedRedirectUri, setCopiedRedirectUri] = useState(false);
  const [replacingCredentials, setReplacingCredentials] = useState(false);
  const featuresPrefilled = useRef(false);

  useEffect(() => {
    if (!open) return;
    setClientId("");
    setClientSecret("");
    setFeatures(GOOGLE_WORKSPACE_DEFAULT_FEATURES);
    setCopiedRedirectUri(false);
    setReplacingCredentials(false);
    featuresPrefilled.current = false;
  }, [open]);

  useEffect(() => {
    if (!open || featuresPrefilled.current || !clientConfig.isSuccess || clientConfig.isFetching) return;
    setFeatures(clientConfig.data.features);
    featuresPrefilled.current = true;
  }, [open, clientConfig.isSuccess, clientConfig.isFetching, clientConfig.data?.features]);

  if (!open) {
    return null;
  }

  const configured = clientConfig.data?.configured ?? false;
  const savedClientId = clientConfig.data?.clientId;
  const redirectUri = clientConfig.data?.redirectUri ?? "";
  const loadingConfig = clientConfig.isLoading;
  const formError = error ?? clientConfig.error;
  const trimmedClientId = clientId.trim();
  const trimmedClientSecret = clientSecret.trim();
  const showCredentialFields = !loadingConfig && (!configured || replacingCredentials);
  const saveDisabled = loadingConfig || (showCredentialFields && (!trimmedClientId || !trimmedClientSecret));

  function toggleFeature(feature: string) {
    setFeatures((current) => current.includes(feature) ? current.filter((entry) => entry !== feature) : [...current, feature]);
  }

  async function copyRedirectUri() {
    if (!redirectUri) return;
    if (await copyTextToClipboard(redirectUri)) setCopiedRedirectUri(true);
  }

  function startReplacingCredentials() {
    setClientId(savedClientId ?? "");
    setClientSecret("");
    setReplacingCredentials(true);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6" onClick={onClose}>
      <div
        className="max-h-[calc(100vh-3rem)] w-full max-w-lg overflow-y-auto rounded-[28px] border border-gray-200 bg-white p-6 shadow-[0_24px_80px_-32px_rgba(15,23,42,0.45)]"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-gray-950">
          {configured ? "更新 Google Workspace" : "配置 Google Workspace"}
        </h2>
        <p className="mt-1 text-[13px] leading-6 text-gray-600">
          公司统一使用一个 Google OAuth 网页应用，每位成员再从“我的连接”中登录自己的 Google 账号。
        </p>

        <div className="mt-5 space-y-4">
          <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
            <p className="text-[13px] font-semibold text-gray-900">配置方法</p>
            <ol className="mt-2 list-decimal space-y-2 pl-4 text-[12px] leading-5 text-gray-600">
              <li>
                在 Google Cloud Console 中为网页应用创建 OAuth 客户端 ID。{" "}
                <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener" className="font-medium text-gray-900 underline decoration-gray-300 underline-offset-4">
                  打开 Google Cloud Console
                </a>
              </li>
              <li>
                <p>添加以下授权重定向地址：</p>
                <div className="mt-1 flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-2">
                  <p data-google-redirect-uri className="min-w-0 flex-1 break-all font-mono text-[11px] leading-5 text-gray-800">
                    {redirectUri || "正在加载重定向地址…"}
                  </p>
                  <DenButton variant="secondary" size="sm" data-testid="copy-redirect-uri" onClick={copyRedirectUri} disabled={!redirectUri}>
                    {copiedRedirectUri ? "已复制" : "复制"}
                  </DenButton>
                </div>
              </li>
              <li>
                根据所选权限启用对应的 Google API（Gmail、日历、Drive）。{" "}
                <a href="https://console.cloud.google.com/apis/library" target="_blank" rel="noopener" className="font-medium text-gray-900 underline decoration-gray-300 underline-offset-4">
                  打开 API 库
                </a>
              </li>
              <li>首次配置时在此粘贴客户端 ID 和密钥；之后仅在更换凭据时需要重新填写。</li>
            </ol>
          </div>
          <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
            <p className="text-[13px] font-semibold text-gray-900">权限</p>
            <p className="mt-1 text-[12px] leading-5 text-gray-500">
              选择公司助手可以在日历、Gmail 和 Drive 中执行的操作。登录时会提供成员姓名和邮箱。
            </p>
            <div className="mt-3 space-y-3">
              {GOOGLE_WORKSPACE_PERMISSION_GROUPS.map((group) => (
                <div key={group.name}>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">{group.name}</p>
                  <div className="space-y-2">
                    {group.permissions.map((permission) => (
                      <label key={permission.key} className="flex items-center gap-2 text-[13px] text-gray-700">
                        <input
                          type="checkbox"
                          data-feature={permission.key}
                          className="h-4 w-4 rounded border-gray-300 text-gray-900"
                          checked={features.includes(permission.key)}
                          disabled={loadingConfig}
                          onChange={() => toggleFeature(permission.key)}
                        />
                        <span>{permission.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {loadingConfig ? (
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-[13px] text-gray-500">
              正在检查已保存的凭据…
            </div>
          ) : null}
          {configured && !replacingCredentials ? (
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-600" />
                <p className="text-[13px] font-semibold text-gray-900">凭据已保存</p>
              </div>
              <p className="mt-1 text-[12px] leading-5 text-gray-500">
                保存权限更改时，FoxWork 会保留现有 Google 客户端 ID 和密钥。仅在轮换凭据时需要替换。
              </p>
              <div className="mt-3 rounded-xl border border-gray-100 bg-white px-3 py-2 text-[12px] text-gray-800">
                已保存的客户端 ID：<span className="font-mono">{savedClientId ?? "已保存在 FoxWork"}</span>
              </div>
              <DenButton className="mt-3" variant="secondary" size="sm" onClick={startReplacingCredentials} disabled={submitting}>
                替换凭据
              </DenButton>
            </div>
          ) : null}
          {showCredentialFields ? (
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <p className="text-[13px] font-semibold text-gray-900">Google OAuth 凭据</p>
              <p className="mt-1 text-[12px] leading-5 text-gray-500">
                {replacingCredentials
                  ? "粘贴新的客户端 ID 和客户端密钥，两项都必须填写。"
                  : "粘贴 Google OAuth 应用的客户端 ID 和客户端密钥，首次配置时两项都必须填写。"}
              </p>
              <div className="mt-3 space-y-3">
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-gray-700">客户端 ID</label>
                  <McpCredentialInput
                    kind="identifier"
                    name="google-workspace-oauth-client-id"
                    value={clientId}
                    onChange={(event) => setClientId(event.target.value)}
                    placeholder="1234567890-abc.apps.googleusercontent.com"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-gray-700">客户端密钥</label>
                  <McpCredentialInput
                    kind="secret"
                    name="google-workspace-oauth-client-secret"
                    value={clientSecret}
                    onChange={(event) => setClientSecret(event.target.value)}
                    placeholder="GOCSPX-…"
                  />
                </div>
              </div>
              {replacingCredentials ? (
                <DenButton className="mt-3" variant="secondary" size="sm" onClick={() => setReplacingCredentials(false)} disabled={submitting}>
                  保留现有凭据
                </DenButton>
              ) : null}
            </div>
          ) : null}
        </div>

        {formError ? (
          <DenNotice message={getErrorMessage(formError instanceof Error ? formError.message : null, "保存 OAuth 客户端失败。")} className="mt-3" />
        ) : null}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DenButton variant="secondary" onClick={onClose} disabled={submitting}>
            取消
          </DenButton>
          <DenButton
            variant="primary"
            loading={submitting}
            disabled={saveDisabled}
            onClick={() => onSubmit({
              ...(showCredentialFields ? { clientId: trimmedClientId, clientSecret: trimmedClientSecret } : {}),
              features,
            })}
          >
            {configured && !replacingCredentials ? "保存权限" : replacingCredentials ? "保存新凭据" : "保存配置"}
          </DenButton>
        </div>
      </div>
    </div>
  );
}

function IssuerReviewDialog({
  connection,
  preview,
  loading,
  error,
  onRetry,
  onClose,
  onConfirm,
}: {
  connection: ExternalMcpConnection | null;
  preview: McpIssuerReview | null;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  onClose: () => void;
  onConfirm: (issuer: string) => void;
}) {
  const [selectedIssuer, setSelectedIssuer] = useState("");

  useEffect(() => {
    if (!preview) {
      setSelectedIssuer("");
      return;
    }
    setSelectedIssuer(
      preview.currentIssuer && preview.advertisedIssuers.includes(preview.currentIssuer)
        ? preview.currentIssuer
        : preview.advertisedIssuers[0] ?? "",
    );
  }, [preview]);

  if (!connection) return null;
  const issuerWillChange = Boolean(preview && selectedIssuer && selectedIssuer !== preview.currentIssuer);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/35 px-4" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcp-issuer-review-title"
        className="w-full max-w-xl rounded-[28px] border border-gray-100 bg-white p-6 shadow-2xl shadow-gray-950/20"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 id="mcp-issuer-review-title" className="text-[18px] font-semibold text-gray-950">复核 OAuth 服务</h2>
            <p className="mt-1 text-[13px] leading-5 text-gray-600">
              {connection.name} 当前返回的 OAuth 信息与上次确认的签发方不同。
            </p>
          </div>
        </div>

        {loading && !preview ? (
          <div className="mt-6 flex items-center gap-2 rounded-2xl bg-gray-50 px-4 py-4 text-[13px] text-gray-600">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            正在读取服务端最新的 OAuth 信息...
          </div>
        ) : error && !preview ? (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-[13px] text-red-700" role="alert">
            <p>{error.message}</p>
            <DenButton className="mt-3" variant="secondary" size="sm" onClick={onRetry}>重试</DenButton>
          </div>
        ) : preview ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">上次确认</p>
              <p className="mt-1 break-all font-mono text-[12px] text-gray-700">{preview.currentIssuer ?? "尚未选择签发方"}</p>
            </div>
            <fieldset>
              <legend className="text-[13px] font-semibold text-gray-900">当前签发方</legend>
              <div className="mt-2 space-y-2">
                {preview.advertisedIssuers.map((issuer) => (
                  <label key={issuer} className="flex cursor-pointer items-start gap-3 rounded-2xl border border-gray-200 px-4 py-3 transition has-[:checked]:border-gray-950 has-[:checked]:bg-gray-50">
                    <input
                      type="radio"
                      name="mcp-oauth-issuer"
                      value={issuer}
                      checked={selectedIssuer === issuer}
                      onChange={() => setSelectedIssuer(issuer)}
                      className="mt-0.5"
                    />
                    <span className="break-all font-mono text-[12px] text-gray-700">{issuer}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className={`rounded-2xl px-4 py-3 text-[12px] leading-5 ${issuerWillChange ? "bg-amber-50 text-amber-800" : "bg-blue-50 text-blue-800"}`}>
              {issuerWillChange
                ? "确认新的签发方后，旧 OAuth 客户端和凭据会被清除，所有成员都需要重新连接。"
                : "继续确认会清除过期的发现缓存，不会退出任何人的账号。"}
            </div>
            {error ? <p className="text-[12px] text-red-600" role="alert">{error.message}</p> : null}
          </div>
        ) : null}

        <div className="mt-6 flex justify-end gap-2">
          <DenButton variant="secondary" size="sm" disabled={loading} onClick={onClose}>取消</DenButton>
          <DenButton
            variant="primary"
            size="sm"
            loading={loading && Boolean(preview)}
            disabled={!preview || !selectedIssuer}
            onClick={() => onConfirm(selectedIssuer)}
          >
            确认签发方
          </DenButton>
        </div>
      </div>
    </div>
  );
}

function accessSummaryLabel(connection: ExternalMcpConnection): string {
  const access = connection.access;
  if (!access) return "";
  if (access.orgWide) return "全公司可用";
  const parts: string[] = [];
  if (access.teamIds.length > 0) parts.push(`${access.teamIds.length} 个团队`);
  if (access.memberIds.length > 0) parts.push(`${access.memberIds.length} 名成员`);
  return parts.length > 0 ? parts.join("，") : "尚未授权";
}

function ConnectionRow({
  connection,
  needsPluginSetup,
  needsOAuthClientConfiguration,
  setupHref,
  polling,
  connecting,
  errorMessage,
  onEdit,
  onConfigure,
  onReviewIssuer,
  onConnect,
  onDisconnect,
  onRemove,
  disconnecting,
  removing,
  toolsOpen,
  onToggleTools,
}: {
  connection: ExternalMcpConnection;
  needsPluginSetup: boolean;
  needsOAuthClientConfiguration: boolean;
  setupHref: string | null;
  polling: boolean;
  connecting: boolean;
  errorMessage: string | null;
  onEdit: () => void;
  onConfigure: () => void;
  onReviewIssuer: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onRemove: () => void;
  disconnecting: boolean;
  removing: boolean;
  toolsOpen: boolean;
  onToggleTools: () => void;
}) {
  const isPerMember = connection.credentialMode === "per_member";
  const creatorAttribution = formatConnectionCreatorAttribution(connection.createdByName);
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const actionsTriggerRef = useRef<HTMLButtonElement>(null);
  const setupRequired = needsPluginSetup || needsOAuthClientConfiguration;
  const displayedConnected = connection.connected && !setupRequired;
  const canConnectOAuth = !setupRequired && !connection.issuerReviewRequired && connection.authType === "oauth"
    && (isPerMember ? !connection.connectedForMe : !connection.connected);
  const canInspectTools = !setupRequired && !connection.issuerReviewRequired
    && (connection.credentialMode === "shared" ? connection.connected : connection.connectedForMe);

  useEffect(() => {
    if (!actionsOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !actionsMenuRef.current?.contains(event.target)) {
        setActionsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setActionsOpen(false);
      actionsTriggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [actionsOpen]);

  return (
    <div data-testid={`mcp-connection-row-${connection.id}`}>
      <div className="flex flex-col gap-4 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <IntegrationIcon name={connection.name} serviceUrl={connection.url} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-[14px] font-semibold text-gray-900">{connection.name}</p>
              {setupRequired ? (
                <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                  需要配置
                </span>
              ) : connection.issuerReviewRequired ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                  <AlertTriangle className="h-3 w-3" />
                  需要复核 OAuth 设置
                </span>
              ) : isPerMember ? (
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${connection.connected ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                  <Users className="h-3 w-3" />
                  {connection.connected ? "已有成员账号连接" : "未连接"}
                </span>
              ) : displayedConnected ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                  <Check className="h-3 w-3" />
                  已连接
                </span>
              ) : polling ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  等待授权...
                </span>
              ) : (
                <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
                  未连接
                </span>
              )}
              {connection.access ? (
                <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
                  {accessSummaryLabel(connection)}
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 truncate text-[12px] text-gray-500">
              {connection.url}{setupRequired ? "" : ` · ${formatMcpConnectedTimestamp(connection.connectedAt)}`}{creatorAttribution ? ` · ${creatorAttribution}` : ""}
            </p>
            {connection.authType === "oauth" ? (
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
                {connection.authorizationServerIssuer ? <span className="max-w-full truncate">签发方：{connection.authorizationServerIssuer}</span> : null}
                {(connection.requestedScopes?.length ?? 0) > 0 ? <span>授权范围：{connection.requestedScopes?.join(", ")}</span> : null}
              </div>
            ) : null}
            {errorMessage ? <p className="mt-1 text-[12px] text-red-600">{errorMessage}</p> : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:flex-nowrap">
          {needsOAuthClientConfiguration ? (
            <DenButton variant="primary" size="sm" onClick={onConfigure}>
              配置
            </DenButton>
          ) : null}
          {setupHref ? (
            <Link href={setupHref} className={buttonVariants({ variant: "primary", size: "sm" })}>
              去配置
            </Link>
          ) : null}
          {connection.issuerReviewRequired ? (
            <DenButton variant="primary" size="sm" icon={AlertTriangle} onClick={onReviewIssuer}>
              复核 OAuth
            </DenButton>
          ) : null}
          {canConnectOAuth ? (
            <DenButton
              variant="secondary"
              size="sm"
              loading={connecting || polling}
              onClick={onConnect}
            >
              连接
            </DenButton>
          ) : null}
          {displayedConnected ? (
            <DenButton
              variant="secondary"
              size="sm"
              loading={disconnecting}
              onClick={onDisconnect}
              aria-label={`断开 ${connection.name}`}
              data-testid={`disconnect-mcp-connection-${connection.id}`}
            >
              断开
            </DenButton>
          ) : null}
          <div ref={actionsMenuRef} className="relative">
            <button
              ref={actionsTriggerRef}
              type="button"
              onClick={() => setActionsOpen((current) => !current)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 transition hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900"
              aria-label={`${connection.name} 的更多操作`}
              aria-haspopup="menu"
              aria-expanded={actionsOpen}
              data-testid={`mcp-connection-more-${connection.id}`}
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </button>
            {actionsOpen ? (
              <div
                role="menu"
                aria-label={`${connection.name} 的操作`}
                className="absolute right-0 top-10 z-30 w-44 overflow-hidden rounded-2xl border border-gray-100 bg-white p-1.5 text-[13px] shadow-xl shadow-gray-900/10"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setActionsOpen(false);
                    onEdit();
                  }}
                  disabled={!connection.updatedAt}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-gray-600 transition hover:bg-gray-50 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={`编辑 ${connection.name}`}
                  data-testid={`edit-mcp-connection-${connection.id}`}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  编辑
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setActionsOpen(false);
                    onToggleTools();
                  }}
                  disabled={!canInspectTools}
                  title={canInspectTools ? "查看此 MCP 提供的工具" : "请先连接账号，再查看工具"}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-gray-600 transition hover:bg-gray-50 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {toolsOpen ? <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
                  {toolsOpen ? "收起工具" : "查看工具"}
                </button>
                <div className="my-1 border-t border-gray-100" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setActionsOpen(false);
                    onRemove();
                  }}
                  disabled={removing}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label={`移除 ${connection.name}`}
                >
                  {removing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                  移除
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {toolsOpen && canInspectTools ? <McpToolCatalog connection={connection} /> : null}
    </div>
  );
}

function schemaInputs(schema: Record<string, unknown>): Array<{ name: string; required: boolean; type: string | null }> {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : []);
  return Object.entries(properties).map(([name, definition]) => ({
    name,
    required: required.has(name),
    type: isRecord(definition) && typeof definition.type === "string" ? definition.type : null,
  }));
}

function toolHints(tool: ExternalMcpTool): Array<{ label: string; className: string }> {
  const annotations = tool.annotations;
  if (!annotations) return [];
  return [
    annotations.readOnlyHint ? { label: "服务端标记为只读", className: "bg-blue-50 text-blue-700" } : null,
    annotations.destructiveHint ? { label: "可能修改或删除数据", className: "bg-red-50 text-red-700" } : null,
    annotations.idempotentHint ? { label: "支持幂等重试", className: "bg-emerald-50 text-emerald-700" } : null,
    annotations.openWorldHint ? { label: "可能访问外部系统", className: "bg-amber-50 text-amber-700" } : null,
  ].filter((hint): hint is { label: string; className: string } => hint !== null);
}

function McpToolCatalog({ connection }: { connection: ExternalMcpConnection }) {
  const catalog = useMcpConnectionTools(connection.id, true);
  const [toolSearch, setToolSearch] = useState("");
  const [visibleToolLimit, setVisibleToolLimit] = useState(MCP_TOOL_PAGE_SIZE);
  const filteredTools = useMemo(() => {
    const needle = toolSearch.trim().toLowerCase();
    if (!needle) return catalog.data ?? [];
    return (catalog.data ?? []).filter((tool) =>
      [tool.name, tool.title, tool.annotations?.title, tool.description]
        .some((value) => value?.toLowerCase().includes(needle)),
    );
  }, [catalog.data, toolSearch]);
  const visibleTools = filteredTools.slice(0, visibleToolLimit);
  const remainingToolCount = filteredTools.length - visibleTools.length;

  return (
    <div className="border-t border-gray-100 bg-gray-50/70 px-6 py-5" data-mcp-tool-catalog={connection.id}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-gray-500" />
            <p className="text-[13px] font-semibold text-gray-900">AI 可用工具</p>
          </div>
          <p className="mt-1 text-[12px] leading-5 text-gray-500">
            工具清单来自 {connection.name}。查看清单不会执行工具；服务端提供的标记仅供参考。
          </p>
        </div>
        <DenButton variant="secondary" size="sm" loading={catalog.isFetching} onClick={() => void catalog.refetch()}>
          <RefreshCw className="h-3.5 w-3.5" />
          刷新
        </DenButton>
      </div>

      {catalog.data && catalog.data.length > 0 ? (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="w-full sm:max-w-sm">
            <DenInput
              aria-label="搜索 MCP 工具"
              icon={Search}
              value={toolSearch}
              onChange={(event) => {
                setToolSearch(event.target.value);
                setVisibleToolLimit(MCP_TOOL_PAGE_SIZE);
              }}
              placeholder="按名称或说明搜索工具"
            />
          </div>
          <p className="shrink-0 text-[11px] font-medium text-gray-500" role="status">
            {toolSearch.trim()
              ? `找到 ${filteredTools.length} 个，共 ${catalog.data.length} 个工具`
              : `共 ${catalog.data.length} 个工具`}
          </p>
        </div>
      ) : null}

      {catalog.isLoading ? (
        <div className="mt-4 flex items-center gap-2 text-[12px] text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在读取 MCP 工具清单...
        </div>
      ) : catalog.error ? (
        <div className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-[12px] leading-5 text-red-700">
          {catalog.error instanceof Error ? catalog.error.message : "无法读取此 MCP 的工具。"}
        </div>
      ) : catalog.data?.length === 0 ? (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white px-4 py-3 text-[12px] text-gray-500">
          此 MCP 已连接，但当前没有提供工具。
        </div>
      ) : filteredTools.length === 0 ? (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white px-4 py-3 text-[12px] text-gray-500">
          没有找到与“{toolSearch.trim()}”匹配的工具。
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {visibleTools.map((tool) => {
              const inputs = schemaInputs(tool.inputSchema);
              const hints = toolHints(tool);
              const displayTitle = tool.title || tool.annotations?.title;
              return (
                <details key={tool.name} className="group rounded-2xl border border-gray-200 bg-white p-4">
                  <summary className="cursor-pointer list-none">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        {displayTitle ? (
                          <>
                            <p className="break-words text-[12px] font-semibold text-gray-900">{displayTitle}</p>
                            <p className="mt-0.5 break-words font-mono text-[10px] text-gray-500">{tool.name}</p>
                          </>
                        ) : (
                          <p className="break-words font-mono text-[12px] font-semibold text-gray-900">{tool.name}</p>
                        )}
                        <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-gray-500">
                          {tool.description || "此 MCP 未提供工具说明。"}
                        </p>
                      </div>
                      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-gray-400 transition group-open:rotate-90" />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <p className="text-[11px] font-medium text-gray-500">
                        {inputs.length === 0 ? "无需输入" : `${inputs.length} 个输入项`}
                      </p>
                      {hints.map((hint) => (
                        <span
                          key={hint.label}
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${hint.className}`}
                          title="此标记由 MCP 服务端提供，仅供参考。"
                        >
                          {hint.label}
                        </span>
                      ))}
                    </div>
                  </summary>
                  <div className="mt-4 border-t border-gray-100 pt-4">
                    {inputs.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {inputs.map((input) => (
                          <span key={input.name} className="rounded-full bg-gray-100 px-2.5 py-1 font-mono text-[11px] text-gray-700">
                            {input.name}{input.type ? `: ${input.type}` : ""}{input.required ? " · 必填" : ""}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <details className="mt-3">
                      <summary className="cursor-pointer text-[11px] font-medium text-gray-500">查看输入 Schema</summary>
                      <pre className="mt-2 max-h-64 overflow-auto rounded-xl bg-gray-950 p-3 text-[10px] leading-4 text-gray-100">{JSON.stringify(tool.inputSchema, null, 2)}</pre>
                    </details>
                    {tool.outputSchema ? (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-[11px] font-medium text-gray-500">查看输出 Schema</summary>
                        <pre className="mt-2 max-h-64 overflow-auto rounded-xl bg-gray-950 p-3 text-[10px] leading-4 text-gray-100">{JSON.stringify(tool.outputSchema, null, 2)}</pre>
                      </details>
                    ) : null}
                  </div>
                </details>
              );
            })}
          </div>
          {remainingToolCount > 0 ? (
            <div className="mt-4 flex justify-center">
              <DenButton
                variant="secondary"
                size="sm"
                onClick={() => setVisibleToolLimit((current) => current + MCP_TOOL_PAGE_SIZE)}
              >
                再显示 {Math.min(MCP_TOOL_PAGE_SIZE, remainingToolCount)} 个
              </DenButton>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

type SegmentedControlOption<TValue extends string> = {
  value: TValue;
  label: string;
};

function SegmentedControl<TValue extends string>({
  options,
  value,
  onChange,
  disabled = false,
}: {
  options: SegmentedControlOption<TValue>[];
  value: TValue;
  onChange: (value: TValue) => void;
  disabled?: boolean;
}) {
  const gridColumns = options.length === 2 ? "grid-cols-2" : "grid-cols-3";

  return (
    <div className={`grid ${gridColumns} gap-1 rounded-full border border-gray-200 bg-gray-50 p-1`} role="group">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
            value === option.value
              ? "bg-white text-gray-900 shadow-[0_1px_2px_rgba(15,23,42,0.08)]"
              : "text-gray-500 hover:text-gray-900"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

type AddConnectionAccessMode = McpConnectionAccessMode;

const AUTH_TYPE_OPTIONS: SegmentedControlOption<ExternalMcpAuthType>[] = [
  { value: "oauth", label: "OAuth" },
  { value: "apikey", label: "API 密钥" },
  { value: "none", label: "无需认证" },
];

const CREDENTIAL_MODE_OPTIONS: SegmentedControlOption<ExternalMcpCredentialMode>[] = [
  { value: "per_member", label: "成员各自登录" },
  { value: "shared", label: "公司共用账号" },
];

const ACCESS_MODE_OPTIONS: SegmentedControlOption<AddConnectionAccessMode>[] = [
  { value: "everyone", label: "全公司" },
  { value: "teams", label: "指定团队" },
  { value: "people", label: "指定成员" },
];

function EditConnectionDialog({
  connection,
  configureOAuthClient,
  submitting,
  error,
  onClose,
  onSubmit,
}: {
  connection: ExternalMcpConnection | null;
  configureOAuthClient: boolean;
  submitting: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (input: UpdateMcpConnectionInput) => Promise<UpdatedMcpConnection>;
}) {
  const { runtimeConfig } = useDenFlow();
  const { orgContext } = useOrgDashboard();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [authType, setAuthType] = useState<ExternalMcpAuthType>("oauth");
  const [credentialMode, setCredentialMode] = useState<ExternalMcpCredentialMode>("shared");
  const [apiKey, setApiKey] = useState("");
  const [showOAuthClient, setShowOAuthClient] = useState(false);
  const [oauthClientId, setOAuthClientId] = useState("");
  const [oauthClientSecret, setOAuthClientSecret] = useState("");
  const [requestedScopesText, setRequestedScopesText] = useState("");
  const [accessMode, setAccessMode] = useState<AddConnectionAccessMode>("everyone");
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [confirmingIdentityChange, setConfirmingIdentityChange] = useState(false);

  useEffect(() => {
    if (!connection) return;
    setName(connection.name);
    setUrl(connection.url);
    setAuthType(connection.authType);
    setCredentialMode(connection.credentialMode);
    setApiKey("");
    setShowOAuthClient(configureOAuthClient || Boolean(connection.oauthClientId));
    setOAuthClientId(connection.oauthClientId ?? "");
    setOAuthClientSecret("");
    setRequestedScopesText((connection.requestedScopes ?? []).join(" "));
    setAccessMode(mcpAccessMode(connection.access));
    setSelectedTeamIds(connection.access?.teamIds ?? []);
    setSelectedMemberIds(connection.access?.memberIds ?? []);
    setConfirmingIdentityChange(false);
  }, [configureOAuthClient, connection]);

  const teams = useMemo(() => orgContext?.teams ?? [], [orgContext?.teams]);
  const members = useMemo(
    () => (orgContext?.members ?? []).filter((member) => Boolean(member.userId)),
    [orgContext?.members],
  );
  const marketplaceOwners = connection?.identityManagedBy ?? [];
  const marketplaceManaged = marketplaceOwners.length > 0;
  const proposedCredentialMode = authType === "oauth" ? credentialMode : "shared";
  const identityChanged = Boolean(connection && editableMcpIdentityChanged(connection, {
    url,
    authType,
    credentialMode: proposedCredentialMode,
  }));
  const access: McpConnectionAccessInput = accessMode === "everyone"
    ? { orgWide: true, memberIds: [], teamIds: [] }
    : {
      orgWide: false,
      // Preserve a pre-existing mixed direct grant set on unrelated edits.
      // Choosing a different mode below explicitly clears the hidden set.
      memberIds: selectedMemberIds,
      teamIds: selectedTeamIds,
    };
  const accessIncomplete = accessMode === "teams"
    ? selectedTeamIds.length === 0
    : accessMode === "people"
      ? selectedMemberIds.length === 0
      : false;
  const replacementApiKeyRequired = authType === "apikey" && identityChanged && !apiKey.trim();
  const oauthClientIdRequired = configureOAuthClient && authType === "oauth" && !oauthClientId.trim();

  function toggle(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];
  }

  async function submit() {
    if (!connection?.updatedAt) return;
    if (identityChanged && !confirmingIdentityChange) {
      setConfirmingIdentityChange(true);
      return;
    }
    const trimmedApiKey = apiKey.trim();
    const trimmedClientId = oauthClientId.trim();
    const trimmedClientSecret = oauthClientSecret.trim();
    const requestedScopes = [...new Set(requestedScopesText.split(/[\s,]+/).map((scope) => scope.trim()).filter(Boolean))];
    const input: UpdateMcpConnectionInput = {
      connectionId: connection.id,
      expectedUpdatedAt: connection.updatedAt,
      name: name.trim(),
      url: url.trim(),
      authType,
      credentialMode: proposedCredentialMode,
      ...(!marketplaceManaged && authType === "apikey" && trimmedApiKey ? { apiKey: trimmedApiKey } : {}),
      ...(authType === "oauth" && showOAuthClient && trimmedClientId
        ? {
          oauthClient: {
            clientId: trimmedClientId,
            ...(trimmedClientSecret ? { clientSecret: trimmedClientSecret } : {}),
          },
        }
        : {}),
      ...(!marketplaceManaged && authType === "oauth" ? { requestedScopes } : {}),
      access,
    };
    try {
      await onSubmit(input);
    } catch {
      // The mutation error is rendered below and the dialog stays open with
      // the proposed values, including a stale-edit response from the API.
    }
  }

  if (!connection) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-[28px] border border-gray-200 bg-white p-6 shadow-[0_24px_80px_-32px_rgba(15,23,42,0.45)]"
        onClick={(event) => event.stopPropagation()}
        data-testid="edit-mcp-connection-dialog"
      >
        <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-gray-950">
          {configureOAuthClient ? "配置 MCP 连接" : "编辑 MCP 连接"}
        </h2>
        <p className="mt-1 text-[13px] leading-6 text-gray-600">
          {configureOAuthClient
            ? "填写此服务所需的 OAuth 应用凭据，成员才能连接。"
            : "修改连接信息和使用范围。已保存的凭据不会在此显示。"}
        </p>

        {marketplaceManaged ? (
          <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-[12px] leading-5 text-blue-800" data-testid="marketplace-managed-identity-note">
            <p className="font-semibold text-blue-900">服务地址和认证方式由 {marketplaceIdentityOwnerNames(marketplaceOwners)} 管理。</p>
            <p className="mt-1">可在此配置公司 OAuth 凭据。如需修改服务地址或认证方式，请前往能力市场的插件定义。</p>
          </div>
        ) : null}

        <div className="mt-5 space-y-4">
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-gray-700">名称</label>
            <DenInput value={name} onChange={(event) => setName(event.target.value)} data-testid="edit-mcp-name" />
          </div>
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-gray-700">服务地址</label>
            <DenInput
              value={url}
              data-testid="edit-mcp-url"
              disabled={marketplaceManaged}
              onChange={(event) => {
                setUrl(event.target.value);
                setConfirmingIdentityChange(false);
              }}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-gray-700">认证方式</label>
            <SegmentedControl
              options={AUTH_TYPE_OPTIONS}
              value={authType}
              disabled={marketplaceManaged}
              onChange={(option) => {
                setAuthType(option);
                if (option !== "oauth") {
                  setCredentialMode("shared");
                  setShowOAuthClient(false);
                }
                setConfirmingIdentityChange(false);
              }}
            />
          </div>

          {!marketplaceManaged && authType === "apikey" ? (
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-gray-700">
                {identityChanged ? "新 API 密钥（必填）" : "新 API 密钥（选填）"}
              </label>
              <McpCredentialInput
                kind="secret"
                name="mcp-replacement-api-key"
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value);
                  setConfirmingIdentityChange(false);
                }}
                placeholder={identityChanged ? "填写新连接使用的密钥" : "留空则继续使用已保存的密钥"}
                data-testid="edit-mcp-api-key"
              />
              <p className="mt-1.5 text-[11px] leading-5 text-gray-500">已保存的密钥经过加密，不会回显到此表单。</p>
            </div>
          ) : null}

          {authType === "oauth" && !showOAuthClient ? (
            <button
              type="button"
              onClick={() => {
                setShowOAuthClient(true);
                setConfirmingIdentityChange(false);
              }}
              className="text-left text-[12px] font-medium text-gray-500 underline decoration-gray-300 underline-offset-4 transition hover:text-gray-900"
            >
              {connection.oauthClientId ? "更换预注册 OAuth 应用" : "添加预注册 OAuth 应用"}
            </button>
          ) : null}

          {authType === "oauth" && showOAuthClient ? (
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[13px] font-semibold text-gray-900">OAuth 应用</p>
                {runtimeConfig.foxworkMcpDocsUrl ? (
                  <Link href={runtimeConfig.foxworkMcpDocsUrl} target="_blank" rel="noreferrer" className="text-[11px] font-medium text-gray-500 underline underline-offset-2 hover:text-gray-900">
                    OAuth 配置说明
                  </Link>
                ) : null}
              </div>
              <p className="mt-1 text-[12px] leading-5 text-gray-500">在此填写服务商凭据。已保存的客户端密钥不会显示。</p>
              <div className="mt-3 space-y-3">
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-gray-700">
                    客户端 ID{configureOAuthClient ? "（必填）" : ""}
                  </label>
                  <McpCredentialInput
                    kind="identifier"
                    name="mcp-oauth-client-id"
                    value={oauthClientId}
                    onChange={(event) => {
                      setOAuthClientId(event.target.value);
                      setConfirmingIdentityChange(false);
                    }}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-gray-700">
                    {connection.oauthClientId ? "新客户端密钥（选填）" : "客户端密钥（选填）"}
                  </label>
                  <McpCredentialInput
                    kind="secret"
                    name="mcp-replacement-oauth-client-secret"
                    value={oauthClientSecret}
                    onChange={(event) => {
                      setOAuthClientSecret(event.target.value);
                      setConfirmingIdentityChange(false);
                    }}
                    placeholder="连接身份和客户端 ID 未变时可留空"
                    data-testid="edit-mcp-oauth-client-secret"
                  />
                </div>
              </div>
            </div>
          ) : null}

          {authType === "oauth" ? (
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-gray-700">申请的 OAuth 授权范围</label>
              <DenInput
                value={requestedScopesText}
                disabled={marketplaceManaged}
                onChange={(event) => setRequestedScopesText(event.target.value)}
                placeholder="records.read records.write"
                data-testid="edit-mcp-requested-scopes"
              />
              <p className="mt-1.5 text-[11px] leading-5 text-gray-500">多个授权范围可用空格或逗号分隔。修改后需重新连接并授权。</p>
            </div>
          ) : null}

          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-gray-700">AI 使用谁的账号？</label>
            <SegmentedControl
              options={CREDENTIAL_MODE_OPTIONS}
              value={proposedCredentialMode}
              disabled={marketplaceManaged || authType !== "oauth"}
              onChange={(option) => {
                setCredentialMode(option);
                setConfirmingIdentityChange(false);
              }}
            />
            {authType !== "oauth" ? (
              <p className="mt-1.5 text-[11px] leading-5 text-gray-500">API 密钥和无需认证的连接始终由公司共用。</p>
            ) : null}
          </div>

          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-gray-700">谁可以使用？</label>
            <SegmentedControl
              options={ACCESS_MODE_OPTIONS}
              value={accessMode}
              onChange={(option) => {
                if (option !== accessMode) {
                  if (option === "teams") setSelectedMemberIds([]);
                  if (option === "people") setSelectedTeamIds([]);
                }
                setAccessMode(option);
              }}
            />
            {accessMode === "teams" ? (
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-xl border border-gray-100 p-2">
                {teams.length === 0 ? (
                  <p className="px-2 py-1 text-[12px] text-gray-400">公司还没有团队。</p>
                ) : teams.map((team) => (
                  <button
                    key={team.id}
                    type="button"
                    onClick={() => setSelectedTeamIds((current) => toggle(current, team.id))}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[13px] transition ${selectedTeamIds.includes(team.id) ? "bg-gray-100 text-gray-900" : "text-gray-700 hover:bg-gray-50"}`}
                  >
                    <span className="truncate">{team.name}</span>
                    {selectedTeamIds.includes(team.id) ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                  </button>
                ))}
              </div>
            ) : null}
            {accessMode === "people" ? (
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-xl border border-gray-100 p-2">
                {members.length === 0 ? (
                  <p className="px-2 py-1 text-[12px] text-gray-400">公司还没有成员。</p>
                ) : members.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => setSelectedMemberIds((current) => toggle(current, member.id))}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[13px] transition ${selectedMemberIds.includes(member.id) ? "bg-gray-100 text-gray-900" : "text-gray-700 hover:bg-gray-50"}`}
                  >
                    <span className="truncate">{member.user.name || member.user.email}</span>
                    {selectedMemberIds.includes(member.id) ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {identityChanged && !marketplaceManaged ? (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-[12px] leading-5 text-amber-900" data-testid="mcp-identity-change-warning">
            <p className="font-semibold">此操作会更改连接身份。</p>
            <p className="mt-1">FoxWork 会清除原有的共用和个人会话、API 密钥、待处理的 OAuth 状态、OAuth 客户端注册、授权范围及连接时间，随后才能使用新服务。</p>
            {authType === "oauth" ? <p className="mt-1 font-medium">保存后需要重新授权此连接。</p> : null}
            {confirmingIdentityChange ? <p className="mt-2 font-semibold">请确认要停用原有连接身份。</p> : null}
          </div>
        ) : null}

        {error ? (
          <p className="mt-3 text-[13px] text-red-600" role="alert">{error instanceof Error ? error.message : "更新连接失败。"}</p>
        ) : null}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {confirmingIdentityChange ? (
            <DenButton variant="secondary" onClick={() => setConfirmingIdentityChange(false)} disabled={submitting}>返回</DenButton>
          ) : (
            <DenButton variant="secondary" onClick={onClose} disabled={submitting}>取消</DenButton>
          )}
          <DenButton
            variant="primary"
            loading={submitting}
            disabled={!connection.updatedAt || !name.trim() || !url.trim() || replacementApiKeyRequired || oauthClientIdRequired || accessIncomplete}
            onClick={() => void submit()}
            data-testid="save-mcp-connection-edit"
          >
            {confirmingIdentityChange ? "确认并保存" : identityChanged ? "复核身份变更" : "保存更改"}
          </DenButton>
        </div>
      </div>
    </div>
  );
}

function AddConnectionDialog({
  open,
  preset,
  submitting,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  preset: ExternalMcpPreset | null;
  submitting: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (
    input: CreateMcpConnectionInput,
    options: { startOAuth: boolean },
  ) => Promise<void>;
}) {
  const { runtimeConfig } = useDenFlow();
  const { orgContext } = useOrgDashboard();
  const discoverRequirements = useDiscoverMcpConnectionRequirements();
  const resolveConnection = useResolveMcpConnection();
  // Preset quick-add cards land in their prefilled form. The generic MCP
  // action opens directly on URL discovery.
  const [view, setView] = useState<"smart" | "advanced">(preset ? "advanced" : "smart");
  const [smartQuery, setSmartQuery] = useState("");
  const [smartState, setSmartState] = useState<"idle" | "waiting" | "resolving" | "done" | "error">("idle");
  const [smartError, setSmartError] = useState<unknown>(null);
  const [resolution, setResolution] = useState<McpConnectionResolution | null>(null);
  const [smartName, setSmartName] = useState("");
  const smartRequestId = useRef(0);
  const smartResolveDelayRef = useRef(SMART_RESOLVE_DELAY_MS);
  const [name, setName] = useState(preset?.displayName ?? "");
  const [url, setUrl] = useState(preset?.url ?? "");
  const [authType, setAuthType] = useState<ExternalMcpAuthType>(preset?.authType ?? "oauth");
  const [credentialMode, setCredentialMode] = useState<ExternalMcpCredentialMode>("per_member");
  const [apiKey, setApiKey] = useState("");
  const [showOAuthClient, setShowOAuthClient] = useState(Boolean(preset?.requiresOAuthClient));
  const [oauthClientId, setOAuthClientId] = useState("");
  const [oauthClientSecret, setOAuthClientSecret] = useState("");
  const [requirements, setRequirements] = useState<McpRequirementsDiscovery | null>(null);
  const [discoveryState, setDiscoveryState] = useState<"idle" | "waiting" | "checking" | "ready" | "error">("idle");
  const [discoveryError, setDiscoveryError] = useState<unknown>(null);
  const [authorizationServerIssuer, setAuthorizationServerIssuer] = useState("");
  const [requestedScopes, setRequestedScopes] = useState<string[]>([]);
  const [accessMode, setAccessMode] = useState<AddConnectionAccessMode>("everyone");
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const discoveryRequestId = useRef(0);

  useEffect(() => {
    if (!open) return;
    setView(preset ? "advanced" : "smart");
    setSmartQuery("");
    setSmartState("idle");
    setSmartError(null);
    setResolution(null);
    setSmartName("");
    smartRequestId.current += 1;
    smartResolveDelayRef.current = SMART_RESOLVE_DELAY_MS;
    setName(preset?.displayName ?? "");
    setUrl(preset?.url ?? "");
    setAuthType(preset?.authType ?? "oauth");
    setCredentialMode("per_member");
    setApiKey("");
    setShowOAuthClient(Boolean(preset?.requiresOAuthClient));
    setOAuthClientId("");
    setOAuthClientSecret("");
    setRequirements(null);
    setDiscoveryState("idle");
    setDiscoveryError(null);
    discoveryRequestId.current += 1;
    setAuthorizationServerIssuer("");
    setRequestedScopes([]);
    discoverRequirements.reset();
    setAccessMode("everyone");
    setSelectedTeamIds([]);
    setSelectedMemberIds([]);
  }, [open, preset]);

  const teams = useMemo(() => orgContext?.teams ?? [], [orgContext?.teams]);
  const members = useMemo(
    () => (orgContext?.members ?? []).filter((member) => Boolean(member.userId)),
    [orgContext?.members],
  );

  function toggle(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];
  }

  const showOAuthClientFields = authType === "oauth" && (Boolean(preset?.requiresOAuthClient) || showOAuthClient);
  const authorizationServers = requirements?.authentication.authorizationServers ?? [];
  const selectedAuthorizationServer = authorizationServers.find((server) => server.issuer === authorizationServerIssuer);
  const requiredScopes = requirements?.authentication.requiredScopes ?? [];
  const availableScopes = selectedAuthorizationServer?.scopesSupported
    ?? authorizationServers[0]?.scopesSupported
    ?? [];
  const optionalScopes = availableScopes.filter((scope) => !requiredScopes.includes(scope));
  const optionalScopeSelectionState = getOptionalScopeSelectionState(requestedScopes, optionalScopes);
  const access: McpConnectionAccessInput = accessMode === "everyone"
    ? { orgWide: true, memberIds: [], teamIds: [] }
    : { orgWide: false, memberIds: accessMode === "people" ? selectedMemberIds : [], teamIds: accessMode === "teams" ? selectedTeamIds : [] };
  const accessIncomplete = accessMode === "teams" ? selectedTeamIds.length === 0 : accessMode === "people" ? selectedMemberIds.length === 0 : false;

  function applyDiscoveredRequirements(result: McpRequirementsDiscovery) {
    setRequirements(result);
    if (result.authentication.kind === "none") setAuthType("none");
    else if (result.authentication.kind === "oauth") setAuthType("oauth");
    const servers = result.authentication.authorizationServers;
    setAuthorizationServerIssuer(servers.length === 1 ? servers[0].issuer : "");
    setRequestedScopes(result.authentication.recommendedScopes);
    setShowOAuthClient(Boolean(preset?.requiresOAuthClient) || result.authentication.recommendedRegistrationMethod === "pre_registered");
  }

  async function discover(targetUrl: string, requestId: number) {
    setDiscoveryState("checking");
    setDiscoveryError(null);
    try {
      const result = await discoverRequirements.mutateAsync(targetUrl);
      if (discoveryRequestId.current !== requestId) return;
      applyDiscoveredRequirements(result);
      setDiscoveryState("ready");
    } catch (discoveryFailure) {
      if (discoveryRequestId.current !== requestId) return;
      setDiscoveryError(discoveryFailure);
      setDiscoveryState("error");
    }
  }

  useEffect(() => {
    const requestId = discoveryRequestId.current + 1;
    discoveryRequestId.current = requestId;
    // The smart view carries its own discovery inside the resolve result;
    // per-URL discovery only runs while the full form is visible.
    if (!open || view !== "advanced") {
      setDiscoveryState("idle");
      return;
    }

    const targetUrl = url.trim();
    setRequirements(null);
    setAuthorizationServerIssuer("");
    setRequestedScopes([]);
    setDiscoveryError(null);

    if (!isDiscoverableMcpUrl(targetUrl)) {
      setDiscoveryState("idle");
      return;
    }

    setDiscoveryState("waiting");
    const timer = window.setTimeout(() => {
      void discover(targetUrl, requestId);
    }, MCP_REQUIREMENTS_DISCOVERY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [open, url, view]);

  async function resolveSmart(query: string, requestId: number) {
    setSmartState("resolving");
    try {
      const result = await resolveConnection.mutateAsync(query.trim());
      if (smartRequestId.current !== requestId) return;
      setResolution(result);
      setSmartName(result.match?.suggestedName ?? result.preset?.displayName ?? "");
      setSmartState("done");
    } catch (resolveFailure) {
      if (smartRequestId.current !== requestId) return;
      setSmartError(resolveFailure);
      setSmartState("error");
    }
  }

  useEffect(() => {
    if (!open || view !== "smart") return;
    const requestId = smartRequestId.current + 1;
    smartRequestId.current = requestId;
    setResolution(null);
    setSmartError(null);
    const kind = classifySmartAddInput(smartQuery);
    if (kind !== "url" && kind !== "domain") {
      setSmartState("idle");
      return;
    }
    setSmartState("waiting");
    const delay = smartResolveDelayRef.current;
    smartResolveDelayRef.current = SMART_RESOLVE_DELAY_MS;
    const timer = window.setTimeout(() => {
      void resolveSmart(smartQuery, requestId);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [open, view, smartQuery]);

  const smartMatch = smartState === "done" ? resolution?.match ?? null : null;
  const smartPlan = smartMatch
    ? planSmartAdd(smartMatch.discovery, { name: smartName.trim() || smartMatch.suggestedName, url: smartMatch.url })
    : null;
  // A curated preset can demand org-level input (Slack's pre-registered OAuth
  // app, Exa's API key) even when the live probe alone would look one-click.
  const smartBlockers = smartPlan
    ? smartPlan.readiness !== "one_click"
      ? smartPlan.reasons
      : resolution?.preset?.requiresOAuthClient
        ? ["此服务需要预注册 OAuth 应用。"]
        : resolution?.preset?.authType === "apikey"
          ? ["此服务需要公司的 API 密钥。"]
          : []
    : [];
  const smartOneClick = smartPlan?.readiness === "one_click" && smartBlockers.length === 0 ? smartPlan : null;

  function transferToAdvanced() {
    discoveryRequestId.current += 1;
    if (smartMatch) {
      setName(smartName.trim() || smartMatch.suggestedName);
      setUrl(smartMatch.url);
      if (resolution?.preset) {
        setAuthType(resolution.preset.authType);
        setShowOAuthClient(Boolean(resolution.preset.requiresOAuthClient));
      } else if (smartMatch.discovery.authentication.kind === "manual_bearer") {
        setAuthType("apikey");
      }
    } else if (resolution?.preset) {
      setName(resolution.preset.displayName);
      setUrl(resolution.preset.url);
      setAuthType(resolution.preset.authType);
      setShowOAuthClient(Boolean(resolution.preset.requiresOAuthClient));
    } else {
      const kind = classifySmartAddInput(smartQuery);
      if (kind === "url") setUrl(smartQuery.trim());
      else if (kind === "domain") setUrl(`https://${smartQuery.trim()}`);
      else if (kind === "name") setName(smartQuery.trim());
    }
    setView("advanced");
  }

  async function submitSmart() {
    if (!smartOneClick) return;
    try {
      await onSubmit(smartOneClick.input, {
        startOAuth: smartOneClick.input.authType === "oauth" && smartOneClick.input.credentialMode === "shared",
      });
    } catch {
      // The mutation's typed error is rendered by the dialog's error prop.
    }
  }

  function retryDiscovery() {
    const targetUrl = url.trim();
    if (!isDiscoverableMcpUrl(targetUrl)) return;
    const requestId = discoveryRequestId.current + 1;
    discoveryRequestId.current = requestId;
    void discover(targetUrl, requestId);
  }

  async function submit() {
    const trimmedClientId = oauthClientId.trim();
    const trimmedClientSecret = oauthClientSecret.trim();
    const input: CreateMcpConnectionInput = {
      name: name.trim(),
      url: url.trim(),
      authType,
      credentialMode: authType === "oauth" ? credentialMode : "shared",
      apiKey: authType === "apikey" ? apiKey.trim() : undefined,
      oauthClient: showOAuthClientFields && trimmedClientId
        ? {
          clientId: trimmedClientId,
          ...(trimmedClientSecret ? { clientSecret: trimmedClientSecret } : {}),
        }
        : undefined,
      authorizationServerIssuer: authType === "oauth" && authorizationServerIssuer
        ? authorizationServerIssuer
        : undefined,
      requestedScopes: authType === "oauth" ? [...new Set([...requiredScopes, ...requestedScopes])] : undefined,
      access,
    };
    try {
      await onSubmit(input, {
        startOAuth: authType === "oauth" && credentialMode === "shared" && !showOAuthClientFields,
      });
    } catch {
      // The mutation's typed error is rendered by the dialog's error prop.
      // Consume the rejected promise so a clear validation failure does not
      // also become an opaque browser-level unhandled rejection.
    }
  }

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6" onClick={onClose}>
      <div
        data-testid="add-mcp-connection-dialog"
        className="max-h-[calc(100dvh-3rem)] w-full max-w-md overflow-y-auto overscroll-contain rounded-[28px] border border-gray-200 bg-white p-6 shadow-[0_24px_80px_-32px_rgba(15,23,42,0.45)]"
        onClick={(event) => event.stopPropagation()}
      >
        {view === "smart" ? (
          <>
            <h2 className="flex items-center gap-2 text-[18px] font-semibold tracking-[-0.02em] text-gray-950">
              <Server className="h-4 w-4 text-gray-400" />
              添加 MCP 服务
            </h2>
            <p className="mt-1.5 text-[13px] leading-5 text-gray-500">
              粘贴 MCP 服务地址，FoxWork 会自动识别并检查认证要求。
            </p>

            <div className="mt-5">
              <DenInput
                autoFocus
                value={smartQuery}
                onChange={(event) => setSmartQuery(event.target.value)}
                placeholder="https://mcp.example.com/mcp"
                data-testid="smart-add-query-input"
              />
            </div>

            {smartState === "waiting" || smartState === "resolving" ? (
              <div className="mt-4 flex items-center gap-2.5 rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3.5 text-[13px] text-gray-500" role="status">
                <Loader2 className="h-4 w-4 animate-spin" />
                {smartState === "resolving" ? "正在检查服务..." : "正在查找..."}
              </div>
            ) : null}

            {smartState === "error" ? (
              <div className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3.5 text-[13px] text-red-700" role="alert">
                {smartError instanceof Error ? smartError.message : "查找失败，请重试或手动配置服务。"}
              </div>
            ) : null}

            {smartState === "done" && resolution?.resolution === "not_found" ? (
              <div className="mt-4 rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3.5 text-[13px] leading-5 text-gray-600">
                {resolution.reason ?? `没有找到“${smartQuery.trim()}”对应的 MCP 服务。请检查地址，或改用手动配置。`}
              </div>
            ) : null}

            {smartMatch ? (
              <div data-testid="smart-add-result-card" className="mt-4 rounded-2xl border border-gray-200 p-4">
                <div className="flex items-start gap-3">
                  <IntegrationIcon name={smartName || smartMatch.suggestedName} serviceUrl={smartMatch.url} />
                  <div className="min-w-0 flex-1">
                    <DenInput
                      value={smartName}
                      onChange={(event) => setSmartName(event.target.value)}
                      placeholder={smartMatch.suggestedName || "连接名称"}
                      aria-label="连接名称"
                    />
                    <p className="mt-1.5 truncate text-[12px] text-gray-500">{smartMatch.url}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] font-medium">
                  <span className="rounded-full bg-gray-100 px-2.5 py-1 text-gray-700">{smartAddAuthLabel(smartMatch.discovery)}</span>
                  {typeof smartMatch.discovery.tools.count === "number" && smartMatch.discovery.tools.count > 0 ? (
                    <span className="rounded-full bg-gray-100 px-2.5 py-1 text-gray-700">
                      {smartMatch.discovery.tools.count} 个工具
                    </span>
                  ) : null}
                  {smartOneClick ? (
                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">可以添加</span>
                  ) : null}
                </div>
                {smartOneClick && smartOneClick.input.authType === "oauth" ? (
                  <p className="mt-3 text-[12px] leading-5 text-gray-500">
                    默认向全公司开放，每名成员使用自己的账号登录。可在“更多选项”中调整使用范围和账号方式。
                  </p>
                ) : null}
                {smartBlockers.length > 0 ? (
                  <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2.5 text-[12px] leading-5 text-amber-800">
                    还需完成以下配置：{smartBlockers.join(" · ")}
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={transferToAdvanced}
                  className="mt-3 text-[12px] font-medium text-gray-500 underline decoration-gray-300 underline-offset-4 transition hover:text-gray-900"
                >
                  {smartOneClick ? "更多选项" : "继续配置"}
                </button>
              </div>
            ) : null}

            {smartState === "done" && !smartMatch && resolution?.preset ? (
              <div className="mt-4 rounded-2xl border border-gray-200 p-4">
                <div className="flex items-start gap-3">
                  <IntegrationIcon name={resolution.preset.displayName} serviceUrl={resolution.preset.url} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-gray-900">{resolution.preset.displayName}</p>
                    <p className="mt-0.5 truncate text-[12px] text-gray-500">{resolution.preset.url}</p>
                  </div>
                </div>
                <p className="mt-3 text-[12px] leading-5 text-gray-500">{resolution.preset.description}</p>
                <button
                  type="button"
                  onClick={transferToAdvanced}
                  className="mt-3 text-[12px] font-medium text-gray-500 underline decoration-gray-300 underline-offset-4 transition hover:text-gray-900"
                >
                  继续配置
                </button>
              </div>
            ) : null}

            {error ? (
              <p className="mt-3 text-[13px] text-red-600">{error instanceof Error ? error.message : "添加连接失败。"}</p>
            ) : null}

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={transferToAdvanced}
                className="text-left text-[12px] font-medium text-gray-500 underline decoration-gray-300 underline-offset-4 transition hover:text-gray-900"
              >
                手动配置
              </button>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <DenButton variant="secondary" onClick={onClose} disabled={submitting}>
                  取消
                </DenButton>
                <DenButton
                  variant="primary"
                  loading={submitting}
                  disabled={!smartOneClick}
                  onClick={() => void submitSmart()}
                  data-testid="smart-add-submit"
                >
                  添加连接
                </DenButton>
              </div>
            </div>
          </>
        ) : (
          <>
        {!preset ? (
          <button
            type="button"
            onClick={() => setView("smart")}
            className="mb-2 flex items-center gap-1 text-[12px] font-medium text-gray-500 transition hover:text-gray-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            MCP 服务
          </button>
        ) : null}
        <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-gray-950">
          {preset ? `添加 ${preset.displayName}` : "添加自定义 MCP 服务"}
        </h2>

        <div className="mt-5 space-y-4">
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-gray-700">名称</label>
            <DenInput value={name} onChange={(event) => setName(event.target.value)} placeholder="notion" />
          </div>
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-gray-700">服务地址</label>
            <DenInput
              value={url}
              onChange={(event) => {
                discoveryRequestId.current += 1;
                setUrl(event.target.value);
                setRequirements(null);
                setDiscoveryState("idle");
                setAuthorizationServerIssuer("");
                setRequestedScopes([]);
                setDiscoveryError(null);
              }}
              placeholder="https://mcp.example.com/mcp"
              disabled={Boolean(preset)}
            />
            {discoveryState === "waiting" || discoveryState === "checking" ? (
              <p className="mt-2 flex items-center gap-2 text-[12px] text-gray-500" role="status">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                正在检查...
              </p>
            ) : null}
            {discoveryState === "error" ? (
              <div className="mt-2 flex items-start justify-between gap-3 text-[12px] text-red-600" role="alert">
                <p>{discoveryError instanceof Error ? discoveryError.message : "无法识别此服务的认证要求。"}</p>
                <button type="button" className="shrink-0 font-medium underline underline-offset-2" onClick={retryDiscovery}>
                  重试
                </button>
              </div>
            ) : null}
          </div>
          {!preset ? (
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-gray-700">认证方式</label>
              <SegmentedControl
                options={AUTH_TYPE_OPTIONS}
                value={authType}
                onChange={(option) => {
                  setAuthType(option);
                  if (option !== "oauth") setShowOAuthClient(false);
                }}
              />
            </div>
          ) : null}
          {authType === "apikey" ? (
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-gray-700">API 密钥</label>
              <McpCredentialInput
                kind="secret"
                name="mcp-api-key"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="sk-..."
              />
            </div>
          ) : null}

          {authType === "oauth" && !preset?.requiresOAuthClient && !showOAuthClient ? (
            <button
              type="button"
              onClick={() => setShowOAuthClient(true)}
              className="text-left text-[12px] font-medium text-gray-500 underline decoration-gray-300 underline-offset-4 transition hover:text-gray-900"
            >
              改用预注册 OAuth 应用
            </button>
          ) : null}

          {showOAuthClientFields ? (
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[13px] font-semibold text-gray-900">OAuth 应用</p>
                {runtimeConfig.foxworkMcpDocsUrl ? (
                  <Link href={runtimeConfig.foxworkMcpDocsUrl} target="_blank" rel="noreferrer" className="text-[11px] font-medium text-gray-500 underline underline-offset-2 hover:text-gray-900">
                    OAuth 配置说明
                  </Link>
                ) : null}
              </div>
              <p className="mt-1 text-[12px] leading-5 text-gray-500">
                先在服务商后台登记此 Den 实例的回调地址，再在这里填写凭据。
              </p>
              <div className="mt-3 space-y-3">
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-gray-700">客户端 ID（暂时选填）</label>
                  <McpCredentialInput
                    kind="identifier"
                    name="mcp-oauth-client-id"
                    value={oauthClientId}
                    onChange={(event) => setOAuthClientId(event.target.value)}
                    placeholder="1234567890.1234567890123"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-gray-700">客户端密钥（暂时选填）</label>
                  <McpCredentialInput
                    kind="secret"
                    name="mcp-oauth-client-secret"
                    value={oauthClientSecret}
                    onChange={(event) => setOAuthClientSecret(event.target.value)}
                    placeholder="填写客户端密钥"
                  />
                </div>
              </div>
            </div>
          ) : null}

          {authType === "oauth" && authorizationServers.length > 1 ? (
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-gray-700">授权服务器</label>
              <DenSelect
                value={authorizationServerIssuer}
                onChange={(event) => {
                  const issuer = event.target.value;
                  const server = authorizationServers.find((candidate) => candidate.issuer === issuer);
                  const supportedScopes = server?.scopesSupported ?? [];
                  const recommendedScopes = [...requiredScopes];
                  if (server?.grantTypesSupported?.includes("refresh_token") && supportedScopes.includes("offline_access")) {
                    recommendedScopes.push("offline_access");
                  }
                  setAuthorizationServerIssuer(issuer);
                  setRequestedScopes([...new Set(recommendedScopes)]);
                }}
              >
                <option value="" disabled>选择签发方</option>
                {authorizationServers.map((server) => <option key={server.issuer} value={server.issuer}>{server.issuer}</option>)}
              </DenSelect>
            </div>
          ) : null}

          {authType === "oauth" && requirements && (requiredScopes.length > 0 || optionalScopes.length > 0) ? (
            <div>
              <p className="mb-1.5 text-[12px] font-medium text-gray-700">授权范围</p>
              <div className="space-y-2 rounded-2xl border border-gray-100 bg-gray-50 p-3 text-[12px]">
                {optionalScopes.length > OPTIONAL_SCOPE_BULK_TOGGLE_THRESHOLD ? (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={optionalScopeSelectionState === "some" ? "mixed" : optionalScopeSelectionState === "all"}
                    data-testid="toggle-all-optional-permissions"
                    onClick={() => setRequestedScopes((current) => toggleAllOptionalScopes(current, optionalScopes))}
                    className="flex w-full items-center gap-2 border-b border-gray-200 pb-2 text-left font-medium text-gray-700 transition hover:text-gray-950 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
                  >
                    <span
                      aria-hidden="true"
                      className={`flex h-4 w-4 items-center justify-center rounded border transition ${
                        optionalScopeSelectionState === "none"
                          ? "border-gray-300 bg-white"
                          : "border-blue-600 bg-blue-600 text-white"
                      }`}
                    >
                      {optionalScopeSelectionState === "all" ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                      {optionalScopeSelectionState === "some" ? <Minus className="h-3 w-3" strokeWidth={3} /> : null}
                    </span>
                    <span>{optionalScopeSelectionState === "all" ? "取消全选" : "全选"}</span>
                  </button>
                ) : null}
                {requiredScopes.map((scope) => (
                  <label key={scope} className="flex items-center gap-2 text-gray-700">
                    <input type="checkbox" checked disabled />
                    <span>{scope} <span className="text-gray-400">必需</span></span>
                  </label>
                ))}
                {optionalScopes.map((scope) => (
                  <label key={scope} className="flex items-center gap-2 text-gray-700">
                    <input
                      type="checkbox"
                      checked={requestedScopes.includes(scope)}
                      onChange={(event) => setRequestedScopes((current) => event.target.checked
                        ? [...new Set([...current, scope])]
                        : current.filter((entry) => entry !== scope))}
                    />
                    <span>{scope} <span className="text-gray-400">可选</span></span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {authType === "oauth" ? (
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-gray-700">AI 使用谁的账号？</label>
              <SegmentedControl options={CREDENTIAL_MODE_OPTIONS} value={credentialMode} onChange={setCredentialMode} />
              <p className="mt-1.5 text-[12px] leading-5 text-gray-500">
                {credentialMode === "per_member"
                  ? "每名成员在“我的连接”中登录自己的账号，AI 只能使用该成员已有的权限。"
                  : "管理员只需登录一次，获准成员共用这个账号。适合机器人或服务账号。"}
              </p>
            </div>
          ) : null}

          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-gray-700">谁可以使用？</label>
            <SegmentedControl options={ACCESS_MODE_OPTIONS} value={accessMode} onChange={setAccessMode} />
            {accessMode === "teams" ? (
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-xl border border-gray-100 p-2">
                {teams.length === 0 ? (
                  <p className="px-2 py-1 text-[12px] text-gray-400">公司还没有团队。</p>
                ) : (
                  teams.map((team) => (
                    <button
                      key={team.id}
                      type="button"
                      onClick={() => setSelectedTeamIds((current) => toggle(current, team.id))}
                      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[13px] transition ${
                        selectedTeamIds.includes(team.id) ? "bg-gray-100 text-gray-900" : "text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      <span className="truncate">{team.name}</span>
                      {selectedTeamIds.includes(team.id) ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                    </button>
                  ))
                )}
              </div>
            ) : null}
            {accessMode === "people" ? (
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-xl border border-gray-100 p-2">
                {members.length === 0 ? (
                  <p className="px-2 py-1 text-[12px] text-gray-400">公司还没有成员。</p>
                ) : (
                  members.map((member) => (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => setSelectedMemberIds((current) => toggle(current, member.id))}
                      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[13px] transition ${
                        selectedMemberIds.includes(member.id) ? "bg-gray-100 text-gray-900" : "text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      <span className="truncate">{member.user.name || member.user.email}</span>
                      {selectedMemberIds.includes(member.id) ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
        </div>

        {error ? (
          <p className="mt-3 text-[13px] text-red-600">{error instanceof Error ? error.message : "添加连接失败。"}</p>
        ) : null}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DenButton variant="secondary" onClick={onClose} disabled={submitting}>
            取消
          </DenButton>
          <DenButton
            variant="primary"
            loading={submitting}
            disabled={!name.trim() || !url.trim() || !requirements || discoveryState !== "ready" || (authType === "oauth" && authorizationServers.length > 1 && !authorizationServerIssuer) || (authType === "apikey" && !apiKey.trim()) || accessIncomplete}
            onClick={() => void submit()}
          >
            添加连接
          </DenButton>
        </div>
          </>
        )}
      </div>
    </div>
  );
}
