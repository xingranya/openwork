"use client";

import { useQuery } from "@tanstack/react-query";
import { getErrorMessage, requestJson } from "../../_lib/den-flow";

/**
 * 插件由技能、自动触发规则、MCP 服务、智能体和命令组成。
 * 本文件只定义前端数据结构，并通过 Den API 读取公司插件目录。
 */

// ── Primitive types ────────────────────────────────────────────────────────

export type PluginCategory =
  | "integrations"
  | "workflows"
  | "code-intelligence"
  | "output-styles"
  | "infrastructure";

export type PluginSkill = {
  id: string;
  name: string;
  description: string;
};

export type PluginHookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "SessionStart"
  | "SessionEnd"
  | "UserPromptSubmit"
  | "Notification"
  | "Stop";

export type PluginHook = {
  id: string;
  event: PluginHookEvent;
  description: string;
  matcher?: string | null;
};

export type PluginMcpTransport = "stdio" | "http" | "sse";

export type PluginMcp = {
  configObjectId?: string;
  id: string;
  name: string;
  description: string;
  transport: PluginMcpTransport;
  toolCount: number;
  serverName?: string;
  url?: string | null;
};

export type PluginAgent = {
  id: string;
  name: string;
  description: string;
};

export type PluginCommand = {
  id: string;
  name: string;
  description: string;
};

export type PluginSource =
  | { type: "marketplace"; marketplace: string }
  | { type: "github"; repo: string }
  | { type: "local"; path: string };

export type PluginMarketplaceRef = {
  id: string;
  name: string;
};

export type DenPlugin = {
  id: string;
  name: string;
  slug: string;
  description: string;
  version: string | null;
  author: string;
  category: PluginCategory;
  installed: boolean;
  source: PluginSource;
  marketplaces?: PluginMarketplaceRef[];
  skills: PluginSkill[];
  hooks: PluginHook[];
  mcps: PluginMcp[];
  agents: PluginAgent[];
  commands: PluginCommand[];
  updatedAt: string;
  /**
   * 标记插件依赖的数据源；连接相应数据源后才允许显示和使用。
   */
  requiresProvider: "any" | "github" | "bitbucket";
};

// ── Display helpers ────────────────────────────────────────────────────────

export function getPluginCategoryLabel(category: PluginCategory): string {
  switch (category) {
    case "integrations":
      return "外部服务";
    case "workflows":
      return "工作流程";
    case "code-intelligence":
      return "代码智能";
    case "output-styles":
      return "输出风格";
    case "infrastructure":
      return "基础设施";
  }
}

export function formatPluginTimestamp(value: string | null): string {
  if (!value) {
    return "最近更新";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "最近更新";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function getPluginPartsSummary(plugin: DenPlugin): string {
  const parts: string[] = [];
  if (plugin.skills.length > 0) {
    parts.push(`${plugin.skills.length} 项技能`);
  }
  if (plugin.hooks.length > 0) {
    parts.push(`${plugin.hooks.length} 条自动触发规则`);
  }
  if (plugin.mcps.length > 0) {
    parts.push(`${plugin.mcps.length} 项 MCP 服务`);
  }
  if (plugin.agents.length > 0) {
    parts.push(`${plugin.agents.length} 个智能体`);
  }
  if (plugin.commands.length > 0) {
    parts.push(`${plugin.commands.length} 条命令`);
  }
  return parts.length > 0 ? parts.join(" · ") : "空插件";
}

// ── 查询入口 ──────────────────────────────────────────────────────────────

export const pluginQueryKeys = {
  all: ["plugins"] as const,
  list: () => [...pluginQueryKeys.all, "list"] as const,
  detail: (id: string) => [...pluginQueryKeys.all, "detail", id] as const,
};

function slugifyPluginName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "plugin";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function pluginMcpTransport(config: Record<string, unknown>): PluginMcpTransport {
  const type = asString(config.type)?.toLowerCase();
  if (type === "sse") return "sse";
  return asString(config.url) ? "http" : "stdio";
}

export function pluginMcpEntries(item: {
  description: string;
  id: string;
  normalizedPayload: Record<string, unknown> | null;
  title: string;
}): PluginMcp[] {
  const payload = item.normalizedPayload ?? {};
  const entries = [payload.mcpServers, payload.mcp].flatMap((container) => (
    isRecord(container)
      ? Object.entries(container).filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]))
      : []
  ));
  const servers = entries.length > 0
    ? entries
    : [[item.title, payload] satisfies [string, Record<string, unknown>]];

  return servers.map(([serverName, config], index) => ({
    configObjectId: item.id,
    description: item.description,
    id: servers.length === 1 ? item.id : `${item.id}:${index}`,
    name: servers.length === 1 ? item.title : serverName,
    serverName,
    toolCount: typeof config.toolCount === "number" ? config.toolCount : 0,
    transport: pluginMcpTransport(config),
    url: asString(config.url),
  }));
}

function parseMembershipConfigObject(entry: unknown) {
  if (!isRecord(entry) || !isRecord(entry.configObject)) {
    return null;
  }

  const configObject = entry.configObject;
  const id = asString(configObject.id);
  const title = asString(configObject.title);
  const description = asString(configObject.description) ?? "从已连接的代码仓库导入。";
  const objectType = asString(configObject.objectType);
  const currentRelativePath = asString(configObject.currentRelativePath);
  const latestVersion = isRecord(configObject.latestVersion) ? configObject.latestVersion : null;
  const normalizedPayload = latestVersion && isRecord(latestVersion.normalizedPayloadJson)
    ? latestVersion.normalizedPayloadJson
    : null;

  if (!id || !title || !objectType) {
    return null;
  }

  return {
    currentRelativePath,
    description,
    id,
    normalizedPayload,
    objectType,
    title,
  };
}

function derivePluginCategory(input: { agents: PluginAgent[]; commands: PluginCommand[]; hooks: PluginHook[]; mcps: PluginMcp[]; skills: PluginSkill[] }): PluginCategory {
  if (input.mcps.length > 0 || input.hooks.length > 0) {
    return "integrations";
  }
  if (input.agents.length > 0 || input.commands.length > 0 || input.skills.length > 0) {
    return "workflows";
  }
  return "output-styles";
}

function parsePluginHookEvent(value: string | null): PluginHookEvent {
  switch (value) {
    case "PreToolUse":
    case "PostToolUse":
    case "SessionStart":
    case "SessionEnd":
    case "UserPromptSubmit":
    case "Notification":
    case "Stop":
      return value;
    default:
      return "Notification";
  }
}

async function fetchResolvedPlugin(id: string): Promise<DenPlugin | null> {
  const [pluginResult, membershipsResult] = await Promise.all([
    requestJson(`/v1/plugins/${encodeURIComponent(id)}`, { method: "GET" }, 15000),
    requestJson(`/v1/plugins/${encodeURIComponent(id)}/resolved`, { method: "GET" }, 15000),
  ]);

  if (!pluginResult.response.ok) {
    throw new Error(getErrorMessage(pluginResult.payload, `插件加载失败（${pluginResult.response.status}）。`));
  }
  if (!membershipsResult.response.ok) {
    throw new Error(getErrorMessage(membershipsResult.payload, `插件内容加载失败（${membershipsResult.response.status}）。`));
  }

  const pluginItem = isRecord(pluginResult.payload) && isRecord(pluginResult.payload.item) ? pluginResult.payload.item : null;
  if (!pluginItem) {
    return null;
  }

  const pluginId = asString(pluginItem.id);
  const name = asString(pluginItem.name);
  if (!pluginId || !name) {
    return null;
  }

  const membershipItems = isRecord(membershipsResult.payload) && Array.isArray(membershipsResult.payload.items)
    ? membershipsResult.payload.items.map(parseMembershipConfigObject).filter((value): value is NonNullable<typeof value> => Boolean(value))
    : [];

  const skills = membershipItems
    .filter((item) => item.objectType === "skill")
    .map((item) => ({ id: item.id, name: item.title, description: item.description } satisfies PluginSkill));
  const agents = membershipItems
    .filter((item) => item.objectType === "agent")
    .map((item) => ({ id: item.id, name: item.title, description: item.description } satisfies PluginAgent));
  const commands = membershipItems
    .filter((item) => item.objectType === "command")
    .map((item) => ({ id: item.id, name: item.currentRelativePath?.split("/").pop()?.replace(/\.md$/i, "") ?? item.title, description: item.description } satisfies PluginCommand));
  const hooks = membershipItems
    .filter((item) => item.objectType === "hook")
    .map((item) => ({
      description: item.description,
      event: parsePluginHookEvent(asString(item.normalizedPayload?.event) ?? item.title),
      id: item.id,
      matcher: asString(item.normalizedPayload?.matcher),
    } satisfies PluginHook));
  const mcps = membershipItems
    .filter((item) => item.objectType === "mcp")
    .flatMap(pluginMcpEntries);

  const marketplaces = Array.isArray(pluginItem.marketplaces)
    ? pluginItem.marketplaces.flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const id = asString(entry.id);
        const marketplaceName = asString(entry.name);
        if (!id || !marketplaceName) return [];
        return [{ id, name: marketplaceName } satisfies PluginMarketplaceRef];
      })
    : [];

  return {
    agents,
    author: "已连接的代码仓库",
    category: derivePluginCategory({ agents, commands, hooks, mcps, skills }),
    commands,
    description: asString(pluginItem.description) ?? "从已连接的代码仓库导入。",
    hooks,
    id: pluginId,
    installed: true,
    marketplaces,
    mcps,
    name,
    requiresProvider: "github",
    skills,
    slug: slugifyPluginName(name),
    source: marketplaces[0]
      ? { type: "marketplace", marketplace: marketplaces[0].name }
      : { type: "github", repo: "已连接的代码仓库" },
    updatedAt: asString(pluginItem.updatedAt) ?? new Date().toISOString(),
    version: null,
  } satisfies DenPlugin;
}

export function usePlugins() {
  return useQuery({
    queryKey: pluginQueryKeys.list(),
    queryFn: async () => {
      const { response, payload } = await requestJson("/v1/plugins?status=active&limit=100", { method: "GET" }, 20000);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, `加载插件失败（${response.status}）。`));
      }

      const items = isRecord(payload) && Array.isArray(payload.items) ? payload.items : [];
      const pluginIds = items.flatMap((entry) => {
        const id = isRecord(entry) ? asString(entry.id) : null;
        return id ? [id] : [];
      });

      const plugins = await Promise.all(pluginIds.map((id) => fetchResolvedPlugin(id)));
      return plugins.filter((plugin): plugin is DenPlugin => Boolean(plugin));
    },
  });
}

export function usePlugin(id: string) {
  return useQuery({
    queryKey: pluginQueryKeys.detail(id),
    queryFn: async () => fetchResolvedPlugin(id),
    enabled: Boolean(id),
  });
}
