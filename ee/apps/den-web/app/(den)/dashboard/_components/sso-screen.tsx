"use client";

import { Copy, KeyRound, RefreshCw, Shield, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DashboardPageTemplate } from "../../_components/ui/dashboard-page-template";
import { DenButton } from "../../_components/ui/button";
import { DenNotice } from "../../_components/ui/notice";
import { getErrorMessage, getRequestError, isReauthRequiredError, requestJson } from "../../_lib/den-flow";
import { getOrgAccessFlags, parseOrgSsoPayload, type DenOrgSsoConnection } from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { EnterprisePlanNotice } from "./enterprise-plan-notice";

function formatDateTime(value: string | null) {
  if (!value) return "尚未配置";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "尚未配置";
  return date.toLocaleString("zh-CN");
}

function formatConnectionStatus(status: string) {
  const normalized = status.trim().toLowerCase();
  const labels: Record<string, string> = {
    active: "已启用",
    configured: "已配置",
    disabled: "已停用",
    error: "异常",
    pending: "待验证",
    unverified: "未验证",
  };
  return labels[normalized] ?? "状态未知";
}

type FormMode = "saml" | "oidc";

export function SsoScreen() {
  const { orgId, orgContext, runReauthableAction } = useOrgDashboard();
  const [connection, setConnection] = useState<DenOrgSsoConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [domainVerificationToken, setDomainVerificationToken] = useState<string | null>(null);
  const [requestingDomainToken, setRequestingDomainToken] = useState(false);
  const [verifyingDomain, setVerifyingDomain] = useState(false);
  const [editing, setEditing] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>("saml");
  const [issuer, setIssuer] = useState("");
  const [domain, setDomain] = useState("");
  const [entryPoint, setEntryPoint] = useState("");
  const [cert, setCert] = useState("");
  const [audience, setAudience] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [scopes, setScopes] = useState("openid email profile");
  const [skipDiscovery, setSkipDiscovery] = useState(false);
  const [authorizationEndpoint, setAuthorizationEndpoint] = useState("");
  const [tokenEndpoint, setTokenEndpoint] = useState("");
  const [jwksEndpoint, setJwksEndpoint] = useState("");
  const [userInfoEndpoint, setUserInfoEndpoint] = useState("");
  const [tokenEndpointAuthentication, setTokenEndpointAuthentication] = useState<"" | "client_secret_basic" | "client_secret_post">("");

  const access = useMemo(
    () => getOrgAccessFlags(orgContext?.currentMember.role ?? "member", orgContext?.currentMember.isOwner ?? false, orgContext?.roles),
    [orgContext?.currentMember.isOwner, orgContext?.currentMember.role, orgContext?.roles],
  );

  async function loadSsoConfig(isCurrent = () => true) {
    if (!orgId || !access.canViewSettings) {
      if (isCurrent()) {
        setConnection(null);
      }
      return;
    }

    if (isCurrent()) {
      setBusy(true);
      setError(null);
    }
    try {
      const { response, payload } = await requestJson("/v1/sso", { method: "GET", headers: getOrgScopedHeaders() }, 12000);
      if (!response.ok) {
        throw getRequestError(payload, response, `加载单点登录设置失败（${response.status}）。`);
      }

      const parsed = parseOrgSsoPayload(payload);
      if (isCurrent()) {
        setConnection(parsed.connection);
        syncFormFromConnection(parsed.connection);
        setEditing(false);
      }
    } catch (nextError) {
      if (isReauthRequiredError(nextError)) {
        throw nextError;
      }

      if (isCurrent()) {
        setError(nextError instanceof Error ? nextError.message : "加载单点登录设置失败。");
      }
    } finally {
      if (isCurrent()) {
        setBusy(false);
      }
    }
  }

  function getOrgScopedHeaders() {
    const headers = new Headers();
    if (orgId) {
      headers.set("x-openwork-legacy-org-id", orgId);
    }
    return headers;
  }

  function syncFormFromConnection(nextConnection: DenOrgSsoConnection | null) {
    if (!nextConnection) {
      return;
    }

    setFormMode(nextConnection.kind);
    setIssuer(nextConnection.issuer);
    setDomain(nextConnection.domain);
    if (nextConnection.saml) {
      setEntryPoint(nextConnection.saml.entryPoint ?? "");
      setAudience(nextConnection.saml.audience ?? "");
    }
    if (nextConnection.oidc) {
      setClientId(nextConnection.oidc.clientId ?? "");
      setScopes(nextConnection.oidc.scopes.length > 0 ? nextConnection.oidc.scopes.join(" ") : "openid email profile");
      setSkipDiscovery(nextConnection.oidc.skipDiscovery);
      setAuthorizationEndpoint(nextConnection.oidc.authorizationEndpoint ?? "");
      setTokenEndpoint(nextConnection.oidc.tokenEndpoint ?? "");
      setJwksEndpoint(nextConnection.oidc.jwksEndpoint ?? "");
      setUserInfoEndpoint(nextConnection.oidc.userInfoEndpoint ?? "");
      setTokenEndpointAuthentication(nextConnection.oidc.tokenEndpointAuthentication ?? "");
    }
  }

  useEffect(() => {
    let active = true;
    void runReauthableAction("load-sso-settings", () => loadSsoConfig(() => active)).catch((nextError) => {
      if (active) {
        setError(nextError instanceof Error ? nextError.message : "加载单点登录设置失败。");
      }
    });
    return () => {
      active = false;
    };
  }, [orgId, access.canViewSettings]);

  useEffect(() => {
    if (!copiedValue) return;
    const timeout = window.setTimeout(() => setCopiedValue(null), 1500);
    return () => window.clearTimeout(timeout);
  }, [copiedValue]);

  async function copyValue(value: string | null, key: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(key);
    } catch {
      setError("复制单点登录信息失败，请手动复制。");
    }
  }

  async function handleSave() {
    if (!orgId) {
      setError("没有找到公司信息。");
      return;
    }
    if (!access.canManageSso) {
      setError("只有公司所有者和超级管理员可以修改单点登录设置。");
      return;
    }

    setError(null);
    try {
      await runReauthableAction("save-sso-settings", async () => {
        setSaving(true);
        try {
          const path = formMode === "saml" ? "/v1/sso/saml" : "/v1/sso/oidc";
          const body = formMode === "saml"
            ? {
                issuer,
                domain,
                entryPoint,
                cert,
                audience: audience || undefined,
              }
            : {
                issuer,
                domain,
                clientId,
                clientSecret,
                scopes: scopes.split(/\s+/).map((entry) => entry.trim()).filter(Boolean),
                skipDiscovery,
                authorizationEndpoint: authorizationEndpoint || undefined,
                tokenEndpoint: tokenEndpoint || undefined,
                jwksEndpoint: jwksEndpoint || undefined,
                userInfoEndpoint: userInfoEndpoint || undefined,
                tokenEndpointAuthentication: tokenEndpointAuthentication || undefined,
              };

          const { response, payload } = await requestJson(path, { method: "POST", headers: getOrgScopedHeaders(), body: JSON.stringify(body) }, 20000);
          if (!response.ok) {
            throw getRequestError(payload, response, `保存单点登录设置失败（${response.status}）。`);
          }

          const parsed = parseOrgSsoPayload(payload);
          setConnection(parsed.connection);
          syncFormFromConnection(parsed.connection);
          setDomainVerificationToken(parsed.domainVerificationToken);
          setEditing(false);
        } finally {
          setSaving(false);
        }
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "保存单点登录设置失败。");
    }
  }

  async function handleDelete() {
    if (!orgId || !window.confirm("确定删除这个单点登录连接吗？")) {
      return;
    }

    setError(null);
    try {
      await runReauthableAction("delete-sso-settings", async () => {
        setDeleting(true);
        try {
          const { response, payload } = await requestJson("/v1/sso", { method: "DELETE", headers: getOrgScopedHeaders() }, 12000);
          if (response.status !== 204 && !response.ok) {
            throw getRequestError(payload, response, `删除单点登录设置失败（${response.status}）。`);
          }
          setConnection(null);
          setEditing(false);
          await loadSsoConfig();
        } finally {
          setDeleting(false);
        }
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "删除单点登录设置失败。");
    }
  }

  async function handleRequestDomainToken() {
    if (!access.canManageSso) {
      setError("只有公司所有者和超级管理员可以申请单点登录域名验证信息。");
      return;
    }
    if (!orgId || !connection) return;
    setError(null);
    try {
      await runReauthableAction("request-sso-domain-token", async () => {
        setRequestingDomainToken(true);
        try {
          const { response, payload } = await requestJson("/v1/sso/request-domain-verification", { method: "POST", headers: getOrgScopedHeaders(), body: JSON.stringify({}) }, 12000);
          if (!response.ok) {
            throw getRequestError(payload, response, `申请域名验证信息失败（${response.status}）。`);
          }

          const token = typeof (payload as { domainVerificationToken?: unknown } | null)?.domainVerificationToken === "string"
            ? (payload as { domainVerificationToken: string }).domainVerificationToken
            : "";
          if (!token) {
            throw new Error("公司服务没有返回域名验证信息，请重试。");
          }
          setDomainVerificationToken(token);
        } finally {
          setRequestingDomainToken(false);
        }
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "申请域名验证信息失败。");
    }
  }

  async function handleVerifyDomain() {
    if (!access.canManageSso) {
      setError("只有公司所有者和超级管理员可以验证单点登录域名。");
      return;
    }
    if (!orgId || !connection) return;
    setError(null);
    try {
      await runReauthableAction("verify-sso-domain", async () => {
        setVerifyingDomain(true);
        try {
          const { response, payload } = await requestJson("/v1/sso/verify-domain", { method: "POST", headers: getOrgScopedHeaders(), body: JSON.stringify({}) }, 12000);
          if (response.status !== 204 && !response.ok) {
            throw getRequestError(payload, response, `验证域名失败（${response.status}）。`);
          }
          setDomainVerificationToken(null);
          await loadSsoConfig();
        } finally {
          setVerifyingDomain(false);
        }
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "验证单点登录域名失败。");
    }
  }

  function handleCancelEdit() {
    syncFormFromConnection(connection);
    setEditing(false);
  }

  const formReadOnly = !access.canManageSso;
  const showConnectionForm = access.canViewSettings && (!connection || editing || formReadOnly);

  if (!orgContext) {
    return (
      <DashboardPageTemplate icon={Shield} badgeLabel="管理员" title="单点登录（SSO）" description="为公司配置统一的登录入口。" colors={["#F5F3FF", "#4C1D95", "#8B5CF6", "#DDD6FE"]}>
        <div className="rounded-[28px] border border-gray-200 bg-white px-6 py-10 text-[15px] text-gray-500">正在加载公司信息...</div>
      </DashboardPageTemplate>
    );
  }

  const ssoFormDisabled = formReadOnly || saving || !orgContext.entitlements.sso;

  return (
    <DashboardPageTemplate icon={Shield} badgeLabel="管理员" title="单点登录（SSO）" description="配置公司的单点登录服务，并把生成的登录地址提供给员工。" colors={["#F5F3FF", "#4C1D95", "#8B5CF6", "#DDD6FE"]}>
      {!access.canManageSso ? (
        <div className="rounded-[28px] border border-amber-200 bg-amber-50 px-6 py-5 text-[14px] text-amber-900">只有公司所有者和管理员可以管理单点登录。</div>
      ) : (
        <>
          {!orgContext.entitlements.sso ? <EnterprisePlanNotice feature="SSO" /> : null}
          {error ? <DenNotice message={error} className="mb-6" /> : null}
          {!access.canManageSso ? (
            <div className="mb-6 rounded-[24px] border border-amber-200 bg-amber-50 px-5 py-4 text-[14px] text-amber-800">
              当前为只读模式，只有公司所有者和超级管理员可以新建、修改、删除或验证单点登录连接。
            </div>
          ) : null}

          {showConnectionForm ? (
            <div className="mb-6 rounded-[30px] border border-gray-200 bg-white p-6 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.22)]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <DenButton variant={formMode === "saml" ? "primary" : "secondary"} onClick={() => setFormMode("saml")} disabled={formReadOnly || saving}>SAML</DenButton>
                  <DenButton variant={formMode === "oidc" ? "primary" : "secondary"} onClick={() => setFormMode("oidc")} disabled={formReadOnly || saving}>OIDC</DenButton>
                </div>
                {connection ? <DenButton variant="secondary" onClick={handleCancelEdit}>取消编辑</DenButton> : null}
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <label className="block text-[14px] text-gray-700">
                  <span className="mb-2 block font-medium">{formMode === "saml" ? "身份服务签发方地址" : "签发方地址"}</span>
                  <input className="w-full rounded-[18px] border border-gray-200 px-4 py-3" value={issuer} onChange={(event) => setIssuer(event.target.value)} placeholder="https://idp.example.com" />
                </label>
                <label className="block text-[14px] text-gray-700">
                  <span className="mb-2 block font-medium">公司邮箱域名</span>
                  <input className="w-full rounded-[18px] border border-gray-200 px-4 py-3" value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="example.com" />
                </label>
                {formMode === "saml" ? (
                  <>
                    <label className="block text-[14px] text-gray-700 md:col-span-2">
                      <span className="mb-2 block font-medium">SAML 登录入口</span>
                      <input className="w-full rounded-[18px] border border-gray-200 px-4 py-3" value={entryPoint} onChange={(event) => setEntryPoint(event.target.value)} placeholder="https://idp.example.com/sso" />
                    </label>
                    <label className="block text-[14px] text-gray-700 md:col-span-2">
                      <span className="mb-2 block font-medium">受众地址</span>
                      <input className="w-full rounded-[18px] border border-gray-200 px-4 py-3" value={audience} onChange={(event) => setAudience(event.target.value)} placeholder="留空时使用 SeeWayWork 认证地址" />
                    </label>
                    <label className="block text-[14px] text-gray-700 md:col-span-2">
                      <span className="mb-2 block font-medium">身份服务证书</span>
                      <textarea className="min-h-[140px] w-full rounded-[18px] border border-gray-200 px-4 py-3" value={cert} onChange={(event) => setCert(event.target.value)} placeholder="-----BEGIN CERTIFICATE-----" />
                    </label>
                    <div className="rounded-[18px] border border-gray-200 px-4 py-3 text-[14px] leading-6 text-gray-600 md:col-span-2">
                      SeeWayWork 要求公司 SAML 连接使用已签名的断言、有效时间戳和由服务方发起的登录响应。
                    </div>
                  </>
                ) : (
                  <>
                    <label className="block text-[14px] text-gray-700">
                      <span className="mb-2 block font-medium">客户端 ID</span>
                      <input className="w-full rounded-[18px] border border-gray-200 px-4 py-3" value={clientId} onChange={(event) => setClientId(event.target.value)} />
                    </label>
                    <label className="block text-[14px] text-gray-700">
                      <span className="mb-2 block font-medium">客户端密钥</span>
                      <input type="password" className="w-full rounded-[18px] border border-gray-200 px-4 py-3" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} />
                    </label>
                    <label className="block text-[14px] text-gray-700 md:col-span-2">
                      <span className="mb-2 block font-medium">授权范围</span>
                      <input className="w-full rounded-[18px] border border-gray-200 px-4 py-3" value={scopes} onChange={(event) => setScopes(event.target.value)} placeholder="openid email profile" />
                    </label>
                    <label className="block text-[14px] text-gray-700 md:col-span-2">
                      <span className="mb-2 block font-medium">令牌接口认证方式</span>
                      <select className="w-full rounded-[18px] border border-gray-200 px-4 py-3" value={tokenEndpointAuthentication} onChange={(event) => setTokenEndpointAuthentication(event.target.value === "client_secret_basic" || event.target.value === "client_secret_post" ? event.target.value : "")}>
                        <option value="">使用服务方默认设置</option>
                        <option value="client_secret_basic">client_secret_basic</option>
                        <option value="client_secret_post">client_secret_post</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-3 rounded-[18px] border border-gray-200 px-4 py-3 text-[14px] text-gray-700 md:col-span-2">
                      <input type="checkbox" checked={skipDiscovery} onChange={(event) => setSkipDiscovery(event.target.checked)} />
                      手动填写 OIDC 接口，不使用自动发现
                    </label>
                    {skipDiscovery ? (
                      <>
                        <label className="block text-[14px] text-gray-700 md:col-span-2">
                          <span className="mb-2 block font-medium">授权接口</span>
                          <input className="w-full rounded-[18px] border border-gray-200 px-4 py-3" value={authorizationEndpoint} onChange={(event) => setAuthorizationEndpoint(event.target.value)} placeholder="https://idp.example.com/oauth2/v1/authorize" />
                        </label>
                        <label className="block text-[14px] text-gray-700 md:col-span-2">
                          <span className="mb-2 block font-medium">令牌接口</span>
                          <input className="w-full rounded-[18px] border border-gray-200 px-4 py-3" value={tokenEndpoint} onChange={(event) => setTokenEndpoint(event.target.value)} placeholder="https://idp.example.com/oauth2/v1/token" />
                        </label>
                        <label className="block text-[14px] text-gray-700 md:col-span-2">
                          <span className="mb-2 block font-medium">JWKS 密钥接口</span>
                          <input className="w-full rounded-[18px] border border-gray-200 px-4 py-3" value={jwksEndpoint} onChange={(event) => setJwksEndpoint(event.target.value)} placeholder="https://idp.example.com/oauth2/v1/keys" />
                        </label>
                        <label className="block text-[14px] text-gray-700 md:col-span-2">
                          <span className="mb-2 block font-medium">用户信息接口</span>
                          <input className="w-full rounded-[18px] border border-gray-200 px-4 py-3" value={userInfoEndpoint} onChange={(event) => setUserInfoEndpoint(event.target.value)} placeholder="选填" />
                        </label>
                      </>
                    ) : null}
                  </>
                )}
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <DenButton variant="primary" icon={RefreshCw} onClick={() => void handleSave()} disabled={ssoFormDisabled}>{saving ? "正在保存..." : "保存单点登录连接"}</DenButton>
                <DenButton variant="secondary" icon={Trash2} onClick={() => void handleDelete()} disabled={deleting || !connection}>{deleting ? "正在删除..." : "删除连接"}</DenButton>
              </div>
            </div>
          ) : null}

          <div className="rounded-[30px] border border-gray-200 bg-white p-6 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.22)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[16px] font-semibold tracking-[-0.03em] text-gray-900">当前连接</p>
                <p className="mt-1 text-[14px] leading-6 text-gray-500">下面是员工登录和身份服务配置所需的地址。</p>
              </div>
              {connection && !editing ? (
                <div className="flex flex-wrap gap-3">
                  <DenButton variant="secondary" onClick={() => setEditing(true)}>编辑连接</DenButton>
                  <DenButton variant="secondary" icon={Trash2} onClick={() => void handleDelete()} disabled={deleting}>{deleting ? "正在删除..." : "删除连接"}</DenButton>
                </div>
              ) : null}
            </div>

            {!connection && !busy ? <p className="mt-4 text-[14px] text-gray-500">尚未配置单点登录连接。</p> : null}

            {connection ? (
              <div className="mt-5 space-y-4">
                {[
                  ["员工登录地址", connection.signInUrl, "signin"],
                  ["回调地址", connection.redirectUrl, "redirect"],
                  ["ACS 接收地址", connection.acsUrl, "acs"],
                  ["元数据地址", connection.metadataUrl, "metadata"],
                ].map(([label, value, key]) => (
                  <div key={key as string} className="rounded-[20px] border border-gray-200 bg-gray-50 p-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-gray-500">{label as string}</p>
                      <DenButton variant="secondary" icon={Copy} onClick={() => void copyValue((value as string | null) ?? null, key as string)} disabled={!value}>{copiedValue === key ? "已复制" : "复制"}</DenButton>
                    </div>
                    <code className="block break-all text-[13px] leading-6 text-gray-700">{(value as string | null) ?? "不适用"}</code>
                  </div>
                ))}

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-[20px] border border-gray-200 bg-gray-50 p-4 text-[14px] text-gray-700">
                    <p className="font-medium text-gray-900">身份服务</p>
                    <p className="mt-2">{connection.providerId}</p>
                    <p className="mt-2">{connection.kind.toUpperCase()} · {connection.domain}</p>
                    <p className="mt-2">域名验证：{connection.domainVerified ? "已通过" : "未通过"}</p>
                  </div>
                  <div className="rounded-[20px] border border-gray-200 bg-gray-50 p-4 text-[14px] text-gray-700">
                    <p className="font-medium text-gray-900">连接状态</p>
                    <p className="mt-2">{formatConnectionStatus(connection.status)}</p>
                    <p className="mt-2">最近测试：{formatDateTime(connection.lastTestedAt)}</p>
                    <p className="mt-2">最近更新：{formatDateTime(connection.updatedAt)}</p>
                  </div>
                </div>

                {!connection.domainVerified ? (
                  <div className="rounded-[20px] border border-violet-200 bg-violet-50 p-4 text-[14px] text-violet-900">
                    <p className="font-medium">验证公司域名</p>
                    <p className="mt-2 text-violet-800">
                      先申请 DNS TXT 验证信息并添加到 {connection.domain} 的域名解析中，再回来完成验证。验证通过后，员工才能正式使用这个连接。
                    </p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <DenButton variant="secondary" icon={KeyRound} onClick={() => void handleRequestDomainToken()} disabled={requestingDomainToken}>
                        {requestingDomainToken ? "正在申请..." : "申请验证信息"}
                      </DenButton>
                      <DenButton variant="secondary" icon={RefreshCw} onClick={() => void handleVerifyDomain()} disabled={verifyingDomain}>
                        {verifyingDomain ? "正在验证..." : "验证域名"}
                      </DenButton>
                    </div>
                    {domainVerificationToken ? (
                      <div className="mt-4 rounded-[16px] border border-violet-200 bg-white px-4 py-3">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-violet-500">TXT 验证信息</p>
                          <DenButton variant="secondary" icon={Copy} onClick={() => void copyValue(domainVerificationToken, "domain-token")}>
                            {copiedValue === "domain-token" ? "已复制" : "复制"}
                          </DenButton>
                        </div>
                        <code className="block break-all text-[13px] leading-6 text-gray-700">{domainVerificationToken}</code>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {connection.lastError ? <div className="rounded-[20px] border border-red-200 bg-red-50 p-4 text-[14px] text-red-700">{getErrorMessage(connection.lastError, "单点登录连接最近一次检查失败，请核对配置后重试。")}</div> : null}
              </div>
            ) : null}
          </div>
        </>
      )}
    </DashboardPageTemplate>
  );
}
