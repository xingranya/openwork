"use client";

import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronRight,
  Cpu,
  Puzzle,
  Sparkles,
  Store,
  Users,
  type LucideIcon,
} from "lucide-react";
import { getErrorMessage, requestJson } from "../../_lib/den-flow";
import { formatRoleLabel } from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import {
  formatProviderTimestamp,
  getProviderEnvNames,
  useOrgLlmProviders,
} from "./llm-provider-data";
import { useMarketplaces } from "./marketplace-data";
import { OrganizationDownloadCard } from "./organization-download-card";
import { getPluginPartsSummary, usePlugins } from "./plugin-data";

type MemberInferenceStatus = {
  enabled: boolean;
  subscribed: boolean | null;
  memberCount: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseInferenceStatus(payload: unknown): MemberInferenceStatus | null {
  if (!isRecord(payload) || !isRecord(payload.inference)) {
    return null;
  }

  const inference = payload.inference;
  if (typeof inference.enabled !== "boolean") {
    return null;
  }

  return {
    enabled: inference.enabled,
    subscribed: typeof inference.subscribed === "boolean" ? inference.subscribed : null,
    memberCount: typeof inference.memberCount === "number" ? inference.memberCount : 0,
  };
}

async function fetchInferenceStatus() {
  const { response, payload } = await requestJson("/v1/inference", { method: "GET" }, 12000);
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, `加载公司模型状态失败（${response.status}）。`));
  }

  const parsed = parseInferenceStatus(payload);
  if (!parsed) {
    throw new Error("公司模型状态数据不完整。");
  }

  return parsed;
}

function getErrorText(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

function SummaryCard({
  icon: Icon,
  title,
  value,
  detail,
  tone,
}: {
  icon: LucideIcon;
  title: string;
  value: string;
  detail: string;
  tone: "blue" | "emerald" | "violet" | "amber";
}) {
  const toneClass = {
    blue: "bg-blue-50 text-blue-700",
    emerald: "bg-emerald-50 text-emerald-700",
    violet: "bg-violet-50 text-violet-700",
    amber: "bg-amber-50 text-amber-700",
  }[tone];

  return (
    <section
      className="rounded-2xl border border-gray-100 bg-white px-4 py-3.5"
      data-resource={title}
      data-testid="member-resource-card"
    >
      <div className="flex items-start gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] ${toneClass}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-gray-500">{title}</p>
          <p className="mt-0.5 text-[20px] font-semibold tracking-[-0.03em] text-gray-950">{value}</p>
          <p className="mt-0.5 text-[12px] leading-5 text-gray-500">{detail}</p>
        </div>
      </div>
    </section>
  );
}

function ErrorNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] leading-5 text-amber-800">
      {children}
    </div>
  );
}

function EmptyList({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-[13px] text-gray-500">
      {children}
    </div>
  );
}

export function MemberDashboardScreen() {
  const { activeOrg, orgContext, orgId } = useOrgDashboard();
  const { llmProviders, busy: providersBusy, error: providersError } = useOrgLlmProviders(orgId, { scope: "usable" });
  const { data: marketplaces = [], isLoading: marketplacesLoading, error: marketplacesError } = useMarketplaces();
  const { data: plugins = [], isLoading: pluginsLoading, error: pluginsError } = usePlugins();
  const { data: inference, isLoading: inferenceLoading, error: inferenceError } = useQuery({
    enabled: Boolean(orgId),
    queryKey: ["member-dashboard", "inference", orgId],
    queryFn: fetchInferenceStatus,
  });

  const customProviders = llmProviders.filter((provider) => provider.source !== "openwork");
  const openWorkProviders = llmProviders.filter((provider) => provider.source === "openwork");
  const visiblePluginParts = plugins.reduce(
    (count, plugin) => count + plugin.skills.length + plugin.hooks.length + plugin.mcps.length + plugin.agents.length + plugin.commands.length,
    0,
  );

  const currentMember = orgContext?.currentMember;
  const teamNames = orgContext?.currentMemberTeams.map((team) => team.name).sort((a, b) => a.localeCompare(b)) ?? [];
  const roleLabel = currentMember ? formatRoleLabel(currentMember.role) : "成员";
  const inferenceLabel = inferenceLoading ? "正在检查" : inference?.enabled ? "已启用" : "未启用";

  return (
    <div className="mx-auto max-w-[1100px] px-4 pb-10 pt-4 sm:px-6 md:px-8" data-testid="member-dashboard">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-[#e7e9f0] pb-3">
        <span className="text-[14px] font-semibold tracking-[-0.01em] text-[#07192C]">
          {activeOrg?.name ?? "FoxWork"}
        </span>
        <ChevronRight className="h-3.5 w-3.5 text-[#9AA5BA]" aria-hidden="true" />
        <span className="text-[14px] font-medium tracking-[-0.01em] text-[#5A6886]">工作台</span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.03em] text-[#07192C]">我的工作区</h1>
          <p className="mt-1 max-w-[680px] text-[14px] leading-6 text-[#5A6886]">
            查看公司为你开放的模型、能力市场和插件。
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-white px-4 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-gray-50 text-gray-500">
            <Users className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-[12px] text-gray-500">当前身份：{roleLabel}</p>
            <p className="max-w-[320px] truncate text-[13px] font-medium text-gray-900">
              {teamNames.length > 0 ? teamNames.join("、") : "尚未加入团队"}
            </p>
          </div>
        </div>
      </div>

      {activeOrg && orgContext?.capabilities.installLinks ? (
        <div className="mt-5">
          <OrganizationDownloadCard organizationId={activeOrg.id} organizationName={activeOrg.name} />
        </div>
      ) : null}

      <section className="mt-5" aria-labelledby="member-resources-heading" data-testid="member-resource-overview">
        <div className="mb-3">
          <h2 id="member-resources-heading" className="text-[16px] font-semibold tracking-[-0.02em] text-gray-950">可用资源</h2>
          <p className="mt-0.5 text-[13px] text-gray-500">包括直接分配给你、所在团队或全公司的资源。</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            icon={Sparkles}
            title="公司模型"
            value={inferenceLabel}
            detail={inference?.enabled ? `你可以使用 ${openWorkProviders.length} 组模型凭据。` : "请联系管理员启用公司模型。"}
            tone={inference?.enabled ? "emerald" : "amber"}
          />
          <SummaryCard
            icon={Cpu}
            title="自定义模型服务"
            value={providersBusy ? "加载中" : `${customProviders.length}`}
            detail="你的角色或团队可用的模型和服务商凭据。"
            tone="blue"
          />
          <SummaryCard
            icon={Store}
            title="能力市场"
            value={marketplacesLoading ? "加载中" : `${marketplaces.length}`}
            detail="分配给你或全公司的插件集合。"
            tone="amber"
          />
          <SummaryCard
            icon={Puzzle}
            title="插件"
            value={pluginsLoading ? "加载中" : `${plugins.length}`}
            detail={`共包含 ${visiblePluginParts} 项技能、自动触发规则、MCP、智能体或命令。`}
            tone="violet"
          />
        </div>
      </section>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1fr]">
        <section className="rounded-2xl border border-gray-100 bg-white p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-[18px] font-semibold tracking-[-0.03em] text-gray-950">自定义模型服务</h2>
              <p className="mt-1 text-[13px] text-gray-500">公司向你开放的自定义模型服务。</p>
            </div>
            <span className="rounded-full bg-gray-100 px-3 py-1 text-[12px] font-medium text-gray-600">
              可用 {customProviders.length} 项
            </span>
          </div>

          <div className="mt-5 grid gap-3">
            {providersError ? <ErrorNotice>{providersError}</ErrorNotice> : null}
            {providersBusy ? (
              <EmptyList>正在加载模型服务...</EmptyList>
            ) : customProviders.length === 0 ? (
              <EmptyList>暂时没有向你开放的自定义模型服务。</EmptyList>
            ) : (
              customProviders.slice(0, 5).map((provider) => {
                const envNames = getProviderEnvNames(provider.providerConfig);
                return (
                  <div key={provider.id} className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-semibold text-gray-950">{provider.name}</p>
                        <p className="mt-1 text-[12px] text-gray-500">{provider.models.length} 个模型</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[11px] text-gray-500">
                        {provider.source === "custom" ? "自定义" : "目录"}
                      </span>
                    </div>
                    <p className="mt-3 text-[12px] text-gray-500">
                      {envNames.length > 0 ? envNames.slice(0, 3).join(", ") : "未列出环境变量"} · 更新于 {formatProviderTimestamp(provider.updatedAt)}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-gray-100 bg-white p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-[18px] font-semibold tracking-[-0.03em] text-gray-950">公司模型</h2>
              <p className="mt-1 text-[13px] text-gray-500">公司统一提供的模型服务状态。</p>
            </div>
            <span className={`rounded-full px-3 py-1 text-[12px] font-medium ${inference?.enabled ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
              {inferenceLabel}
            </span>
          </div>

          <div className="mt-5 grid gap-3">
            {inferenceError ? <ErrorNotice>{getErrorText(inferenceError)}</ErrorNotice> : null}
            <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className={`h-5 w-5 ${inference?.enabled ? "text-emerald-600" : "text-gray-400"}`} aria-hidden="true" />
                <div>
                  <p className="text-[14px] font-semibold text-gray-950">
                    {inference?.enabled ? "此工作区已启用" : "此工作区未启用"}
                  </p>
                  <p className="mt-1 text-[12px] text-gray-500">
                    {inference?.subscribed === false ? "管理员需要先开通模型服务，成员才能使用。" : `${inference?.memberCount ?? 0} 名成员已计入用量限制。`}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1fr]">
        <section className="rounded-2xl border border-gray-100 bg-white p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-[18px] font-semibold tracking-[-0.03em] text-gray-950">能力市场</h2>
              <p className="mt-1 text-[13px] text-gray-500">能力市场包含插件，登录后会同步到 FoxWork。</p>
            </div>
            <span className="rounded-full bg-gray-100 px-3 py-1 text-[12px] font-medium text-gray-600">
              可见 {marketplaces.length} 项
            </span>
          </div>

          <div className="mt-5 grid gap-3">
            {marketplacesError ? <ErrorNotice>{getErrorText(marketplacesError)}</ErrorNotice> : null}
            {marketplacesLoading ? (
              <EmptyList>正在加载能力市场...</EmptyList>
            ) : marketplaces.length === 0 ? (
              <EmptyList>暂时没有向你开放的能力市场。</EmptyList>
            ) : (
              marketplaces.slice(0, 5).map((marketplace) => (
                <div key={marketplace.id} className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-semibold text-gray-950">{marketplace.name}</p>
                      {marketplace.description ? <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-gray-500">{marketplace.description}</p> : null}
                    </div>
                    <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[11px] text-gray-500">
                      {marketplace.pluginCount} 个插件
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-gray-100 bg-white p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-[18px] font-semibold tracking-[-0.03em] text-gray-950">插件</h2>
              <p className="mt-1 text-[13px] text-gray-500">查看你可以使用的技能、自动触发、MCP、智能体和命令。</p>
            </div>
            <span className="rounded-full bg-gray-100 px-3 py-1 text-[12px] font-medium text-gray-600">
              可见 {plugins.length} 项
            </span>
          </div>

          <div className="mt-5 grid gap-3">
            {pluginsError ? <ErrorNotice>{getErrorText(pluginsError)}</ErrorNotice> : null}
            {pluginsLoading ? (
              <EmptyList>正在加载插件...</EmptyList>
            ) : plugins.length === 0 ? (
              <EmptyList>暂时没有向你开放的插件。</EmptyList>
            ) : (
              plugins.slice(0, 5).map((plugin) => (
                <div key={plugin.id} className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                  <p className="truncate text-[14px] font-semibold text-gray-950">{plugin.name}</p>
                  <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-gray-500">{plugin.description}</p>
                  <p className="mt-3 text-[12px] text-gray-500">{getPluginPartsSummary(plugin)}</p>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
