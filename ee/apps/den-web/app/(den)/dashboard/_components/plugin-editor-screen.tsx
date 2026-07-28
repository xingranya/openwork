"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, FileText, Plus, Server, Terminal, Trash2 } from "lucide-react";
import { DenButton } from "../../_components/ui/button";
import { DenInput } from "../../_components/ui/input";
import { DenSelect } from "../../_components/ui/select";
import { DenTextarea } from "../../_components/ui/textarea";
import { getErrorMessage, getRequestError, requestJson } from "../../_lib/den-flow";
import { getImportPluginRoute, getPluginRoute, getPluginsRoute } from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { useMarketplaces } from "./marketplace-data";
import { pluginQueryKeys } from "./plugin-data";
import {
  clearPluginImportDraft,
  loadPluginImportDraft,
  pluginImportSourceLabel,
  pluginImportSuggestedName,
  type PluginImportDraft,
} from "./plugin-import-draft";

type ComponentKind = "skill" | "command" | "mcp";

type DraftComponent = {
  key: number;
  kind: ComponentKind;
  name: string;
  description: string;
  /** 技能和命令使用 Markdown 正文，MCP 使用远程服务器地址。 */
  content: string;
};

const COMPONENT_META: Record<ComponentKind, { label: string; icon: typeof FileText; hint: string }> = {
  skill: {
    label: "技能",
    icon: FileText,
    hint: "任务匹配时，智能体会加载这份分步工作说明。请写清前提、步骤和完成标准。",
  },
  command: {
    label: "命令",
    icon: Terminal,
    hint: "可重复使用的斜杠命令。请明确说明运行后要完成什么。",
  },
  mcp: {
    label: "MCP 服务器",
    icon: Server,
    hint: "通过地址连接远程 MCP 服务器。成员安装插件后即可使用其中的工具。",
  },
};

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "component";
}

function buildSkillMarkdown(component: DraftComponent): string {
  const name = slugify(component.name);
  const description = component.description.trim() || component.name.trim();
  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    "---",
    "",
    component.content.trim(),
    "",
  ].join("\n");
}

function buildComponentBody(component: DraftComponent): Record<string, unknown> {
  if (component.kind === "mcp") {
    const serverName = slugify(component.name);
    return {
      type: "mcp",
      input: {
        normalizedPayloadJson: {
          mcpServers: {
            [serverName]: { type: "remote", url: component.content.trim() },
          },
        },
        metadata: {
          name: component.name.trim(),
          description: component.description.trim() || undefined,
        },
      },
    };
  }

  return {
    type: component.kind,
    input: {
      rawSourceText:
        component.kind === "skill" ? buildSkillMarkdown(component) : `${component.content.trim()}\n`,
      metadata: {
        name: component.name.trim(),
        description: component.description.trim() || undefined,
      },
    },
  };
}

async function postJson(path: string, body: unknown, failureLabel: string): Promise<unknown> {
  const { response, payload } = await requestJson(
    path,
    { method: "POST", body: JSON.stringify(body) },
    20000,
  );
  if (!response.ok) {
    throw getRequestError(payload, response, `${failureLabel}（${response.status}）。`);
  }
  return payload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function createdItemId(payload: unknown): string | null {
  const item = isRecord(payload) && isRecord(payload.item) ? payload.item : null;
  return typeof item?.id === "string" ? item.id : null;
}

export function PluginEditorScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { orgContext, orgSlug, runReauthableAction } = useOrgDashboard();
  const { data: marketplaces = [] } = useMarketplaces();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [components, setComponents] = useState<DraftComponent[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const [marketplaceId, setMarketplaceId] = useState<string>("");
  const [marketplaceTouched, setMarketplaceTouched] = useState(false);
  const [shareOrgWide, setShareOrgWide] = useState(true);
  const [importDraft, setImportDraft] = useState<PluginImportDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // 默认选择指定的应用市场；若没有指定，则选择列表中的第一个。
  useEffect(() => {
    if (marketplaceTouched || marketplaceId || marketplaces.length === 0) return;
    const requestedMarketplaceId = searchParams.get("marketplaceId");
    const requestedMarketplace = marketplaces.find((marketplace) => marketplace.id === requestedMarketplaceId);
    setMarketplaceId(requestedMarketplace?.id ?? marketplaces[0].id);
  }, [marketplaceId, marketplaceTouched, marketplaces, searchParams]);

  useEffect(() => {
    const draft = loadPluginImportDraft();
    if (!draft) return;
    setImportDraft(draft);
    setName((current) => current || pluginImportSuggestedName(draft.preview));
  }, []);

  const addComponent = (kind: ComponentKind) => {
    setComponents((current) => [
      ...current,
      { key: nextKey, kind, name: "", description: "", content: "" },
    ]);
    setNextKey((value) => value + 1);
  };

  const updateComponent = (key: number, patch: Partial<DraftComponent>) => {
    setComponents((current) =>
      current.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)),
    );
  };

  const removeComponent = (key: number) => {
    setComponents((current) => current.filter((entry) => entry.key !== key));
  };

  async function createImportedPlugin(draft: PluginImportDraft) {
    if (!shareOrgWide && !orgContext) {
      setSaveError("公司成员信息仍在加载，请稍后再试。");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      let pluginId: string | null = null;
      await runReauthableAction("create-imported-plugin", async () => {
        const result = await requestJson(
          "/v1/plugins/import-mcps-from-github-url",
          {
            method: "POST",
            body: JSON.stringify({
              access: {
                orgWide: shareOrgWide,
                memberIds: shareOrgWide || !orgContext ? [] : [orgContext.currentMember.id],
                teamIds: [],
              },
              authType: draft.authType,
              credentialMode: draft.credentialMode,
              description: description.trim() || null,
              githubUrl: draft.githubUrl,
              marketplaceId: marketplaceId || undefined,
              name: name.trim(),
              selectedSkillKeys: draft.selectedSkillKeys,
              selectedServerKeys: draft.selectedServerKeys,
            }),
          },
          30000,
        );
        if (!result.response.ok) {
          throw getRequestError(result.payload, result.response, "导入插件创建失败。");
        }
        const item = isRecord(result.payload) && isRecord(result.payload.item) ? result.payload.item : null;
        const plugin = item && isRecord(item.plugin) ? item.plugin : null;
        pluginId = plugin && typeof plugin.id === "string" ? plugin.id : null;
      });
      if (!pluginId) throw new Error("插件已创建，但没有返回插件编号，请刷新后确认。");

      clearPluginImportDraft();
      await queryClient.invalidateQueries({ queryKey: pluginQueryKeys.all });
      router.push(getPluginRoute(orgSlug, pluginId));
      router.refresh();
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? getErrorMessage(error.message, "导入插件创建失败，请重试。")
          : "导入插件创建失败，请重试。",
      );
    } finally {
      setSaving(false);
    }
  }

  async function createPlugin() {
    if (!name.trim()) {
      setSaveError("请填写插件名称。");
      return;
    }
    if (importDraft) {
      await createImportedPlugin(importDraft);
      return;
    }
    if (components.length === 0) {
      setSaveError("请至少添加一个技能、命令或 MCP 服务器。");
      return;
    }
    for (const component of components) {
      if (!component.name.trim()) {
        setSaveError(`请填写${COMPONENT_META[component.kind].label}名称。`);
        return;
      }
      if (!component.content.trim()) {
        setSaveError(
          component.kind === "mcp"
            ? `请填写“${component.name || "MCP 服务器"}”的服务地址。`
            : `请填写“${component.name || "此组件"}”的工作说明。`,
        );
        return;
      }
    }

    setSaving(true);
    setSaveError(null);
    try {
      let pluginPayload: unknown = null;
      await runReauthableAction("create-plugin", async () => {
        pluginPayload = await postJson(
          "/v1/plugins",
          {
            name: name.trim(),
            description: description.trim() || null,
            components: components.map(buildComponentBody),
            orgWide: shareOrgWide,
            marketplaceId: marketplaceId || undefined,
          },
          "插件创建失败",
        );
      });
      const pluginId = createdItemId(pluginPayload);
      if (!pluginId) throw new Error("插件已创建，但没有返回插件编号，请刷新后确认。");

      await queryClient.invalidateQueries({ queryKey: pluginQueryKeys.all });
      router.push(getPluginRoute(orgSlug, pluginId));
      router.refresh();
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? getErrorMessage(error.message, "插件创建失败，请重试。")
          : "插件创建失败，请重试。",
      );
    } finally {
      setSaving(false);
    }
  }

  const importedSkills = importDraft
    ? importDraft.preview.skills.filter((skill) => importDraft.selectedSkillKeys.includes(skill.skillKey))
    : [];
  const importedServers = importDraft
    ? importDraft.preview.servers.filter((server) => importDraft.selectedServerKeys.includes(server.serverKey))
    : [];

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <Link
        href={getPluginsRoute(orgSlug)}
        className="mb-6 inline-flex items-center gap-2 text-[14px] text-gray-500 hover:text-gray-900"
      >
        <ArrowLeft size={15} />
        返回插件列表
      </Link>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[28px] font-semibold text-gray-900">创建插件</h1>
          <p className="mt-1 text-[15px] text-gray-500">
            将技能、命令和 MCP 服务器组合成插件，团队成员可在 SeeWayWork 中直接安装。
          </p>
        </div>
        <Link
          href={getImportPluginRoute(orgSlug)}
          className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-[13px] font-medium text-gray-700 transition hover:bg-gray-50"
        >
          <Download size={14} />
          {importDraft ? "更换导入内容" : "从 GitHub 导入"}
        </Link>
      </div>

      <div className="mt-8 flex flex-col gap-5 rounded-[24px] border border-gray-200 bg-white p-6">
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-gray-700">插件名称</label>
          <DenInput
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：销售拜访准备"
            disabled={saving}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-gray-700">插件说明</label>
          <DenTextarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="说明这个插件可以帮助成员完成什么"
            rows={2}
            disabled={saving}
          />
        </div>
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-[18px] font-semibold text-gray-900">插件内容</h2>
          {!importDraft ? <div className="flex gap-2">
            {(Object.keys(COMPONENT_META) as ComponentKind[]).map((kind) => {
              const meta = COMPONENT_META[kind];
              return (
                <DenButton
                  key={kind}
                  variant="secondary"
                  size="sm"
                  onClick={() => addComponent(kind)}
                  disabled={saving}
                >
                  <Plus size={14} />
                  {meta.label}
                </DenButton>
              );
            })}
          </div> : null}
        </div>

        {importDraft ? (
          <div className="mt-4 overflow-hidden rounded-[24px] border border-gray-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 bg-gray-50 px-5 py-4">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-gray-400">从 GitHub 导入</p>
                <p className="mt-1 truncate text-[14px] font-medium text-gray-900">{pluginImportSourceLabel(importDraft.preview)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-[13px] font-medium">
                <button
                  type="button"
                  className="text-gray-500 hover:text-gray-900"
                  onClick={() => {
                    clearPluginImportDraft();
                    setImportDraft(null);
                  }}
                >
                  放弃导入
                </button>
                <Link href={getImportPluginRoute(orgSlug)} className="text-gray-600 hover:text-gray-900">
                  更换导入内容
                </Link>
              </div>
            </div>
            {[...importedSkills.map((skill) => ({ key: `skill:${skill.skillKey}`, label: "技能", name: skill.name, Icon: FileText })),
              ...importedServers.map((server) => ({ key: `mcp:${server.serverKey}`, label: "MCP 服务器", name: server.name, Icon: Server }))]
              .map((item) => (
                <div key={item.key} className="flex items-center gap-3 border-b border-gray-100 px-5 py-3 last:border-b-0">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gray-50 text-gray-500">
                    <item.Icon size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-gray-900">{item.name}</span>
                    <span className="block text-[12px] text-gray-500">{item.label}</span>
                  </span>
                </div>
              ))}
          </div>
        ) : components.length === 0 ? (
          <div className="mt-4 rounded-[24px] border border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-center text-[14px] text-gray-500">
            请添加技能、命令或 MCP 服务器。每个插件至少需要一个组件。
          </div>
        ) : null}

        {!importDraft ? <div className="mt-4 flex flex-col gap-4">
          {components.map((component) => {
            const meta = COMPONENT_META[component.kind];
            const Icon = meta.icon;
            return (
              <div key={component.key} className="rounded-[24px] border border-gray-200 bg-white p-5">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[14px] font-medium text-gray-900">
                    <Icon size={16} className="text-gray-500" />
                    {meta.label}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeComponent(component.key)}
                    disabled={saving}
                    className="text-gray-400 hover:text-red-600"
                    aria-label={`移除${meta.label}`}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <p className="mb-4 text-[13px] text-gray-500">{meta.hint}</p>
                <div className="flex flex-col gap-3">
                  <DenInput
                    value={component.name}
                    onChange={(event) => updateComponent(component.key, { name: event.target.value })}
                    placeholder={component.kind === "mcp" ? "服务器名称，例如 Linear" : "名称，例如销售拜访准备"}
                    disabled={saving}
                  />
                  {component.kind !== "mcp" ? (
                    <DenInput
                      value={component.description}
                      onChange={(event) => updateComponent(component.key, { description: event.target.value })}
                      placeholder="用一句话说明智能体应在什么情况下使用它"
                      disabled={saving}
                    />
                  ) : null}
                  {component.kind === "mcp" ? (
                    <DenInput
                      value={component.content}
                      onChange={(event) => updateComponent(component.key, { content: event.target.value })}
                      placeholder="https://mcp.example.com/mcp"
                      disabled={saving}
                    />
                  ) : (
                    <DenTextarea
                      value={component.content}
                      onChange={(event) => updateComponent(component.key, { content: event.target.value })}
                      placeholder={
                        component.kind === "skill"
                          ? "使用 Markdown 编写智能体应遵循的工作说明…"
                          : "说明成员运行此命令后应完成什么…"
                      }
                      rows={8}
                      disabled={saving}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div> : null}
      </div>

      <div className="mt-6 flex flex-col gap-4 rounded-[24px] border border-gray-200 bg-white p-6">
        <h2 className="text-[18px] font-semibold text-gray-900">共享范围</h2>
        <label className="flex items-start gap-3 text-[14px] text-gray-700">
          <input
            type="checkbox"
            checked={shareOrgWide}
            onChange={(event) => setShareOrgWide(event.target.checked)}
            disabled={saving}
            className="mt-0.5"
          />
          <span>
            与公司所有成员共享
            <span className="block text-[13px] text-gray-500">
              成员可以查看并安装此插件。取消勾选后，插件仅你本人可见，便于继续调整。
            </span>
          </span>
        </label>
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-gray-700">应用市场</label>
          <DenSelect
            value={marketplaceId}
            onChange={(event) => {
              setMarketplaceTouched(true);
              setMarketplaceId(event.target.value);
            }}
            disabled={saving}
          >
            <option value="">暂不发布</option>
            {marketplaces.map((marketplace) => (
              <option key={marketplace.id} value={marketplace.id}>
                {marketplace.name}
              </option>
            ))}
          </DenSelect>
          <p className="mt-1.5 text-[13px] text-gray-500">
            发布后，成员可以在 SeeWayWork 的应用市场中找到此插件。
          </p>
        </div>
      </div>

      {saveError ? (
        <div className="mt-4 rounded-[16px] border border-red-200 bg-red-50 px-4 py-3 text-[14px] text-red-700">
          {saveError}
        </div>
      ) : null}

      <div className="mt-6 flex items-center gap-3">
        <DenButton onClick={() => void createPlugin()} disabled={saving}>
          {saving ? "正在创建…" : "创建插件"}
        </DenButton>
        <Link
          href={getPluginsRoute(orgSlug)}
          onClick={() => clearPluginImportDraft()}
          className="text-[14px] text-gray-500 hover:text-gray-900"
        >
          取消
        </Link>
      </div>
    </div>
  );
}
