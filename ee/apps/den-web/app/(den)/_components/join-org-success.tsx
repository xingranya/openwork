"use client";

import { useEffect, useState } from "react";
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

  return (
    <section className="den-page py-4 lg:py-6" data-testid="join-org-success">
      <div className="den-frame grid max-w-[48rem] gap-6 p-6 md:p-8">
        <div className="grid gap-2">
          <p className="den-eyebrow">FoxWork 公司服务</p>
          <h1 className="den-title-xl max-w-[16ch]">已加入 {organizationName}</h1>
          <p className="den-copy">安装 FoxWork 后，就可以在电脑上使用公司的模型、MCP 和 Skills。</p>
        </div>

        {isMobile === null ? (
          <p className="den-copy">正在准备下一步...</p>
        ) : isMobile ? (
          <div className="grid gap-5">
            <div className="den-frame-inset grid gap-2 rounded-[1.5rem] p-5" data-testid="join-org-mobile-note">
              <p className="m-0 text-base font-medium text-[var(--dls-text-primary)]">FoxWork 需要安装在电脑上</p>
              <p className="den-copy">账号已经加入公司。回到电脑后安装 FoxWork，再用当前账号登录即可。</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button type="button" className="den-button-primary w-full sm:w-auto" onClick={onContinueInBrowser}>
                先在浏览器中继续
              </button>
              {emailSent ? <div className="den-notice is-info">Sent — check your inbox when you&apos;re back at your desk.</div> : null}
            </div>
          </div>
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
                onClick={() => void handleReturnToOpenWork()}
                disabled={handoffBusy}
                data-testid="join-org-return-openwork"
              >
                {installBusy ? "正在准备安装包..." : "下载 FoxWork"}
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
  );
}
