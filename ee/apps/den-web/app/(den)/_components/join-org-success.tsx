"use client";

import { useEffect, useState } from "react";
import {
  getDesktopHandoffGrant,
  getDesktopHandoffOpenworkUrl,
  rememberDesktopHandoffGrant,
} from "../_lib/desktop-handoff";
import { getErrorMessage, requestJson } from "../_lib/den-flow";
import { createOrganizationInstallLink } from "../_lib/install-link-data";
import { isMobileUserAgent } from "../_lib/platform";
import { useDesktopHandoffStatus } from "../_lib/use-desktop-handoff-status";
import { OnboardingShell } from "./onboarding-shell";
import { OrganizationBrandIdentity, type OrganizationBrand } from "./organization-brand-identity";

const capabilities = [
  {
    title: "处理表格",
    description: "新建、整理和转换 CSV、Excel 文件。",
  },
  {
    title: "操作浏览器",
    description: "让内置浏览器自动完成重复操作。",
  },
  {
    title: "整理文件",
    description: "读取、修改和管理文件与文件夹。",
  },
  {
    title: "自动处理任务",
    description: "使用 Skills 和命令复用常用工作流程。",
  },
  {
    title: "撰写内容",
    description: "起草文档、邮件和报告。",
  },
  {
    title: "连接业务工具",
    description: "通过 MCP 使用外部服务和工具。",
  },
];

function ReturnToFoxWorkStatus({
  foxworkUrl,
  grant,
  organizationName,
}: {
  foxworkUrl: string;
  grant: string | null;
  organizationName: string;
}) {
  const { status, timedOut } = useDesktopHandoffStatus(grant);
  const [copied, setCopied] = useState(false);

  async function copyFoxWorkUrl() {
    await navigator.clipboard.writeText(foxworkUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  if (status === "consumed") {
    return (
      <div
        className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700"
        data-testid="desktop-connected"
        aria-live="polite"
      >
        已连接，{organizationName} 的公司配置已写入 SeeWayWork。
      </div>
    );
  }

  if (timedOut || status === "unknown") {
    return (
      <div
        className="grid gap-3 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600"
        data-testid="desktop-handoff-troubleshoot"
        aria-live="polite"
      >
        <p className="m-0">
          SeeWayWork 没有打开？{" "}
          <button
            type="button"
            className="font-medium text-slate-950 underline-offset-4 hover:underline"
            onClick={() => window.location.assign(foxworkUrl)}
          >
            再次打开 SeeWayWork
          </button>
        </p>
        <div className="grid gap-2">
          <p className="m-0">仍然没有反应？请复制下面的登录链接并粘贴到浏览器地址栏打开：</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className="den-input min-w-0 flex-1 text-xs"
              value={foxworkUrl}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
            />
            <button
              type="button"
              className="den-button-secondary sm:w-auto"
              onClick={() => void copyFoxWorkUrl()}
            >
              {copied ? "已复制" : "复制链接"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <p className="m-0 text-sm text-slate-500" aria-live="polite">
      正在返回 SeeWayWork...
    </p>
  );
}

type JoinOrgSuccessProps = {
  organizationId: string;
  organizationName: string;
  brand: OrganizationBrand;
  desktopAuthRequested: boolean;
  desktopAuthScheme: string;
  onContinueInBrowser: () => void;
};

export function JoinOrgSuccess({
  organizationId,
  organizationName,
  brand,
  desktopAuthRequested,
  desktopAuthScheme,
  onContinueInBrowser,
}: JoinOrgSuccessProps) {
  const [isMobile, setIsMobile] = useState<boolean | null>(null);
  const [installBusy, setInstallBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [desktopOpenworkUrl, setDesktopOpenworkUrl] = useState<string | null>(null);
  const [desktopGrant, setDesktopGrant] = useState<string | null>(null);

  useEffect(() => {
    setIsMobile(isMobileUserAgent());
  }, []);

  async function handleGetApp() {
    setInstallBusy(true);
    setActionError(null);

    try {
      window.location.assign(await createOrganizationInstallLink(organizationId, false));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "暂时无法准备安装包，请重试。");
    } finally {
      setInstallBusy(false);
    }
  }

  async function handleReturnToFoxWork() {
    setHandoffBusy(true);
    setActionError(null);

    try {
      const { response, payload } = await requestJson(
        "/v1/auth/desktop-handoff",
        { method: "POST", body: JSON.stringify({ desktopScheme: desktopAuthScheme }) },
        12000,
      );
      if (!response.ok) {
        setActionError(getErrorMessage(payload, `无法返回 SeeWayWork（${response.status}）。`));
        return;
      }

      const foxworkUrl = getDesktopHandoffOpenworkUrl(payload);
      if (!foxworkUrl) {
        setActionError("登录交接已准备完成，但公司服务没有返回 SeeWayWork 打开链接。");
        return;
      }

      const grant = getDesktopHandoffGrant(payload, foxworkUrl);
      rememberDesktopHandoffGrant(grant);
      setDesktopOpenworkUrl(foxworkUrl);
      setDesktopGrant(grant);
      window.location.assign(foxworkUrl);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "无法返回 SeeWayWork。");
    } finally {
      setHandoffBusy(false);
    }
  }

  return (
    <OnboardingShell state="joined" width="wide">
      <section data-testid="join-org-success">
      <div className="grid gap-6 rounded-[1.75rem] border border-slate-200/80 bg-white p-6 md:p-8">
        <div className="grid gap-2">
          <p className="den-eyebrow">SeeWayWork 公司服务</p>
          <h1 className="den-title-xl max-w-full">
            已加入{" "}
            <OrganizationBrandIdentity organizationName={organizationName} brand={brand} />
          </h1>
          <p className="den-copy">安装 SeeWayWork 后，就可以在电脑上使用公司的模型、MCP 和 Skills。</p>
        </div>

        {isMobile === null ? (
          <p className="den-copy">正在准备下一步...</p>
        ) : isMobile ? (
          <div className="grid gap-5">
            <div className="den-frame-inset grid gap-2 rounded-[1.5rem] p-5" data-testid="join-org-mobile-note">
              <p className="m-0 text-base font-medium text-[var(--dls-text-primary)]">SeeWayWork 需要安装在电脑上</p>
              <p className="den-copy">账号已经加入公司。回到电脑后安装 SeeWayWork，再用当前账号登录即可。</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button type="button" className="den-button-primary w-full sm:w-auto" onClick={onContinueInBrowser}>
                先在浏览器中继续
              </button>
            </div>
          </div>
        ) : desktopAuthRequested ? (
          desktopOpenworkUrl ? (
            <ReturnToFoxWorkStatus
              foxworkUrl={desktopOpenworkUrl}
              grant={desktopGrant}
              organizationName={organizationName}
            />
          ) : (
            <button
              type="button"
              className="den-button-primary w-full sm:w-fit"
              onClick={() => void handleReturnToFoxWork()}
              disabled={handoffBusy}
              data-testid="join-org-return-openwork"
            >
              {handoffBusy ? "正在返回 SeeWayWork..." : "返回 SeeWayWork"}
            </button>
          )
        ) : (
          <div className="grid gap-5">
            <div className="grid gap-3 sm:grid-cols-2">
              {capabilities.map((capability) => (
                <div key={capability.title} className="den-frame-inset rounded-[1.25rem] p-4">
                  <p className="m-0 text-sm font-medium text-[var(--dls-text-primary)]">{capability.title}</p>
                  <p className="m-0 mt-1 text-xs leading-snug text-[var(--dls-text-secondary)]">{capability.description}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="den-button-primary w-full sm:w-fit"
                onClick={() => void handleGetApp()}
                disabled={installBusy}
                data-testid="join-org-get-app"
              >
                {installBusy ? "正在准备安装包..." : "下载 SeeWayWork"}
              </button>
              {actionError ? (
                <span className="self-center text-sm text-[var(--dls-text-secondary)]">
                  请联系公司管理员获取安装包。
                </span>
              ) : null}
            </div>
          </div>
        )}

        <button
          type="button"
          className="w-fit text-sm text-[var(--dls-text-secondary)] underline-offset-4 hover:underline"
          onClick={onContinueInBrowser}
          data-testid="join-org-continue-browser"
        >
          在浏览器中继续
        </button>

        {actionError ? <div className="den-notice is-error">{actionError}</div> : null}
      </div>
      </section>
    </OnboardingShell>
  );
}
