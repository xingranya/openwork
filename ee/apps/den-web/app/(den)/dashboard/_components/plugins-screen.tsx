"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Cable,
  FileText,
  Plus,
  Puzzle,
  Search,
  Server,
  Store,
  Terminal,
  Users,
  Webhook,
} from "lucide-react";
import { StaticSeededGradient } from "@openwork/ui/react";
import { UnderlineTabs } from "../../_components/ui/tabs";
import { DashboardPageTemplate } from "../../_components/ui/dashboard-page-template";
import { DenInput } from "../../_components/ui/input";
import { buttonVariants } from "../../_components/ui/button";
import { getIntegrationsRoute, getNewPluginRoute, getPluginRoute } from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { useHasAnyIntegration } from "./integration-data";
import {
  getPluginCategoryLabel,
  getPluginPartsSummary,
  usePlugins,
} from "./plugin-data";

type PluginView = "plugins" | "skills" | "agents" | "commands" | "hooks" | "mcps";

const PLUGIN_TABS = [
  { value: "plugins" as const, label: "插件", icon: Puzzle },
  { value: "skills" as const, label: "技能", icon: FileText },
  { value: "agents" as const, label: "智能体", icon: Users },
  { value: "commands" as const, label: "命令", icon: Terminal },
  { value: "hooks" as const, label: "自动触发", icon: Webhook },
  { value: "mcps" as const, label: "MCP", icon: Server },
];

export function PluginsScreen() {
  const { orgSlug } = useOrgDashboard();
  const { data: plugins = [], isLoading, error } = usePlugins();
  const { hasAny: hasAnyIntegration, isLoading: integrationsLoading } = useHasAnyIntegration();
  const [activeView, setActiveView] = useState<PluginView>("plugins");
  const [query, setQuery] = useState("");

  const normalizedQuery = query.trim().toLowerCase();

  const filteredPlugins = useMemo(() => {
    if (!normalizedQuery) {
      return plugins;
    }

    return plugins.filter((plugin) => {
      return (
        plugin.name.toLowerCase().includes(normalizedQuery) ||
        plugin.description.toLowerCase().includes(normalizedQuery) ||
        plugin.author.toLowerCase().includes(normalizedQuery) ||
        getPluginCategoryLabel(plugin.category).toLowerCase().includes(normalizedQuery)
      );
    });
  }, [normalizedQuery, plugins]);

  const allSkills = useMemo(
    () =>
      plugins.flatMap((plugin) =>
        plugin.skills.map((skill) => ({ ...skill, pluginId: plugin.id, pluginName: plugin.name })),
      ),
    [plugins],
  );

  const allHooks = useMemo(
    () =>
      plugins.flatMap((plugin) =>
        plugin.hooks.map((hook) => ({ ...hook, pluginId: plugin.id, pluginName: plugin.name })),
      ),
    [plugins],
  );

  const allMcps = useMemo(
    () =>
      plugins.flatMap((plugin) =>
        plugin.mcps.map((mcp) => ({ ...mcp, pluginId: plugin.id, pluginName: plugin.name })),
      ),
    [plugins],
  );

  const allAgents = useMemo(
    () =>
      plugins.flatMap((plugin) =>
        plugin.agents.map((agent) => ({ ...agent, pluginId: plugin.id, pluginName: plugin.name })),
      ),
    [plugins],
  );

  const allCommands = useMemo(
    () =>
      plugins.flatMap((plugin) =>
        plugin.commands.map((command) => ({ ...command, pluginId: plugin.id, pluginName: plugin.name })),
      ),
    [plugins],
  );

  const filteredSkills = useMemo(() => {
    if (!normalizedQuery) return allSkills;
    return allSkills.filter(
      (skill) =>
        skill.name.toLowerCase().includes(normalizedQuery) ||
        skill.description.toLowerCase().includes(normalizedQuery) ||
        skill.pluginName.toLowerCase().includes(normalizedQuery),
    );
  }, [normalizedQuery, allSkills]);

  const filteredHooks = useMemo(() => {
    if (!normalizedQuery) return allHooks;
    return allHooks.filter(
      (hook) =>
        hook.event.toLowerCase().includes(normalizedQuery) ||
        hook.description.toLowerCase().includes(normalizedQuery) ||
        hook.pluginName.toLowerCase().includes(normalizedQuery),
    );
  }, [normalizedQuery, allHooks]);

  const filteredMcps = useMemo(() => {
    if (!normalizedQuery) return allMcps;
    return allMcps.filter(
      (mcp) =>
        mcp.name.toLowerCase().includes(normalizedQuery) ||
        mcp.description.toLowerCase().includes(normalizedQuery) ||
        mcp.pluginName.toLowerCase().includes(normalizedQuery),
    );
  }, [normalizedQuery, allMcps]);

  const filteredAgents = useMemo(() => {
    if (!normalizedQuery) return allAgents;
    return allAgents.filter(
      (agent) =>
        agent.name.toLowerCase().includes(normalizedQuery) ||
        agent.description.toLowerCase().includes(normalizedQuery) ||
        agent.pluginName.toLowerCase().includes(normalizedQuery),
    );
  }, [normalizedQuery, allAgents]);

  const filteredCommands = useMemo(() => {
    if (!normalizedQuery) return allCommands;
    return allCommands.filter(
      (command) =>
        command.name.toLowerCase().includes(normalizedQuery) ||
        command.description.toLowerCase().includes(normalizedQuery) ||
        command.pluginName.toLowerCase().includes(normalizedQuery),
    );
  }, [normalizedQuery, allCommands]);

  const searchPlaceholder =
    activeView === "plugins"
      ? "搜索插件..."
      : activeView === "skills"
        ? "搜索技能..."
        : activeView === "agents"
          ? "搜索智能体..."
          : activeView === "commands"
            ? "搜索命令..."
            : activeView === "hooks"
              ? "搜索自动触发规则..."
              : "搜索 MCP 服务...";

  return (
    <DashboardPageTemplate
      icon={Puzzle}
      badgeLabel="预览版"
      title="插件"
      description="查看和管理公司插件。插件可以包含技能、自动触发规则、MCP 服务、智能体和命令。"
      colors={["#EDE9FE", "#4C1D95", "#7C3AED", "#C4B5FD"]}
    >
      <div className="mb-8 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-col gap-4">
          <UnderlineTabs tabs={PLUGIN_TABS} activeTab={activeView} onChange={setActiveView} />
          <div>
            <DenInput
              type="search"
              icon={Search}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
            />
          </div>
        </div>
        <Link href={getNewPluginRoute(orgSlug)} className={buttonVariants({ variant: "primary" })}>
          <Plus size={15} />
          创建插件
        </Link>
      </div>

      {error ? (
        <div className="mb-6 rounded-[24px] border border-red-200 bg-red-50 px-5 py-4 text-[14px] text-red-700">
          {error instanceof Error ? error.message : "加载插件失败。"}
        </div>
      ) : null}

      {isLoading || integrationsLoading ? (
        <div className="rounded-[28px] border border-gray-200 bg-white px-6 py-10 text-[15px] text-gray-500">
          正在加载插件目录...
        </div>
      ) : !hasAnyIntegration && plugins.length === 0 ? (
        <ConnectIntegrationEmptyState integrationsHref={getIntegrationsRoute(orgSlug)} />
      ) : activeView === "plugins" ? (
        filteredPlugins.length === 0 ? (
          <EmptyState
            title={plugins.length === 0 ? "暂时没有可用插件" : "没有找到匹配的插件"}
            description={
              plugins.length === 0
                ? "从仓库导入或由集成服务提供的插件会显示在这里。"
                : "换个关键词，或到技能、自动触发、MCP 标签页中查找。"
            }
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {filteredPlugins.map((plugin) => (
              <Link
                key={plugin.id}
                href={getPluginRoute(orgSlug, plugin.id)}
                className="group block overflow-hidden rounded-2xl border border-gray-100 bg-white transition hover:-translate-y-0.5 hover:border-gray-200 hover:shadow-[0_8px_24px_-12px_rgba(15,23,42,0.12)]"
              >
                <div className="flex items-stretch">
                  <div className="relative w-[68px] shrink-0 overflow-hidden">
                    <StaticSeededGradient seed={plugin.id} className="absolute inset-0" />
                    <div className="relative flex h-full items-center justify-center">
                      <div className="flex h-10 w-10 items-center justify-center rounded-[12px] border border-white/60 bg-white shadow-[0_8px_20px_-8px_rgba(15,23,42,0.3)]">
                        <Puzzle className="h-4 w-4 text-gray-700" aria-hidden />
                      </div>
                    </div>
                  </div>

                  <div className="min-w-0 flex-1 px-5 py-4">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="truncate text-[14px] font-semibold tracking-[-0.01em] text-gray-900">
                        {plugin.name}
                      </h2>
                    </div>
                    {plugin.description ? (
                      <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-[1.55] text-gray-500">
                        {plugin.description}
                      </p>
                    ) : null}

                    {(plugin.marketplaces ?? []).length > 0 ? (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {(plugin.marketplaces ?? []).map((marketplace) => (
                          <span
                            key={marketplace.id}
                            className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2 py-0.5 text-[11px] text-gray-600"
                          >
                            <Store className="h-3 w-3 text-gray-400" aria-hidden />
                            <span className="truncate">{marketplace.name}</span>
                          </span>
                        ))}
                      </div>
                    ) : null}

                    <p className="mt-3 text-[11.5px] text-gray-400">
                      {getPluginPartsSummary(plugin)}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )
      ) : activeView === "skills" ? (
        <PrimitiveList
          icon={FileText}
          emptyLabel="插件目录中还没有技能"
          emptyDescriptionEmpty="插件提供的技能会显示在这里。"
          emptyDescriptionFiltered="没有找到匹配的技能。"
          unfilteredCount={allSkills.length}
          rows={filteredSkills.map((skill) => ({
            id: skill.id,
            title: skill.name,
            description: skill.description,
            pluginName: skill.pluginName,
            href: getPluginRoute(orgSlug, skill.pluginId),
          }))}
        />
      ) : activeView === "agents" ? (
        <PrimitiveList
          icon={Users}
          emptyLabel="插件目录中还没有智能体"
          emptyDescriptionEmpty="插件提供的智能体会显示在这里。"
          emptyDescriptionFiltered="没有找到匹配的智能体。"
          unfilteredCount={allAgents.length}
          rows={filteredAgents.map((agent) => ({
            id: agent.id,
            title: agent.name,
            description: agent.description,
            pluginName: agent.pluginName,
            href: getPluginRoute(orgSlug, agent.pluginId),
          }))}
        />
      ) : activeView === "commands" ? (
        <PrimitiveList
          icon={Terminal}
          emptyLabel="插件目录中还没有命令"
          emptyDescriptionEmpty="插件提供的斜杠命令会显示在这里。"
          emptyDescriptionFiltered="没有找到匹配的命令。"
          unfilteredCount={allCommands.length}
          rows={filteredCommands.map((command) => ({
            id: command.id,
            title: command.name,
            description: command.description,
            pluginName: command.pluginName,
            monospacedTitle: true,
            href: getPluginRoute(orgSlug, command.pluginId),
          }))}
        />
      ) : activeView === "hooks" ? (
        <PrimitiveList
          icon={Webhook}
          emptyLabel="插件目录中还没有自动触发规则"
          emptyDescriptionEmpty="插件提供的自动触发规则会显示在这里。"
          emptyDescriptionFiltered="没有找到匹配的自动触发规则。"
          unfilteredCount={allHooks.length}
          rows={filteredHooks.map((hook) => ({
            id: hook.id,
            title: hook.event,
            description: hook.description,
            pluginName: hook.pluginName,
            monospacedTitle: true,
            meta: hook.matcher ? `匹配规则：${hook.matcher}` : undefined,
            href: getPluginRoute(orgSlug, hook.pluginId),
          }))}
        />
      ) : (
        <PrimitiveList
          icon={Server}
          emptyLabel="插件目录中还没有 MCP 服务"
          emptyDescriptionEmpty="插件提供的 MCP 服务会显示在这里。"
          emptyDescriptionFiltered="没有找到匹配的 MCP 服务。"
          unfilteredCount={allMcps.length}
          rows={filteredMcps.map((mcp) => ({
            id: mcp.id,
            title: mcp.name,
            description: mcp.description,
            pluginName: mcp.pluginName,
            meta: `${mcp.transport} · ${mcp.toolCount} 个工具`,
            href: getPluginRoute(orgSlug, mcp.pluginId),
          }))}
        />
      )}
    </DashboardPageTemplate>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-[32px] border border-dashed border-gray-200 bg-white px-6 py-12 text-center">
      <p className="text-[16px] font-medium tracking-[-0.03em] text-gray-900">{title}</p>
      <p className="mx-auto mt-3 max-w-[520px] text-[15px] leading-8 text-gray-500">{description}</p>
    </div>
  );
}

function ConnectIntegrationEmptyState({ integrationsHref }: { integrationsHref: string }) {
  return (
    <div className="rounded-[32px] border border-dashed border-gray-200 bg-white px-6 py-12 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-[14px] bg-gray-100 text-gray-500">
        <Cable className="h-6 w-6" />
      </div>
      <p className="text-[16px] font-medium tracking-[-0.03em] text-gray-900">
        连接集成服务后查看插件
      </p>
      <p className="mx-auto mt-3 max-w-[520px] text-[15px] leading-8 text-gray-500">
        插件、技能、自动触发规则和 MCP 服务来自已连接的代码仓库。请先连接 GitHub 或 Bitbucket。
      </p>
      <div className="mt-6 flex justify-center">
        <Link
          href={integrationsHref}
          className={buttonVariants({ variant: "primary" })}
        >
          <Cable className="h-4 w-4" aria-hidden="true" />
          打开集成服务
        </Link>
      </div>
    </div>
  );
}

type PrimitiveRow = {
  id: string;
  title: string;
  description: string;
  pluginName: string;
  meta?: string;
  monospacedTitle?: boolean;
  href: string;
};

function PrimitiveList({
  icon: Icon,
  rows,
  unfilteredCount,
  emptyLabel,
  emptyDescriptionEmpty,
  emptyDescriptionFiltered,
}: {
  icon: React.ComponentType<{ className?: string }>;
  rows: PrimitiveRow[];
  unfilteredCount: number;
  emptyLabel: string;
  emptyDescriptionEmpty: string;
  emptyDescriptionFiltered: string;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title={unfilteredCount === 0 ? emptyLabel : "没有找到匹配内容"}
        description={unfilteredCount === 0 ? emptyDescriptionEmpty : emptyDescriptionFiltered}
      />
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {rows.map((row) => (
        <Link
          key={row.id}
          href={row.href}
          className="group flex min-w-0 flex-col gap-3 rounded-2xl border border-gray-100 bg-white px-4 py-4 transition hover:-translate-y-0.5 hover:border-gray-200 hover:shadow-[0_8px_24px_-12px_rgba(15,23,42,0.08)]"
        >
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-gray-50 text-gray-500 group-hover:bg-gray-100 group-hover:text-gray-700">
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p
                className={`truncate text-[14px] font-semibold tracking-[-0.01em] text-gray-900 ${
                  row.monospacedTitle ? "font-mono" : ""
                }`}
              >
                {row.title}
              </p>
              {row.description ? (
                <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-[1.55] text-gray-500">
                  {row.description}
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 border-t border-gray-50 pt-2.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2 py-0.5 text-[11px] text-gray-500">
              <Puzzle className="h-3 w-3 text-gray-400" aria-hidden />
              <span className="max-w-[160px] truncate">{row.pluginName}</span>
            </span>
            {row.meta ? (
              <span className="rounded-full bg-gray-50 px-2 py-0.5 text-[11px] text-gray-500">
                {row.meta}
              </span>
            ) : null}
          </div>
        </Link>
      ))}
    </div>
  );
}
