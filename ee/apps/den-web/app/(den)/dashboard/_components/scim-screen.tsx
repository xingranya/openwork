"use client";

import { Copy, RefreshCw, Shield, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DashboardPageTemplate } from "../../_components/ui/dashboard-page-template";
import { DenButton } from "../../_components/ui/button";
import { DenNotice } from "../../_components/ui/notice";
import { getErrorMessage, getRequestError, isReauthRequiredError, requestJson } from "../../_lib/den-flow";
import {
  type DenOrgScimConnection,
  type DenOrgScimHealth,
  getOrgAccessFlags,
  parseOrgScimPayload,
} from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";

function formatDateTime(value: string | null) {
  if (!value) {
    return "暂无记录";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "暂无记录";
  }

  return date.toLocaleString("zh-CN");
}

export function ScimScreen() {
  const { orgId, orgContext, runReauthableAction } = useOrgDashboard();
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [ssoReady, setSsoReady] = useState(false);
  const [connection, setConnection] = useState<DenOrgScimConnection | null>(null);
  const [health, setHealth] = useState<DenOrgScimHealth>({
    unresolvedFailureCount: 0,
    lastFailureAt: null,
    lastFailureAction: null,
    lastFailureMessage: null,
    nextRetryAt: null,
    lastSuccessfulSyncAt: null,
  });
  const [visibleToken, setVisibleToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [updatingGroupMapping, setUpdatingGroupMapping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedValue, setCopiedValue] = useState<"base-url" | "token" | null>(null);

  const access = useMemo(
    () =>
      getOrgAccessFlags(
        orgContext?.currentMember.role ?? "member",
        orgContext?.currentMember.isOwner ?? false,
        orgContext?.roles,
      ),
    [orgContext?.currentMember.isOwner, orgContext?.currentMember.role, orgContext?.roles],
  );

  async function loadScimConfig(isCurrent = () => true) {
    if (!orgId || !access.canViewSettings) {
      if (isCurrent()) {
        setBaseUrl(null);
        setSsoReady(false);
        setConnection(null);
        setHealth({
          unresolvedFailureCount: 0,
          lastFailureAt: null,
          lastFailureAction: null,
          lastFailureMessage: null,
          nextRetryAt: null,
          lastSuccessfulSyncAt: null,
        });
      }
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const { response, payload } = await requestJson(
        "/v1/scim",
        { method: "GET" },
        12000,
      );

      if (!response.ok) {
        throw getRequestError(payload, response, `SCIM 设置加载失败（${response.status}）。`);
      }

      const parsed = parseOrgScimPayload(payload);
      if (isCurrent()) {
        setBaseUrl(parsed.baseUrl);
        setSsoReady(parsed.ssoReady);
        setConnection(parsed.connection);
        setHealth(parsed.health);
      }
    } catch (nextError) {
      if (isReauthRequiredError(nextError)) {
        throw nextError;
      }

      if (isCurrent()) {
        setError(
          nextError instanceof Error
            ? getErrorMessage(nextError.message, "SCIM 设置加载失败，请重试。")
            : "SCIM 设置加载失败，请重试。",
        );
      }
    } finally {
      if (isCurrent()) {
        setBusy(false);
      }
    }
  }

  useEffect(() => {
    let active = true;
    void runReauthableAction("load-scim-settings", () => loadScimConfig(() => active)).catch((nextError) => {
      if (active) {
        setError(
          nextError instanceof Error
            ? getErrorMessage(nextError.message, "SCIM 设置加载失败，请重试。")
            : "SCIM 设置加载失败，请重试。",
        );
      }
    });
    return () => {
      active = false;
    };
  }, [orgId, access.canViewSettings]);

  useEffect(() => {
    if (!copiedValue) {
      return;
    }

    const timeout = window.setTimeout(() => setCopiedValue(null), 1500);
    return () => window.clearTimeout(timeout);
  }, [copiedValue]);

  async function copyValue(value: string | null, kind: "base-url" | "token") {
    if (!value) {
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(kind);
    } catch {
      setError(kind === "token" ? "无法复制 SCIM 令牌，请手动复制。" : "无法复制 SCIM 服务地址，请手动复制。");
    }
  }

  async function handleRotateToken() {
    if (!access.canManageScim) {
      setError("Only workspace owners and super-admins can create or rotate SCIM tokens.");
      return;
    }

    if (!orgId) {
      setError("没有找到公司信息，请刷新后重试。");
      return;
    }

    setError(null);
    setVisibleToken(null);
    try {
      await runReauthableAction("rotate-scim-token", async () => {
        setRotating(true);
        try {
          const { response, payload } = await requestJson(
            "/v1/scim/token",
            { method: "POST", body: JSON.stringify({}) },
            12000,
          );

          if (!response.ok) {
            throw getRequestError(payload, response, `SCIM 令牌更新失败（${response.status}）。`);
          }

          const parsed = parseOrgScimPayload(payload);
          if (!parsed.baseUrl || !parsed.connection || !parsed.scimToken) {
            throw new Error("SCIM 令牌已更新，但返回信息不完整，请刷新后确认。");
          }

          setBaseUrl(parsed.baseUrl);
          setSsoReady(parsed.ssoReady);
          setConnection(parsed.connection);
          setHealth(parsed.health);
          setVisibleToken(parsed.scimToken);
          setCopiedValue(null);
        } finally {
          setRotating(false);
        }
      });
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? getErrorMessage(nextError.message, "SCIM 令牌更新失败，请重试。")
          : "SCIM 令牌更新失败，请重试。",
      );
    }
  }

  async function handleRunReconciliation() {
    if (!access.canManageScim) {
      setError("Only workspace owners and super-admins can run SCIM reconciliation.");
      return;
    }

    if (!orgId) {
      setError("没有找到公司信息，请刷新后重试。");
      return;
    }

    setError(null);
    try {
      await runReauthableAction("reconcile-scim", async () => {
        setReconciling(true);
        try {
          const { response, payload } = await requestJson(
            "/v1/scim/reconcile",
            { method: "POST", body: JSON.stringify({}) },
            12000,
          );

          if (!response.ok) {
            throw getRequestError(payload, response, `SCIM 同步检查失败（${response.status}）。`);
          }

          await loadScimConfig();
        } finally {
          setReconciling(false);
        }
      });
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? getErrorMessage(nextError.message, "SCIM 同步检查失败，请重试。")
          : "SCIM 同步检查失败，请重试。",
      );
    }
  }

  async function handleGroupMappingChange() {
    if (!access.canManageScim) {
      setError("Only workspace owners and super-admins can change SCIM mappings.");
      return;
    }

    if (!connection) {
      setError("请先创建 SCIM 连接，再启用团队同步。");
      return;
    }

    const groupMappingMode = connection.groupMappingMode === "create_teams"
      ? "metadata_only"
      : "create_teams";
    setError(null);
    setUpdatingGroupMapping(true);
    try {
      const { response, payload } = await requestJson(
        "/v1/scim",
        { method: "PATCH", body: JSON.stringify({ groupMappingMode }) },
        12000,
      );
      if (!response.ok) {
        throw getRequestError(payload, response, `SCIM 团队同步设置更新失败（${response.status}）。`);
      }
      const parsed = parseOrgScimPayload(payload);
      if (!parsed.connection) {
        throw new Error("SCIM 设置已更新，但返回信息不完整，请刷新后确认。");
      }
      setConnection(parsed.connection);
      setHealth(parsed.health);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? getErrorMessage(nextError.message, "SCIM 团队同步设置更新失败，请重试。")
          : "SCIM 团队同步设置更新失败，请重试。",
      );
    } finally {
      setUpdatingGroupMapping(false);
    }
  }

  async function handleDeleteConnection() {
    if (!access.canManageScim) {
      setError("Only workspace owners and super-admins can delete SCIM connections.");
      return;
    }

    if (
      !orgId ||
      !window.confirm(
        "确定删除此 SCIM 连接吗？当前令牌会立即失效。",
      )
    ) {
      return;
    }

    setError(null);
    try {
      await runReauthableAction("delete-scim-connection", async () => {
        setDeleting(true);
        try {
          const { response, payload } = await requestJson(
            "/v1/scim",
            { method: "DELETE" },
            12000,
          );

          if (response.status !== 204 && !response.ok) {
            throw getRequestError(payload, response, `SCIM 连接删除失败（${response.status}）。`);
          }

          setConnection(null);
          setVisibleToken(null);
          setCopiedValue(null);
          await loadScimConfig();
        } finally {
          setDeleting(false);
        }
      });
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? getErrorMessage(nextError.message, "SCIM 连接删除失败，请重试。")
          : "SCIM 连接删除失败，请重试。",
      );
    }
  }

  if (!orgContext) {
    return (
      <DashboardPageTemplate
        icon={Shield}
        badgeLabel="管理员"
        title="SCIM"
        description="通过公司专用的 SCIM 连接，从身份服务同步成员和团队。"
        colors={["#ECFEFF", "#155E75", "#06B6D4", "#A5F3FC"]}
      >
        <div className="rounded-[28px] border border-gray-200 bg-white px-6 py-10 text-[15px] text-gray-500">
          正在加载公司信息…
        </div>
      </DashboardPageTemplate>
    );
  }

  return (
    <DashboardPageTemplate
      icon={Shield}
      badgeLabel="管理员"
      title="SCIM"
      description="为公司创建 SCIM 连接，并将这里的服务地址和令牌配置到身份服务中。"
      colors={["#ECFEFF", "#155E75", "#06B6D4", "#A5F3FC"]}
    >
      {!access.canViewSettings ? (
        <div className="rounded-[28px] border border-amber-200 bg-amber-50 px-6 py-5 text-[14px] text-amber-900">
          只有公司所有者和管理员可以管理 SCIM。
        </div>
      ) : (
        <>
          {!access.canManageScim ? (
            <div className="mb-6 rounded-[24px] border border-amber-200 bg-amber-50 px-5 py-4 text-[14px] text-amber-800">
              Read-only: owners and super-admins can create tokens, reconcile, change mappings, or delete SCIM connections.
            </div>
          ) : null}
          <div className="mb-6 flex flex-wrap gap-2 rounded-[24px] border border-gray-200 bg-white px-5 py-4 text-[12px] font-semibold shadow-[0_18px_48px_-34px_rgba(15,23,42,0.22)]">
            <span className={`rounded-full px-3 py-1.5 ${orgContext.authMethods.sso ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
              {orgContext.authMethods.sso ? "SAML/SSO 已启用" : "SAML/SSO 未配置"}
            </span>
            <span className={`rounded-full px-3 py-1.5 ${connection ? "bg-cyan-50 text-cyan-700" : "bg-gray-100 text-gray-500"}`}>
              {connection ? "SCIM 已连接" : "SCIM 未配置"}
            </span>
          </div>

          {error ? (
            <DenNotice message={error} className="mb-6" />
          ) : null}

          {!ssoReady ? (
            <div className="mb-6 rounded-[28px] border border-amber-200 bg-amber-50 px-6 py-5 text-[14px] text-amber-900">
              <p className="font-semibold">请先配置 SAML/SSO，再启用 SCIM</p>
              <p className="mt-1 leading-6">
                创建或更新 SCIM 连接令牌前，公司必须已有一个启用的 SSO 连接。
              </p>
            </div>
          ) : null}

          {health.unresolvedFailureCount > 0 ? (
            <div className="mb-6 rounded-[28px] border border-amber-200 bg-amber-50 px-6 py-5 text-[14px] text-amber-900">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="font-semibold">SCIM 需要处理</p>
                  <p className="mt-1 leading-6">
                    还有 {health.unresolvedFailureCount} 个 SCIM 同步问题需要重试或检查。
                  </p>
                  {health.lastFailureMessage ? (
                    <p className="mt-1 break-words text-[13px] leading-6">
                      最近问题：{getErrorMessage(health.lastFailureMessage, "同步失败，请查看身份服务和 SCIM 配置。")}
                    </p>
                  ) : null}
                  <p className="mt-1 text-[13px] leading-6">
                    最近失败：{formatDateTime(health.lastFailureAt)} · 下次重试：{formatDateTime(health.nextRetryAt)}
                  </p>
                </div>
                <DenButton variant="secondary" icon={RefreshCw} onClick={() => void handleRunReconciliation()} loading={reconciling}>
                  立即检查同步
                </DenButton>
              </div>
            </div>
          ) : null}

          <div className="mb-6 rounded-[30px] border border-gray-200 bg-white p-6 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.22)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[16px] font-semibold tracking-[-0.03em] text-gray-900">
                  SCIM 服务地址
                </p>
                <p className="mt-1 text-[14px] leading-6 text-gray-500">
                  在身份服务要求填写 SCIM 端点时使用此地址。
                </p>
                <p className="mt-2 text-[13px] leading-6 text-gray-500">
                  SCIM 可同步成员生命周期和团队关系。
                </p>
              </div>
              <DenButton
                variant="secondary"
                icon={Copy}
                onClick={() => void copyValue(baseUrl, "base-url")}
                disabled={!baseUrl}
              >
                {copiedValue === "base-url" ? "已复制" : "复制地址"}
              </DenButton>
            </div>

            <div className="mt-5 rounded-[20px] border border-gray-200 bg-gray-50 p-4">
              <code className="block break-all text-[13px] leading-6 text-gray-700">
                {baseUrl ?? (busy ? "正在加载…" : "暂不可用")}
              </code>
            </div>
          </div>

          <div className="mb-6 rounded-[30px] border border-gray-200 bg-white p-6 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.22)]">
            <div className="flex flex-wrap items-center justify-between gap-5">
              <div className="max-w-2xl">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[16px] font-semibold tracking-[-0.03em] text-gray-900">
                    从 SCIM 组创建团队
                  </p>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${connection?.groupMappingMode === "create_teams" ? "bg-cyan-50 text-cyan-700" : "bg-gray-100 text-gray-500"}`}>
                    {connection?.groupMappingMode === "create_teams" ? "已启用" : "未启用"}
                  </span>
                </div>
                <p className="mt-1 text-[14px] leading-6 text-gray-500">
                  根据身份服务中的用户组创建对应的 FoxWork 团队，并持续同步成员。手动管理的团队不会受到影响。
                </p>
              </div>
              <DenButton
                variant={connection?.groupMappingMode === "create_teams" ? "secondary" : "primary"}
                onClick={() => void handleGroupMappingChange()}
                loading={updatingGroupMapping}
                disabled={!access.canManageScim || !connection}
              >
                {connection?.groupMappingMode === "create_teams" ? "关闭同步" : "启用团队同步"}
              </DenButton>
            </div>
          </div>

          <div className="mb-6 rounded-[30px] border border-gray-200 bg-white p-6 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.22)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[16px] font-semibold tracking-[-0.03em] text-gray-900">
                  连接令牌
                </p>
                <p className="mt-1 text-[14px] leading-6 text-gray-500">
                  {connection
                    ? "身份服务需要更换密钥时，可在这里更新令牌。"
                    : "创建公司 SCIM 连接，并生成第一个访问令牌。"}
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <DenButton icon={RefreshCw} onClick={() => void handleRotateToken()} loading={rotating} disabled={!ssoReady}>
                  {connection ? "更新令牌" : "创建连接"}
                </DenButton>
                {connection ? (
                  <DenButton
                    variant="destructive"
                    icon={Trash2}
                    onClick={() => void handleDeleteConnection()}
                    loading={deleting}
                    disabled={!access.canManageScim}
                  >
                    删除连接
                  </DenButton>
                ) : null}
              </div>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="rounded-[20px] border border-gray-200 bg-gray-50 p-4">
                <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-gray-500">
                  状态
                </p>
                <p className="mt-2 text-[15px] font-medium text-gray-900">
                  {busy ? "正在加载…" : connection ? "已连接" : "未配置"}
                </p>
                <p className="mt-2 text-[13px] leading-6 text-gray-500">
                  最近更新：{formatDateTime(connection?.updatedAt ?? null)}
                </p>
                {connection ? (
                  <p className="mt-2 break-all text-[12px] text-gray-400">
                    连接编号：{connection.providerId}
                  </p>
                ) : null}
              </div>

              <div className="rounded-[20px] border border-cyan-100 bg-cyan-50 p-4 text-[13px] leading-6 text-cyan-900">
                通过 SCIM 移除成员后，系统会保留已断开关联的成员记录。只有当该用户不再属于任何公司时，才会删除全局账号。
                <p className="mt-2">
                  最近成功同步：{formatDateTime(health.lastSuccessfulSyncAt)}。
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-[24px] border border-gray-200 bg-gray-50 p-4 text-[13px] leading-6 text-gray-600">
              FoxWork 会记录失败的 SCIM 任务并自动重试，也会定期检查成员状态差异。仍未解决的问题会显示在此处。
              <div className="mt-3">
                <DenButton variant="secondary" icon={RefreshCw} onClick={() => void handleRunReconciliation()} loading={reconciling}>
                  检查同步状态
                </DenButton>
              </div>
            </div>

            {visibleToken ? (
              <div className="mt-5 rounded-[24px] bg-[#0f172a] p-6 text-white">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-[16px] font-semibold tracking-[-0.03em]">
                      SCIM 访问令牌已生成
                    </p>
                    <p className="mt-1 text-[14px] leading-6 text-slate-300">
                      请立即复制。令牌只会在创建或更新后显示这一次。
                    </p>
                  </div>
                  <DenButton
                    variant="secondary"
                    icon={Copy}
                    onClick={() => void copyValue(visibleToken, "token")}
                  >
                    {copiedValue === "token" ? "已复制" : "复制令牌"}
                  </DenButton>
                </div>

                <div className="mt-5 rounded-[20px] border border-white/10 bg-white/5 p-4">
                  <code className="block break-all text-[13px] leading-6 text-cyan-200">
                    {visibleToken}
                  </code>
                </div>
              </div>
            ) : null}
          </div>
        </>
      )}
    </DashboardPageTemplate>
  );
}
