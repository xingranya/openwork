"use client";

import Link from "next/link";
import { useState } from "react";
import { Cable, Check, GitBranch, Loader2, Plus, Settings, Trash2 } from "lucide-react";
import { getGithubIntegrationAccountRoute, getGithubIntegrationRoute, getGithubIntegrationSetupRoute } from "../../_lib/den-org";
import { getErrorMessage } from "../../_lib/den-flow";
import { DenButton } from "../../_components/ui/button";
import { DashboardPageTemplate } from "../../_components/ui/dashboard-page-template";
import { IntegrationConnectDialog } from "./integration-connect-dialog";
import { IntegrationIcon } from "./integration-icon";
import {
  type ConnectedIntegration,
  type IntegrationProvider,
  INTEGRATION_PROVIDERS,
  formatIntegrationTimestamp,
  useDisconnectIntegration,
  useIntegrations,
  useStartGithubInstall,
} from "./integration-data";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";

export function IntegrationsScreen() {
  const { orgSlug } = useOrgDashboard();
  const { data: connections = [], isLoading, error } = useIntegrations();
  const disconnect = useDisconnectIntegration();
  const startGithubInstall = useStartGithubInstall();
  const [dialogProvider, setDialogProvider] = useState<IntegrationProvider | null>(null);

  async function handleConnect(provider: IntegrationProvider) {
    if (provider !== "github") {
      setDialogProvider(provider);
      return;
    }

    try {
      const result = await startGithubInstall.mutateAsync({
        returnPath: getGithubIntegrationRoute(orgSlug),
      });
      window.location.assign(result.redirectUrl);
    } catch {
      return;
    }
  }

  const connectedByProvider = connections.reduce<
    Partial<Record<IntegrationProvider, ConnectedIntegration[]>>
  >((acc, connection) => {
    const list = acc[connection.provider] ?? [];
    list.push(connection);
    acc[connection.provider] = list;
    return acc;
  }, {});

  const providers = Object.values(INTEGRATION_PROVIDERS);

  return (
    <DashboardPageTemplate
      icon={Cable}
      badgeLabel="预览版"
      title="数据源"
      description="连接 GitHub 或 Bitbucket 账号，把代码仓库中的插件和技能导入公司工作区。"
      colors={["#E0F2FE", "#0C4A6E", "#0284C7", "#7DD3FC"]}
    >
      {error || startGithubInstall.error ? (
        <div className="mb-6 rounded-[24px] border border-red-200 bg-red-50 px-5 py-4 text-[14px] text-red-700">
          {getErrorMessage(error ?? startGithubInstall.error, "加载数据源失败，请重试。")}
        </div>
      ) : null}

      {isLoading ? (
        <div className="rounded-[28px] border border-gray-200 bg-white px-6 py-10 text-[15px] text-gray-500">
          正在加载数据源...
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {providers.map((meta) => {
            const providerConnections = connectedByProvider[meta.provider] ?? [];
            const isConnected = providerConnections.length > 0;

            return (
              <div
                key={meta.provider}
                className="overflow-hidden rounded-2xl border border-gray-100 bg-white"
              >
                {/* 数据源标题和连接状态 */}
                <div
                  className={`flex items-start gap-4 px-6 py-5 ${isConnected ? "border-b border-gray-100" : ""}`}
                >
                  <ProviderLogo provider={meta.provider} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-[15px] font-semibold text-gray-900">{meta.name}</h2>
                      {meta.provider === "bitbucket" ? (
                        <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
                          即将开放
                        </span>
                      ) : isConnected ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                          <Check className="h-3 w-3" />
                          已连接
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
                          未连接
                        </span>
                      )}
                    </div>
                    {!isConnected ? (
                      <p className="mt-1 text-[13px] leading-[1.55] text-gray-500">{meta.description}</p>
                    ) : null}
                  </div>

                  <div className="shrink-0">
                    <DenButton
                      variant={isConnected ? "secondary" : "primary"}
                      size="sm"
                      loading={meta.provider === "github" && startGithubInstall.isPending}
                      disabled={meta.provider === "bitbucket"}
                      onClick={() => void handleConnect(meta.provider)}
                    >
                      {meta.provider === "bitbucket"
                        ? "即将开放"
                        : isConnected
                          ? "连接其他账号"
                          : "连接"}
                    </DenButton>
                  </div>
                </div>

                {/* 已连接账号和代码仓库 */}
                {isConnected ? (
                  <div className="divide-y divide-gray-100">
                    {providerConnections.map((connection) => (
                      <ConnectionRow
                        key={connection.id}
                        connection={connection}
                        orgSlug={orgSlug}
                        onConfigureNewRepo={meta.provider === "github" ? () => window.location.assign(getGithubIntegrationAccountRoute(orgSlug, connection.account.id)) : undefined}
                        onDisconnect={() => disconnect.mutate(connection.id)}
                        busy={disconnect.isPending && disconnect.variables === connection.id}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <IntegrationConnectDialog
        open={dialogProvider !== null}
        provider={dialogProvider}
        onClose={() => setDialogProvider(null)}
      />
    </DashboardPageTemplate>
  );
}

function ConnectionRow({
  connection,
  orgSlug,
  onConfigureNewRepo,
  onDisconnect,
  busy,
}: {
  connection: ConnectedIntegration;
  orgSlug: string | null;
  onConfigureNewRepo?: () => void;
  onDisconnect: () => void;
  busy: boolean;
}) {
  const accountLogin = connection.account.ownerName ?? connection.account.name;
  const connectedBy = connection.account.createdByName ?? null;
  const avatarUrl = connection.provider === "github" && accountLogin
    ? `https://github.com/${encodeURIComponent(accountLogin)}.png?size=80`
    : null;
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        aria-label={`断开 ${accountLogin} 的连接`}
        disabled={busy}
        className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full text-gray-400 opacity-0 transition-all duration-150 hover:bg-red-50 hover:text-red-600 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-red-500/30 group-hover:opacity-100 disabled:cursor-not-allowed"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Trash2 className="h-4 w-4" aria-hidden />
        )}
      </button>

      <div className="flex items-start gap-3 px-6 py-5 pr-14">
        <Avatar url={avatarUrl} fallback={connection.account.avatarInitial} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-[14px] font-semibold text-gray-900">@{accountLogin}</p>
            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
              {connection.account.kind === "user" ? "个人账号" : "组织账号"}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[12px] text-gray-500">
            {connectedBy ? `由 ${connectedBy} 添加` : "最近添加"}
            <span className="text-gray-400"> · {formatIntegrationTimestamp(connection.connectedAt)}</span>
          </p>
        </div>
      </div>

      <div className="px-6 pb-5">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">
          已配置的代码仓库
        </p>

        {connection.repos.length > 0 ? (
          <ul className="space-y-1.5">
            {connection.repos.map((repo) => (
              <li
                key={repo.id}
                className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 transition hover:bg-gray-50"
              >
                <span className="inline-flex min-w-0 items-center gap-2 text-[13px] text-gray-700">
                  <GitBranch className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                  <span className="truncate">{repo.fullName}</span>
                </span>
                {connection.provider === "github" && repo.connectorInstanceId ? (
                  <Link
                    href={getGithubIntegrationSetupRoute(orgSlug, repo.connectorInstanceId)}
                    aria-label={`打开 ${repo.fullName} 的配置`}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-200 hover:text-gray-900"
                  >
                    <Settings className="h-4 w-4" aria-hidden />
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-gray-400">尚未配置代码仓库。</p>
        )}

        {onConfigureNewRepo ? (
          <button
            type="button"
            onClick={onConfigureNewRepo}
            className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-200 px-3 py-2 text-[13px] font-medium text-gray-500 transition hover:border-gray-400 hover:bg-gray-50 hover:text-gray-900"
          >
            <Plus className="h-4 w-4" aria-hidden />
            添加代码仓库
          </button>
        ) : null}
      </div>

      <DisconnectConfirmDialog
        open={confirmOpen}
        accountLogin={accountLogin}
        repoCount={connection.repos.length}
        busy={busy}
        onClose={() => {
          if (!busy) setConfirmOpen(false);
        }}
        onConfirm={() => {
          onDisconnect();
          setConfirmOpen(false);
        }}
      />
    </div>
  );
}

function Avatar({ url, fallback }: { url: string | null; fallback: string }) {
  const [errored, setErrored] = useState(false);

  if (!url || errored) {
    return (
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#0f172a] text-[14px] font-semibold text-white">
        {fallback}
      </div>
    );
  }

  return (
    <img
      src={url}
      alt=""
      onError={() => setErrored(true)}
      className="h-11 w-11 shrink-0 rounded-full bg-gray-100 object-cover"
    />
  );
}

function DisconnectConfirmDialog({
  open,
  accountLogin,
  repoCount,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  accountLogin: string;
  repoCount: number;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-[28px] border border-gray-200 bg-white p-6 shadow-[0_24px_80px_-32px_rgba(15,23,42,0.45)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
            <Trash2 className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-gray-950">
              移除 @{accountLogin}？
            </h2>
            <p className="mt-1 text-[13px] leading-6 text-gray-600">
              此操作会永久删除 SeeWayWork 从这个 GitHub 账号导入的内容，包括：
            </p>
            <ul className="mt-3 space-y-1.5 text-[13px] leading-6 text-gray-600">
              <li className="flex gap-2">
                <span className="text-gray-400">•</span>
                <span>
                  <strong>{repoCount}</strong> 个已连接的代码仓库及其连接配置
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-gray-400">•</span>
                <span>从这些代码仓库导入的全部插件和能力市场</span>
              </li>
              <li className="flex gap-2">
                <span className="text-gray-400">•</span>
                <span>全部导入配置、历史版本和数据源绑定</span>
              </li>
            </ul>
            <p className="mt-3 text-[12px] leading-5 text-gray-500">
              GitHub App 仍会保留在 GitHub。若要同时撤销访问权限，请前往 GitHub 账号设置中卸载。
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DenButton variant="secondary" onClick={onClose} disabled={busy}>
            取消
          </DenButton>
          <DenButton variant="destructive" icon={Trash2} loading={busy} onClick={onConfirm}>
            移除数据源
          </DenButton>
        </div>
      </div>
    </div>
  );
}

function ProviderLogo({ provider }: { provider: IntegrationProvider }) {
  const providerIconSlugs: Record<IntegrationProvider, string> = {
    github: "github",
    bitbucket: "bitbucket",
  };
  const providerNames: Record<IntegrationProvider, string> = {
    github: "GitHub",
    bitbucket: "Bitbucket",
  };
  return <IntegrationIcon name={providerNames[provider]} simpleIconSlug={providerIconSlugs[provider]} fallbackIcon={Cable} />;
}
