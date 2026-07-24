"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  Copy,
  Download,
  Plug,
  Sparkles,
  Store,
  Zap,
} from "lucide-react";
import {
  getCustomLlmProvidersRoute,
  getGithubIntegrationRoute,
  getInferenceRoute,
  getMarketplacesRoute,
  getOrgDashboardRoute,
} from "../../_lib/den-org";
import { requestJson } from "../../_lib/den-flow";
import { createOrganizationInstallLink } from "../../_lib/install-link-data";
import { useDenFlow } from "../../_providers/den-flow-provider";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { useMarketplaces } from "./marketplace-data";
import { useHasAnyIntegration } from "./integration-data";

const APP_INSTALLED_KEY = "openwork:onboarding:app-installed";
const MCP_ADDED_KEY = "openwork:onboarding:mcp-added";
const FORK_DONE_KEY = "openwork:onboarding:fork-done";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function useLocalStorageFlag(key: string) {
  const [value, setValue] = useState(false);

  useEffect(() => {
    try {
      setValue(localStorage.getItem(key) === "1");
    } catch {
      // localStorage unavailable
    }
  }, [key]);

  function toggle(next: boolean) {
    setValue(next);
    try {
      if (next) localStorage.setItem(key, "1");
      else localStorage.removeItem(key);
    } catch {
      // localStorage unavailable
    }
  }

  return [value, toggle] as const;
}

function useInferenceEnabled() {
  return useQuery({
    queryKey: ["onboarding", "inference"] as const,
    queryFn: async (): Promise<boolean> => {
      const { response, payload } = await requestJson("/v1/inference", { method: "GET" }, 12000);
      if (!response.ok) return false;
      const inference = isRecord(payload) && isRecord(payload.inference) ? payload.inference : null;
      return inference?.enabled === true;
    },
    staleTime: 30_000,
  });
}

function railClass(done: boolean, required: boolean): string {
  if (done) return "bg-emerald-500";
  if (required) return "bg-amber-400";
  return "bg-gray-200";
}

function StepTag({ done, required }: { done: boolean; required: boolean }) {
  if (done) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
        <Check className="h-3 w-3" /> 已完成
      </span>
    );
  }
  if (required) {
    return (
      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">必需</span>
    );
  }
  return (
    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">可选</span>
  );
}

function StepCard({
  done,
  required,
  icon,
  title,
  helper,
  children,
}: {
  done: boolean;
  required: boolean;
  icon: React.ReactNode;
  title: string;
  helper: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-white py-4 pl-5 pr-4 shadow-sm sm:pr-5">
      <div className={`absolute inset-y-0 left-0 w-1 ${railClass(done, required)}`} />

      {done ? (
        <div className="flex items-center gap-3 py-0.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
            <Check className="h-4 w-4" />
          </div>
          <p className="text-[14px] font-semibold text-[#07192C]">{title}</p>
          <StepTag done={done} required={required} />
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#07192C] text-white">
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[14px] font-semibold text-[#07192C]">{title}</p>
              <StepTag done={done} required={required} />
            </div>
            <p className="mt-1 text-[13px] leading-5 text-[#5C6B86]">{helper}</p>
            <div className="mt-3">{children}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function SubCheckbox({
  checked,
  onClick,
  label,
  action,
}: {
  checked: boolean;
  onClick?: () => void;
  label: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <button
        type="button"
        onClick={onClick}
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
          checked ? "border-emerald-500 bg-emerald-500 text-white" : "border-gray-300 bg-white hover:border-gray-400"
        }`}
      >
        {checked ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
      </button>
      <span className={`text-[13px] ${checked ? "text-gray-400 line-through" : "text-[#30405F]"}`}>{label}</span>
      {action}
    </div>
  );
}

export function MarketplaceOnboardingScreen() {
  const { runtimeConfig, runtimeConfigLoaded } = useDenFlow();
  const { activeOrg, orgSlug } = useOrgDashboard();
  const { data: marketplaces = [] } = useMarketplaces();
  const { hasAny: githubConnected } = useHasAnyIntegration();
  const { data: modelsEnabled = false } = useInferenceEnabled();

  const [appInstalled, setAppInstalled] = useLocalStorageFlag(APP_INSTALLED_KEY);
  const [mcpAdded, setMcpAdded] = useLocalStorageFlag(MCP_ADDED_KEY);
  const [forkDone, setForkDone] = useLocalStorageFlag(FORK_DONE_KEY);
  const [copied, setCopied] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const orgName = activeOrg?.name ?? "公司";
  const mcpEndpoint = runtimeConfigLoaded ? runtimeConfig.foxworkMcpEndpoint : "";

  const steps = {
    download: { done: appInstalled, required: true },
    models: { done: modelsEnabled, required: true },
    mcp: { done: mcpAdded, required: false },
    marketplace: { done: forkDone || githubConnected, required: false },
  } as const;

  const doneCount = Object.values(steps).filter((s) => s.done).length;
  const requiredDone = steps.download.done && steps.models.done;
  const totalSteps = 4;
  const progressPct = (doneCount / totalSteps) * 100;

  const marketplacePluginTotal = marketplaces.reduce((sum, m) => sum + m.pluginCount, 0);

  async function handleGetApp() {
    const organizationId = activeOrg?.id?.trim() ?? "";
    if (!organizationId) {
      setDownloadError("当前公司信息尚未加载，请刷新后重试。");
      return;
    }

    setDownloadBusy(true);
    setDownloadError(null);
    try {
      window.location.assign(await createOrganizationInstallLink(organizationId));
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "暂时无法准备安装包，请联系公司管理员。");
      setDownloadBusy(false);
    }
  }

  async function copyMcpEndpoint() {
    if (!mcpEndpoint) return;
    try {
      await navigator.clipboard.writeText(mcpEndpoint);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-12 pt-6 sm:px-6">
      {/* Header */}
      <header className="text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#6C7890]">FoxWork 公司工作区</p>
        <h1 className="mt-3 text-[28px] font-semibold leading-[1.05] tracking-[-0.04em] text-[#07192C] sm:text-[34px]">
          {requiredDone ? `${orgName} 已准备就绪。` : `继续完成 ${orgName} 的配置。`}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-[14px] leading-6 text-[#5A6886]">
          {requiredDone
            ? "模型和客户端已准备就绪。你可以立即使用，也可以继续完成下方可选配置。"
            : "FoxWork 通过桌面客户端使用。请先下载客户端并启用模型，再按需添加其他能力。"}
        </p>

        {/* Download CTA */}
        {!appInstalled ? (
          <div className="mt-5 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => void handleGetApp()}
              disabled={downloadBusy}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#07192C] px-5 py-2.5 text-[13px] font-semibold text-white transition hover:bg-[#111c33] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              <Download className="h-4 w-4" /> {downloadBusy ? "正在准备安装包..." : "下载桌面客户端"}
            </button>
            <button
              type="button"
              onClick={() => setAppInstalled(true)}
              className="text-[13px] font-medium text-[#5A6886] transition hover:text-[#07192C]"
            >
              我已安装 →
            </button>
          </div>
        ) : (
          <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-[13px] font-medium text-emerald-700">
            <Check className="h-4 w-4" /> 桌面客户端已安装
          </div>
        )}
        {downloadError ? <p className="mx-auto mt-2 max-w-md text-[12px] font-medium text-rose-600">{downloadError}</p> : null}

        {/* Progress */}
        <div className="mx-auto mt-6 max-w-xs">
          <div className="flex items-center justify-between text-[12px] font-medium text-[#6C7890]">
            <span>已完成 {doneCount}/{totalSteps} 项</span>
            <span>{Math.round(progressPct)}%</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </header>

      {/* Divider */}
      <div className="my-8 h-px bg-gray-100" />

      {/* Checklist */}
      <section>
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-[#07192C]">配置公司工作区</h2>
        <p className="mt-0.5 text-[13px] text-[#6C7890]">请先完成必需步骤，其余能力可按需配置。</p>

        <div className="mt-5 space-y-3">
          {/* Step 1: Download app */}
          <StepCard
            done={appInstalled}
            required
            icon={<Download className="h-4 w-4" />}
            title="获取桌面客户端"
            helper="电脑操作、浏览器、图片生成和 Google Workspace 需要在客户端中使用。"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => void handleGetApp()}
                disabled={downloadBusy}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[#07192C] px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-[#111c33] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Download className="h-3.5 w-3.5" /> {downloadBusy ? "正在准备..." : "下载"}
              </button>
              <button
                type="button"
                onClick={() => setAppInstalled(true)}
                className="inline-flex items-center justify-center gap-1.5 text-[13px] font-medium text-[#5A6886] transition hover:text-[#07192C]"
              >
                我已安装 <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </StepCard>

          {/* Step 2: Enable models */}
          <StepCard
            done={modelsEnabled}
            required
            icon={<Sparkles className="h-4 w-4" />}
            title="启用公司共享模型"
            helper="公司统一配置可用模型和访问密钥，也可接入其他模型服务。"
          >
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link
                href={getInferenceRoute(orgSlug)}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[#07192C] px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-[#111c33]"
              >
                <Zap className="h-3.5 w-3.5" /> 启用模型
              </Link>
              <Link
                href={getCustomLlmProvidersRoute(orgSlug)}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-gray-200 px-4 py-2 text-[13px] font-semibold text-[#07192C] transition hover:bg-gray-50"
              >
                配置其他模型服务
              </Link>
            </div>
          </StepCard>

          {/* Step 3: MCP */}
          <StepCard
            done={mcpAdded}
            required={false}
            icon={<Plug className="h-4 w-4" />}
            title="在 OpenCode、Codex 或其他 MCP 客户端中使用 FoxWork"
            helper="复制公司 MCP 地址。未配置时请联系管理员获取接入方式。"
          >
            <div className="space-y-2.5">
              <button
                type="button"
                aria-label={`复制 FoxWork MCP 地址 ${mcpEndpoint || "尚未配置"}`}
                onClick={copyMcpEndpoint}
                disabled={!mcpEndpoint}
                className="inline-flex max-w-full items-center justify-between gap-2 whitespace-normal rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-left text-[12px] font-mono text-[#07192C] transition hover:bg-gray-100"
              >
                <span className="min-w-0 break-all">{mcpEndpoint || (runtimeConfigLoaded ? "管理员尚未配置公司 MCP 地址" : "正在读取公司 MCP 地址...")}</span>
                {copied ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />}
              </button>
              <p aria-live="polite" className="min-h-5 text-[12px] font-medium text-emerald-600">
                {copied ? "FoxWork MCP 地址已复制。" : ""}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                {runtimeConfig.foxworkMcpDocsUrl ? (
                  <a
                    href={runtimeConfig.foxworkMcpDocsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#164B8F] transition hover:text-[#0F376C]"
                  >
                    阅读公司配置指南 <ArrowRight className="h-3.5 w-3.5" />
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={() => setMcpAdded(!mcpAdded)}
                  className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#5A6886] transition hover:text-[#07192C]"
                >
                  {mcpAdded ? "✓ 已添加" : "标记为已添加"}
                </button>
              </div>
            </div>
          </StepCard>

          {/* Step 4: Marketplace */}
          <StepCard
            done={forkDone || githubConnected}
            required={false}
            icon={<Store className="h-4 w-4" />}
            title="配置团队能力市场"
            helper="查看公司能力市场，也可以按权限从 GitHub 导入公司的插件。"
          >
            <div className="space-y-2.5">
              <SubCheckbox
                checked={forkDone}
                onClick={() => setForkDone(!forkDone)}
                label="已查看公司能力市场"
                action={
                  <Link
                    href={getMarketplacesRoute(orgSlug)}
                    className="inline-flex items-center gap-1 text-[13px] font-medium text-[#164B8F] transition hover:text-[#0F376C]"
                  >
                    查看 <ArrowRight className="h-3 w-3" />
                  </Link>
                }
              />
              <SubCheckbox
                checked={githubConnected}
                label="从 GitHub 导入"
                action={
                  githubConnected ? (
                    <span className="inline-flex items-center gap-1 text-[13px] font-medium text-emerald-600">
                      <Check className="h-3.5 w-3.5" /> 已连接
                    </span>
                  ) : (
                    <Link
                      href={getGithubIntegrationRoute(orgSlug)}
                      className="inline-flex items-center gap-1 text-[13px] font-medium text-[#164B8F] transition hover:text-[#0F376C]"
                    >
                      连接 <ArrowRight className="h-3 w-3" />
                    </Link>
                  )
                }
              />
              {marketplaces.length > 0 ? (
                <p className="pt-1 text-[12px] text-[#6C7890]">
                  {marketplaces.length} 个能力市场 · {marketplacePluginTotal} 个扩展
                </p>
              ) : null}
            </div>
          </StepCard>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-8 border-t border-gray-100 pt-5 text-center">
        <p className="text-[13px] text-[#6C7890]">
          已完成配置？{" "}
          <Link href={getMarketplacesRoute(orgSlug)} className="font-medium text-[#164B8F] transition hover:text-[#0F376C]">
            查看能力市场
          </Link>{" "}
          ·{" "}
          <Link href={getOrgDashboardRoute(orgSlug)} className="font-medium text-[#164B8F] transition hover:text-[#0F376C]">
            返回工作台
          </Link>
        </p>
      </footer>
    </div>
  );
}
