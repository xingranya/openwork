"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { DenButton } from "../../_components/ui/button";
import { DenNotice } from "../../_components/ui/notice";
import { getErrorMessage } from "../../_lib/den-flow";
import { McpCredentialInput } from "./mcp-credential-input";
import { useNativeProviderClient } from "./mcp-connections-data";
import {
  MICROSOFT_365_DEFAULT_FEATURES,
  MICROSOFT_365_PERMISSION_GROUPS,
} from "./microsoft-365-permissions";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function Microsoft365Dialog({
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
  onSubmit: (input: { clientId?: string; clientSecret?: string; tenantId?: string; features: string[] }) => void;
}) {
  const clientConfig = useNativeProviderClient("microsoft-365", open);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [features, setFeatures] = useState<string[]>([...MICROSOFT_365_DEFAULT_FEATURES]);
  const [copiedRedirectUri, setCopiedRedirectUri] = useState(false);
  const [replacingCredentials, setReplacingCredentials] = useState(false);
  const featuresPrefilled = useRef(false);

  useEffect(() => {
    if (!open) return;
    setClientId("");
    setClientSecret("");
    setTenantId("");
    setFeatures([...MICROSOFT_365_DEFAULT_FEATURES]);
    setCopiedRedirectUri(false);
    setReplacingCredentials(false);
    featuresPrefilled.current = false;
  }, [open]);

  useEffect(() => {
    if (!open || featuresPrefilled.current || !clientConfig.isSuccess || clientConfig.isFetching) return;
    setFeatures(clientConfig.data.features);
    featuresPrefilled.current = true;
  }, [open, clientConfig.isSuccess, clientConfig.isFetching, clientConfig.data?.features]);

  if (!open) return null;

  const configured = clientConfig.data?.configured ?? false;
  const savedClientId = clientConfig.data?.clientId;
  const savedTenantId = clientConfig.data?.tenantId;
  const redirectUri = clientConfig.data?.redirectUri ?? "";
  const loadingConfig = clientConfig.isLoading;
  const formError = error ?? clientConfig.error;
  const trimmedClientId = clientId.trim();
  const trimmedClientSecret = clientSecret.trim();
  const trimmedTenantId = tenantId.trim();
  const showCredentialFields = !loadingConfig && (!configured || replacingCredentials);
  const saveDisabled = loadingConfig || (showCredentialFields && (!trimmedClientId || !trimmedClientSecret || !trimmedTenantId));

  function toggleFeature(feature: string) {
    setFeatures((current) => current.includes(feature)
      ? current.filter((entry) => entry !== feature)
      : [...current, feature]);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6" onClick={onClose}>
      <div
        data-testid="microsoft-365-dialog"
        className="max-h-[calc(100vh-3rem)] w-full max-w-lg overflow-y-auto rounded-[28px] border border-gray-200 bg-white p-6 shadow-[0_24px_80px_-32px_rgba(15,23,42,0.45)]"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-gray-950">
          {configured ? "更新 Microsoft 365" : "配置 Microsoft 365"}
        </h2>
        <p className="mt-1 text-[13px] leading-6 text-gray-600">
          公司统一使用一个 Entra Web 应用。每位员工连接自己的工作账号，FoxWork 只申请管理员在下方启用的权限。
        </p>

        <div className="mt-5 space-y-4">
          <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
            <p className="text-[13px] font-semibold text-gray-900">配置 Entra 应用</p>
            <ol className="mt-2 list-decimal space-y-2 pl-4 text-[12px] leading-5 text-gray-600">
              <li>
                在 Microsoft Entra 管理中心创建应用注册，并限定为公司组织中的账号。{" "}
                <a href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noopener" className="font-medium text-gray-900 underline decoration-gray-300 underline-offset-4">
                  打开应用注册
                </a>
              </li>
              <li>
                添加 Web 平台，并填写下面这个准确的回调地址：
                <div className="mt-1 flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-2">
                  <p data-microsoft-redirect-uri className="min-w-0 flex-1 break-all font-mono text-[11px] leading-5 text-gray-800">
                    {redirectUri || "正在加载回调地址..."}
                  </p>
                  <DenButton
                    variant="secondary"
                    size="sm"
                    data-testid="copy-microsoft-redirect-uri"
                    disabled={!redirectUri}
                    onClick={async () => {
                      if (redirectUri && await copyText(redirectUri)) setCopiedRedirectUri(true);
                    }}
                  >
                    {copiedRedirectUri ? "已复制" : "复制"}
                  </DenButton>
                </div>
              </li>
              <li>添加下方列出的 Microsoft Graph 委托权限。如果租户策略有要求，请授予管理员同意。</li>
              <li>复制目录（租户）ID，创建客户端密钥，再把三项信息填写到这里。</li>
            </ol>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
            <p className="text-[13px] font-semibold text-gray-900">权限</p>
            <p className="mt-1 text-[12px] leading-5 text-gray-500">
              选择公司 AI 可以在 Outlook、日历、OneDrive 和 Teams 中执行的操作。员工登录时始终会通过 User.Read 提供基本资料。
            </p>
            <div className="mt-3 space-y-4">
              {MICROSOFT_365_PERMISSION_GROUPS.map((group) => (
                <div key={group.name}>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">{group.name}</p>
                  <div className="space-y-2">
                    {group.permissions.map((permission) => (
                      <label key={permission.key} className="flex items-start gap-2 text-[13px] text-gray-700">
                        <input
                          type="checkbox"
                          data-feature={permission.key}
                          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-gray-900"
                          checked={features.includes(permission.key)}
                          disabled={loadingConfig}
                          onChange={() => toggleFeature(permission.key)}
                        />
                        <span>
                          <span className="block">{permission.label}</span>
                          <span className="block font-mono text-[11px] text-gray-400">{permission.scope}</span>
                          {permission.detail ? <span className="mt-0.5 block text-[11px] leading-4 text-amber-700">{permission.detail}</span> : null}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-[12px] leading-5 text-blue-800">
            如果公司已经使用自有 Entra Web 应用提供 OIDC 单点登录，可以在原应用中添加此回调地址和 Graph 委托权限后继续使用。只配置 SAML 的企业应用可能仍需单独创建应用注册。单点登录只负责员工登录 FoxWork，这里的授权仅开放上方选中的 Microsoft 365 能力。
          </div>

          {loadingConfig ? (
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-[13px] text-gray-500">正在检查已保存的凭据...</div>
          ) : null}

          {configured && !replacingCredentials ? (
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-600" />
                <p className="text-[13px] font-semibold text-gray-900">凭据已保存</p>
              </div>
              <p className="mt-1 text-[12px] leading-5 text-gray-500">只修改权限时会保留加密存储的客户端密钥。仅在轮换 Entra 凭据时需要替换。</p>
              <div className="mt-3 rounded-xl border border-gray-100 bg-white px-3 py-2 text-[12px] text-gray-800">
                已保存的客户端 ID：<span className="font-mono">{savedClientId ?? "已安全保存"}</span>
              </div>
              <div className="mt-2 rounded-xl border border-gray-100 bg-white px-3 py-2 text-[12px] text-gray-800">
                租户 ID：<span className="font-mono">{savedTenantId ?? "已安全保存"}</span>
              </div>
              <DenButton
                className="mt-3"
                variant="secondary"
                size="sm"
                disabled={submitting}
                onClick={() => {
                  setClientId(savedClientId ?? "");
                  setClientSecret("");
                  setTenantId(savedTenantId ?? "");
                  setReplacingCredentials(true);
                }}
              >
                更换租户或凭据
              </DenButton>
            </div>
          ) : null}

          {showCredentialFields ? (
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <p className="text-[13px] font-semibold text-gray-900">Entra OAuth 凭据</p>
              <div className="mt-3 space-y-3">
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-gray-700">目录（租户）ID</label>
                  <McpCredentialInput
                    kind="identifier"
                    name="microsoft-365-tenant-id"
                    data-testid="microsoft-tenant-id"
                    value={tenantId}
                    onChange={(event) => setTenantId(event.target.value)}
                    placeholder="00000000-0000-0000-0000-000000000000"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-gray-700">应用（客户端）ID</label>
                  <McpCredentialInput
                    kind="identifier"
                    name="microsoft-365-oauth-client-id"
                    value={clientId}
                    onChange={(event) => setClientId(event.target.value)}
                    placeholder="00000000-0000-0000-0000-000000000000"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-gray-700">客户端密钥值</label>
                  <McpCredentialInput
                    kind="secret"
                    name="microsoft-365-oauth-client-secret"
                    value={clientSecret}
                    onChange={(event) => setClientSecret(event.target.value)}
                    placeholder="请粘贴密钥值，不要填写密钥 ID"
                  />
                </div>
              </div>
              {replacingCredentials ? (
                <DenButton className="mt-3" variant="secondary" size="sm" disabled={submitting} onClick={() => setReplacingCredentials(false)}>
                  保留已保存的凭据
                </DenButton>
              ) : null}
            </div>
          ) : null}
        </div>

        {formError ? (
          <DenNotice message={getErrorMessage(formError, "保存 Microsoft 365 设置失败，请重试。")} className="mt-3" />
        ) : null}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DenButton variant="secondary" onClick={onClose} disabled={submitting}>取消</DenButton>
          <DenButton
            variant="primary"
            loading={submitting}
            disabled={saveDisabled}
            data-testid="save-microsoft-365"
            onClick={() => onSubmit({
              ...(showCredentialFields ? { clientId: trimmedClientId, clientSecret: trimmedClientSecret, tenantId: trimmedTenantId } : {}),
              features,
            })}
          >
            {configured && !replacingCredentials ? "保存权限" : replacingCredentials ? "保存新配置" : "保存配置"}
          </DenButton>
        </div>
      </div>
    </div>
  );
}
