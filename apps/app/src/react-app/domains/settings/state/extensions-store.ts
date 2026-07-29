import * as React from "react";

import { applyEdits, modify } from "jsonc-parser";

import { t } from "../../../../i18n";
import type {
  Client,
  DenOrgSkillCard,
  HubSkillCard,
  PluginScope,
  ReloadReason,
  ReloadTrigger,
  SkillCard,
} from "../../../../app/types";
import { addOpencodeCacheHint, isDesktopRuntime, normalizeDirectoryPath } from "../../../../app/utils";
import { toChineseUserMessage } from "../../../../app/lib/user-facing-error";
import skillCreatorTemplate from "../../../../app/data/skill-creator.md?raw";
import {
  isPluginInstalled,
  loadPluginsFromConfig as loadPluginsFromConfigHelpers,
  parsePluginListFromContent,
  stripPluginVersion,
} from "../../../../app/utils/plugins";
import {
  importSkill,
  installSkillTemplate,
  joinDesktopPath,
  listGlobalSkills,
  listLocalSkills,
  openDesktopPath,
  pickDirectory,
  readGlobalSkill,
  readLocalSkill,
  readOpencodeConfig,
  revealDesktopItemInDir,
  uninstallSkill as uninstallSkillCommand,
  uninstallGlobalSkill,
  workspaceOpenworkRead,
  workspaceOpenworkWrite,
  writeLocalSkill,
  writeGlobalSkill,
  writeOpencodeConfig,
  type OpencodeConfigFile,
} from "../../../../app/lib/desktop";
import type {
  OpenworkClaudePluginPreview,
  OpenworkServerCapabilities,
  OpenworkServerClient,
  OpenworkServerStatus,
} from "../../../../app/lib/openwork-server";
import {
  createDenClient,
  fetchDenOrgSkillsCatalog,
  readDenSettings,
  type DenOrgMarketplaceResolved,
  type DenOrgPlugin,
  type DenOrgPluginResolved,
} from "../../../../app/lib/den";
import {
  readWorkspaceCloudImports,
  withWorkspaceCloudImports,
  type CloudImportedMarketplace,
  type CloudImportedPlugin,
  type CloudImportedPluginFile,
  type CloudImportedSkill,
} from "../../../../app/cloud/import-state";
import {
  buildCompanySkillInstallPayload,
  reconcileImportedCompanySkills,
  resolveCompanySkillInstallName,
} from "./company-skill-sync";
import {
  derivePendingCloudPluginChanges,
  readPendingCloudSyncChanges,
  refreshDesktopCloudSync,
  type PendingCloudPluginChange,
} from "../../../../app/cloud/desktop-cloud-sync";
import { notifyEvent } from "../../../shell/notifications";
import type { OpenworkServerStore } from "../../connections/openwork-server-store";

const OPENCODE_SKILL_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const OPENCODE_MCP_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;
const OPENCODE_MCP_IMPORT_PATH_PREFIX = "opencode.jsonc#mcp.";
const LEGACY_HUB_REPOS_STORAGE_KEY = "openwork.skills.hubRepos.v1";

type SetStateAction<T> = T | ((current: T) => T);

type SkillTarget = string | Pick<SkillCard, "name" | "source">;

function normalizeSkillTarget(target: SkillTarget) {
  return typeof target === "string"
    ? { name: target.trim(), source: undefined }
    : { name: target.name.trim(), source: target.source };
}

type PluginListEntry = {
  name: string;
  source: "config" | "dir.project" | "dir.global";
  removable: boolean;
};

export type ExtensionsStoreSnapshot = {
  workspaceContextKey: string;
  skills: SkillCard[];
  skillsStatus: string | null;
  hubSkills: HubSkillCard[];
  hubSkillsStatus: string | null;
  cloudOrgSkills: DenOrgSkillCard[];
  cloudOrgSkillsStatus: string | null;
  importedCloudSkills: Record<string, CloudImportedSkill>;
  cloudOrgMarketplaces: DenOrgMarketplaceResolved[];
  cloudOrgMarketplacesStatus: string | null;
  importedCloudMarketplaces: Record<string, CloudImportedMarketplace>;
  importedCloudPlugins: Record<string, CloudImportedPlugin>;
  pendingCloudPluginChanges: Record<string, PendingCloudPluginChange>;
  pluginScope: PluginScope;
  pluginConfig: OpencodeConfigFile | null;
  pluginConfigPath: string | null;
  pluginList: PluginListEntry[];
  pluginInput: string;
  pluginStatus: string | null;
  activePluginGuide: string | null;
  sidebarPluginList: string[];
  sidebarPluginStatus: string | null;
  skillsStale: boolean;
  pluginsStale: boolean;
  hubSkillsStale: boolean;
  cloudOrgSkillsStale: boolean;
};

type MutableState = {
  skillsContextKey: string;
  pluginsContextKey: string;
  hubSkillsContextKey: string;
  cloudOrgSkillsContextKey: string;
  skills: SkillCard[];
  skillsStatus: string | null;
  hubSkills: HubSkillCard[];
  hubSkillsStatus: string | null;
  cloudOrgSkills: DenOrgSkillCard[];
  cloudOrgSkillsStatus: string | null;
  importedCloudSkills: Record<string, CloudImportedSkill>;
  cloudOrgMarketplaces: DenOrgMarketplaceResolved[];
  cloudOrgMarketplacesStatus: string | null;
  importedCloudMarketplaces: Record<string, CloudImportedMarketplace>;
  importedCloudPlugins: Record<string, CloudImportedPlugin>;
  pendingCloudPluginChanges: Record<string, PendingCloudPluginChange>;
  pluginScope: PluginScope;
  pluginConfig: OpencodeConfigFile | null;
  pluginConfigPath: string | null;
  pluginList: PluginListEntry[];
  pluginInput: string;
  pluginStatus: string | null;
  activePluginGuide: string | null;
  sidebarPluginList: string[];
  sidebarPluginStatus: string | null;
};

export type ExtensionsStore = ReturnType<typeof createExtensionsStore>;

function extractSkillBodyMarkdown(skillText: string): string {
  const trimmed = skillText.trim();
  if (!trimmed.startsWith("---")) return trimmed;
  const rest = trimmed.slice(3);
  const end = rest.indexOf("\n---");
  if (end === -1) return trimmed;
  return rest.slice(end + 4).replace(/^\s*\n?/, "");
}

function stripYamlScalarQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseClaudeFrontmatter(text: string): { data: Record<string, unknown>; body: string } {
  const trimmed = text.trim();
  const match = trimmed.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { data: {}, body: trimmed };
  const data: Record<string, unknown> = {};
  let listKey: string | null = null;
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    if (listKey) {
      const listItem = line.match(/^\s+-\s*(.*)$/);
      if (listItem) {
        const entry = stripYamlScalarQuotes(listItem[1] ?? "");
        const current = data[listKey];
        if (entry && Array.isArray(current)) current.push(entry);
        continue;
      }
    }
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):(.*)$/);
    if (!keyMatch) continue;
    const key = keyMatch[1] ?? "";
    const value = (keyMatch[2] ?? "").trim();
    if (!value) {
      data[key] = [];
      listKey = key;
      continue;
    }
    listKey = null;
    data[key] = value === "true" ? true : value === "false" ? false : stripYamlScalarQuotes(value);
  }
  return { data, body: trimmed.slice(match[0].length) };
}

const OPENCODE_MODEL_ID_RE = /^[^\s/]+\/[^\s]+$/;

function translateClaudeTools(value: unknown): Record<string, boolean> | null {
  const names = typeof value === "string"
    ? value.split(",")
    : Array.isArray(value)
      ? value.flatMap((entry) => (typeof entry === "string" ? [entry] : []))
      : null;
  if (names) {
    const tools: Record<string, boolean> = {};
    for (const raw of names) {
      const name = raw.trim().toLowerCase();
      if (name) tools[name] = true;
    }
    return Object.keys(tools).length ? tools : null;
  }
  if (isRecord(value)) {
    const tools: Record<string, boolean> = {};
    for (const [key, entry] of Object.entries(value)) {
      const name = key.trim().toLowerCase();
      if (name && typeof entry === "boolean") tools[name] = entry;
    }
    return Object.keys(tools).length ? tools : null;
  }
  return null;
}

function translateClaudeModel(value: unknown): string | null {
  const model = readNonEmptyString(value);
  return model && OPENCODE_MODEL_ID_RE.test(model) ? model : null;
}

function buildCloudPluginFrontmatter(data: Record<string, string | boolean | Record<string, boolean>>): string {
  const lines: string[] = ["---"];
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else if (typeof value === "boolean") {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}:`);
      for (const [name, enabled] of Object.entries(value)) {
        lines.push(`  ${JSON.stringify(name)}: ${enabled}`);
      }
    }
  }
  lines.push("---");
  return lines.join("\n") + "\n";
}

function buildCloudAgentContent(description: string, rawSourceText: string): string {
  const { data, body } = parseClaudeFrontmatter(rawSourceText);
  const safeDescription = (readNonEmptyString(data.description) ?? description).replace(/\s+/g, " ").trim();
  const model = translateClaudeModel(data.model);
  const tools = translateClaudeTools(data.tools);
  const frontmatter = buildCloudPluginFrontmatter({
    description: safeDescription,
    ...(model ? { model } : {}),
    ...(tools ? { tools } : {}),
  });
  return frontmatter + "\n" + body.replace(/^\s*\n?/, "");
}

function buildCloudCommandContent(name: string, description: string, rawSourceText: string): string {
  const { data, body } = parseClaudeFrontmatter(rawSourceText);
  const safeDescription = (readNonEmptyString(data.description) ?? description).replace(/\s+/g, " ").trim();
  const model = translateClaudeModel(data.model);
  const agent = readNonEmptyString(data.agent);
  const frontmatter = buildCloudPluginFrontmatter({
    name,
    description: safeDescription,
    ...(agent ? { agent } : {}),
    ...(model ? { model } : {}),
    ...(typeof data.subtask === "boolean" ? { subtask: data.subtask } : {}),
  });
  return frontmatter + "\n" + body.replace(/^\s*\n?/, "");
}

function slugifyOpencodeSkillName(title: string): string {
  let base = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!base) base = "skill";
  if (base.length > 64) base = base.slice(0, 64).replace(/-+$/g, "");
  if (!OPENCODE_SKILL_NAME_RE.test(base)) base = "skill";
  return base;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJsonRecord(value: string | null): Record<string, unknown> | null {
  if (!value?.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const text = readNonEmptyString(entry);
        return text ? [text] : [];
      })
    : [];
}

function readStringRecord(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const output: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    const text = readNonEmptyString(entry);
    if (text) output[key] = text;
  }
  return Object.keys(output).length ? output : null;
}

function cloudPluginMcpNameFromPath(path: string): string | null {
  if (!path.startsWith(OPENCODE_MCP_IMPORT_PATH_PREFIX)) return null;
  const name = path.slice(OPENCODE_MCP_IMPORT_PATH_PREFIX.length).trim();
  return OPENCODE_MCP_NAME_RE.test(name) ? name : null;
}

function toConfigPluginListEntries(names: string[]): PluginListEntry[] {
  const next: PluginListEntry[] = [];
  const seen = new Set<string>();
  for (const rawName of names) {
    const name = rawName.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    next.push({ name, source: "config", removable: true });
  }
  return next;
}

function toProjectPluginListEntries(
  items: Array<{ spec: string; source: string }>,
): PluginListEntry[] {
  const byName = new Map<string, PluginListEntry>();
  for (const item of items) {
    const name = item.spec.trim();
    if (!name) continue;
    const source: PluginListEntry["source"] =
      item.source === "dir.project" || item.source === "dir.global"
        ? item.source
        : "config";
    const entry: PluginListEntry = {
      name,
      source,
      removable: source === "config",
    };
    const existing = byName.get(name);
    if (!existing || (entry.removable && !existing.removable)) {
      byName.set(name, entry);
    }
  }
  return [...byName.values()];
}

export function createExtensionsStore(options: {
  client: () => Client | null;
  projectDir: () => string;
  selectedWorkspaceId: () => string;
  selectedWorkspaceRoot: () => string;
  workspaceType: () => "local" | "remote";
  openworkServer: OpenworkServerStore;
  openworkServerConnection?: () => {
    openworkServerClient: OpenworkServerClient | null;
    openworkServerStatus: OpenworkServerStatus;
    openworkServerCapabilities: OpenworkServerCapabilities | null;
  };
  runtimeWorkspaceId: () => string | null;
  ensureRuntimeWorkspaceId?: () => Promise<string | null | undefined>;
  setBusy: (value: boolean) => void;
  setBusyLabel: (value: string | null) => void;
  setBusyStartedAt: (value: number | null) => void;
  setError: (value: string | null) => void;
  markReloadRequired?: (reason: ReloadReason, trigger?: ReloadTrigger) => void;
}) {
  const listeners = new Set<() => void>();

  let disposed = false;
  let started = false;
  let stopOpenworkSubscription: (() => void) | null = null;
  let stopDenSessionListener: (() => void) | null = null;
  let lastWorkspaceContextKey = "";
  let snapshot: ExtensionsStoreSnapshot;

  let refreshSkillsInFlight = false;
  let refreshPluginsInFlight = false;
  let refreshHubSkillsInFlight = false;
  let refreshHubSkillsRequestId = 0;
  let refreshCloudOrgSkillsInFlight = false;
  let refreshCloudOrgMarketplacesInFlight = false;
  let refreshCloudOrgSkillsInFlightKey = "";
  let refreshCloudOrgMarketplacesInFlightKey = "";
  let refreshSkillsAborted = false;
  let refreshPluginsAborted = false;
  let refreshHubSkillsAborted = false;
  let refreshCloudOrgSkillsAborted = false;
  let refreshCloudOrgMarketplacesAborted = false;
  let skillsLoaded = false;
  let hubSkillsLoaded = false;
  let cloudOrgSkillsLoaded = false;
  let cloudOrgMarketplacesLoaded = false;
  let skillsRoot = "";
  let hubSkillsLoadKey = "";
  let cloudOrgSkillsLoadKey = "";
  let cloudOrgMarketplacesLoadKey = "";
  /** Plugin IDs the user has already been notified about. Prevents repeated
   *  "new extension available" notifications across sync cycles. */
  const seenMarketplacePluginIds = new Set<string>();

  let state: MutableState = {
    skillsContextKey: "",
    pluginsContextKey: "",
    hubSkillsContextKey: "",
    cloudOrgSkillsContextKey: "",
    skills: [],
    skillsStatus: null,
    hubSkills: [],
    hubSkillsStatus: null,
    cloudOrgSkills: [],
    cloudOrgSkillsStatus: null,
    importedCloudSkills: {},
    cloudOrgMarketplaces: [],
    cloudOrgMarketplacesStatus: null,
    importedCloudMarketplaces: {},
    importedCloudPlugins: {},
    pendingCloudPluginChanges: {},
    pluginScope: "project",
    pluginConfig: null,
    pluginConfigPath: null,
    pluginList: [],
    pluginInput: "",
    pluginStatus: null,
    activePluginGuide: null,
    sidebarPluginList: [],
    sidebarPluginStatus: null,
  };

  const emitChange = () => {
    for (const listener of listeners) listener();
  };

  const getWorkspaceContextKey = () => {
    const workspaceId = options.selectedWorkspaceId().trim();
    const root = normalizeDirectoryPath(options.selectedWorkspaceRoot().trim());
    const runtimeWorkspaceId = (options.runtimeWorkspaceId() ?? "").trim();
    const workspaceType = options.workspaceType();
    return `${workspaceType}:${workspaceId}:${root}:${runtimeWorkspaceId}`;
  };

  const getOpenworkServerSnapshot = () => {
    const snapshot = options.openworkServer.getSnapshot();
    const connection = options.openworkServerConnection?.();
    if (!connection?.openworkServerClient) return snapshot;
    return {
      ...snapshot,
      openworkServerClient: connection.openworkServerClient,
      openworkServerStatus: connection.openworkServerStatus,
      openworkServerCapabilities: connection.openworkServerCapabilities,
    };
  };

  const resolveWorkspaceServerTarget = async () => {
    const openworkSnapshot = getOpenworkServerSnapshot();
    const openworkClient = openworkSnapshot.openworkServerClient;
    let openworkWorkspaceId = options.runtimeWorkspaceId()?.trim() || null;
    if (!openworkWorkspaceId && openworkSnapshot.openworkServerStatus === "connected" && openworkClient) {
      openworkWorkspaceId = (await options.ensureRuntimeWorkspaceId?.())?.trim() || null;
    }
    const hasOpenworkTarget =
      openworkSnapshot.openworkServerStatus === "connected" &&
      Boolean(openworkClient && openworkWorkspaceId);
    return {
      openworkSnapshot,
      openworkClient,
      openworkWorkspaceId,
      hasOpenworkTarget,
    };
  };

  const refreshSnapshot = () => {
    const workspaceContextKey = getWorkspaceContextKey();
    const orgId = readDenSettings().activeOrgId?.trim() ?? "";
    snapshot = {
      workspaceContextKey,
      skills: state.skills,
      skillsStatus: state.skillsStatus,
      hubSkills: state.hubSkills,
      hubSkillsStatus: state.hubSkillsStatus,
      cloudOrgSkills: state.cloudOrgSkills,
      cloudOrgSkillsStatus: state.cloudOrgSkillsStatus,
      importedCloudSkills: state.importedCloudSkills,
      cloudOrgMarketplaces: state.cloudOrgMarketplaces,
      cloudOrgMarketplacesStatus: state.cloudOrgMarketplacesStatus,
      importedCloudMarketplaces: state.importedCloudMarketplaces,
      importedCloudPlugins: state.importedCloudPlugins,
      pendingCloudPluginChanges: state.pendingCloudPluginChanges,
      pluginScope: state.pluginScope,
      pluginConfig: state.pluginConfig,
      pluginConfigPath: state.pluginConfigPath,
      pluginList: state.pluginList,
      pluginInput: state.pluginInput,
      pluginStatus: state.pluginStatus,
      activePluginGuide: state.activePluginGuide,
      sidebarPluginList: state.sidebarPluginList,
      sidebarPluginStatus: state.sidebarPluginStatus,
      skillsStale: state.skillsContextKey !== workspaceContextKey,
      pluginsStale: state.pluginsContextKey !== workspaceContextKey,
      hubSkillsStale: state.hubSkillsContextKey !== workspaceContextKey,
      cloudOrgSkillsStale: state.cloudOrgSkillsContextKey !== `${workspaceContextKey}::${orgId}`,
    };
  };

  const mutateState = (updater: (current: MutableState) => MutableState) => {
    state = updater(state);
    refreshSnapshot();
    emitChange();
  };

  const setStateField = <K extends keyof MutableState>(key: K, value: MutableState[K]) => {
    if (Object.is(state[key], value)) return;
    mutateState((current) => ({ ...current, [key]: value }));
  };

  const applyStateAction = <T,>(current: T, next: SetStateAction<T>) =>
    typeof next === "function" ? (next as (value: T) => T)(current) : next;

  const formatSkillPath = (location: string) => location.replace(/[/\\]SKILL\.md$/i, "");

  const readWorkspaceOpenworkConfigRecord = async (): Promise<Record<string, unknown>> => {
    const root = options.selectedWorkspaceRoot().trim();
    const isLocalWorkspace = options.workspaceType() === "local";
    const { openworkSnapshot, openworkClient, openworkWorkspaceId, hasOpenworkTarget } =
      await resolveWorkspaceServerTarget();
    const canUseOpenworkServer =
      hasOpenworkTarget &&
      openworkSnapshot.openworkServerCapabilities?.config?.read !== false;

    if (canUseOpenworkServer && openworkClient && openworkWorkspaceId) {
      const config = await openworkClient.getConfig(openworkWorkspaceId);
      return config.openwork ?? {};
    }

    if (hasOpenworkTarget) {
      return {};
    }

    if (isLocalWorkspace && isDesktopRuntime() && root) {
      return await workspaceOpenworkRead({ workspacePath: root }) as unknown as Record<string, unknown>;
    }

    return {};
  };

  const writeWorkspaceOpenworkConfigRecord = async (config: Record<string, unknown>) => {
    const root = options.selectedWorkspaceRoot().trim();
    const isLocalWorkspace = options.workspaceType() === "local";
    const { openworkSnapshot, openworkClient, openworkWorkspaceId, hasOpenworkTarget } =
      await resolveWorkspaceServerTarget();
    const canUseOpenworkServer =
      hasOpenworkTarget &&
      openworkSnapshot.openworkServerCapabilities?.config?.write !== false;

    if (canUseOpenworkServer && openworkClient && openworkWorkspaceId) {
      await openworkClient.patchConfig(openworkWorkspaceId, { openwork: config });
      return true;
    }

    if (hasOpenworkTarget) {
      return false;
    }

    if (isLocalWorkspace && isDesktopRuntime() && root) {
      const result = (await workspaceOpenworkWrite({
        workspacePath: root,
        config: config as never,
      })) as { ok: boolean; stderr?: string; stdout?: string };
      if (!result.ok) {
        throw new Error(toChineseUserMessage(
          result.stderr || result.stdout,
          "无法写入工作区扩展配置。",
        ));
      }
      return true;
    }

    return false;
  };

  const refreshImportedCloudSkills = async () => {
    try {
      const config = await readWorkspaceOpenworkConfigRecord();
      const cloudImports = readWorkspaceCloudImports(config);
      setStateField("importedCloudSkills", cloudImports.skills);
      return cloudImports.skills;
    } catch {
      setStateField("importedCloudSkills", {});
      return {};
    }
  };

  const refreshPendingCloudPluginChanges = async (installedPlugins?: Record<string, CloudImportedPlugin>) => {
    try {
      const target = await resolveWorkspaceServerTarget();
      if (!target.openworkClient || !target.openworkWorkspaceId) {
        setStateField("pendingCloudPluginChanges", {});
        return;
      }
      const syncResult = await refreshDesktopCloudSync({
        openworkClient: target.openworkClient,
        workspaceId: target.openworkWorkspaceId,
      }).catch(() => null);
      const changes = syncResult
        ? syncResult.changes
        : readPendingCloudSyncChanges(await target.openworkClient.getDesktopCloudSync(target.openworkWorkspaceId));
      const pending = derivePendingCloudPluginChanges({
        changes,
        installedPlugins: installedPlugins ?? snapshot.importedCloudPlugins,
      });
      const previousPending = snapshot.pendingCloudPluginChanges;
      setStateField("pendingCloudPluginChanges", pending);

      // 只在首次发现插件变更时提醒员工。
      for (const [pluginId, change] of Object.entries(pending)) {
        if (previousPending[pluginId] === change) continue;
        const installed = (installedPlugins ?? snapshot.importedCloudPlugins)[pluginId];
        const pluginLabel = installed?.name ?? pluginId;
        if (change === "modified") {
          notifyEvent({
            kind: "cloud",
            severity: "info",
            title: "扩展有可用更新",
            body: `${pluginLabel} 已更新`,
            dedupeKey: `plugin-update:${pluginId}`,
            action: { type: "open-extensions-marketplace" },
            actionLabel: "查看更新",
          });
        } else if (change === "removed") {
          notifyEvent({
            kind: "cloud",
            severity: "warning",
            title: "管理员已移除扩展",
            body: `${pluginLabel} 已不可用`,
            dedupeKey: `plugin-removed:${pluginId}`,
            action: { type: "open-extensions-marketplace" },
          });
        }
      }
    } catch {
      // keep previous pending state on failure
    }
  };

  const refreshImportedCloudPlugins = async () => {
    try {
      const target = await resolveWorkspaceServerTarget();
      if (target.openworkClient && target.openworkWorkspaceId) {
        const result = await target.openworkClient.listCloudPlugins(target.openworkWorkspaceId);
        setStateField("importedCloudMarketplaces", result.marketplaces);
        setStateField("importedCloudPlugins", result.plugins);
        void refreshPendingCloudPluginChanges(result.plugins);
        return result.plugins;
      }
      const config = await readWorkspaceOpenworkConfigRecord();
      const cloudImports = readWorkspaceCloudImports(config);
      setStateField("importedCloudMarketplaces", cloudImports.marketplaces);
      setStateField("importedCloudPlugins", cloudImports.plugins);
      return cloudImports.plugins;
    } catch {
      setStateField("importedCloudMarketplaces", {});
      setStateField("importedCloudPlugins", {});
      setStateField("pendingCloudPluginChanges", {});
      return {};
    }
  };

  const persistImportedCloudMarketplaces = async (nextMarketplaces: Record<string, CloudImportedMarketplace>) => {
    const config = await readWorkspaceOpenworkConfigRecord();
    const cloudImports = readWorkspaceCloudImports(config);
    const nextCloudImports = {
      ...cloudImports,
      marketplaces: nextMarketplaces,
    };
    const nextConfig = withWorkspaceCloudImports(config, nextCloudImports);
    const persisted = await writeWorkspaceOpenworkConfigRecord(nextConfig);
    if (!persisted) {
      throw new Error("SeeWayWork 服务不可用，请重新连接后再管理已导入的公司扩展市场。");
    }
    setStateField("importedCloudMarketplaces", nextMarketplaces);
    void refreshPendingCloudPluginChanges();
  };

  const persistImportedCloudSkills = async (nextSkills: Record<string, CloudImportedSkill>) => {
    const config = await readWorkspaceOpenworkConfigRecord();
    const cloudImports = readWorkspaceCloudImports(config);
    const nextConfig = withWorkspaceCloudImports(config, {
      ...cloudImports,
      skills: nextSkills,
    });
    const persisted = await writeWorkspaceOpenworkConfigRecord(nextConfig);
    if (!persisted) {
      throw new Error("SeeWayWork 服务不可用，请重新连接后再管理已导入的公司技能。");
    }
    setStateField("importedCloudSkills", nextSkills);
  };

  const persistImportedCloudPlugins = async (nextPlugins: Record<string, CloudImportedPlugin>) => {
    const config = await readWorkspaceOpenworkConfigRecord();
    const cloudImports = readWorkspaceCloudImports(config);
    const nextCloudImports = {
      ...cloudImports,
      plugins: nextPlugins,
    };
    const nextConfig = withWorkspaceCloudImports(config, nextCloudImports);
    const persisted = await writeWorkspaceOpenworkConfigRecord(nextConfig);
    if (!persisted) {
      throw new Error("SeeWayWork 服务不可用，请重新连接后再管理已导入的公司插件。");
    }
    setStateField("importedCloudPlugins", nextPlugins);
    void refreshPendingCloudPluginChanges(nextPlugins);
  };

  const findCloudMarketplace = (marketplaceId: string) =>
    snapshot.cloudOrgMarketplaces.find((entry) => entry.marketplace.id === marketplaceId)?.marketplace ?? null;

  const buildCloudSkillContent = (name: string, description: string, body: string) => {
    const safeDescription = description.replace(/\s+/g, " ").trim();
    const normalizedBody = body.replace(/^\s*\n?/, "");
    return [
      "---",
      `name: ${JSON.stringify(name)}`,
      `description: ${JSON.stringify(safeDescription)}`,
      "---",
      "",
      normalizedBody,
    ].join("\n");
  };

  const upsertWorkspaceSkill = async (
    name: string,
    content: string,
    description: string,
    optionsOverride?: { overwrite?: boolean },
  ) => {
    const isRemoteWorkspace = options.workspaceType() === "remote";
    const isLocalWorkspace = options.workspaceType() === "local";
    const root = options.selectedWorkspaceRoot().trim();
    const { openworkSnapshot, openworkClient, openworkWorkspaceId, hasOpenworkTarget } =
      await resolveWorkspaceServerTarget();
    const canUseOpenworkServer =
      hasOpenworkTarget &&
      openworkSnapshot.openworkServerCapabilities?.skills?.write !== false;

    if (canUseOpenworkServer && openworkClient && openworkWorkspaceId) {
      await openworkClient.upsertSkill(openworkWorkspaceId, {
        name,
        content,
        description,
      });
      return;
    }

    if (hasOpenworkTarget) {
      throw new Error("SeeWayWork 服务无法修改当前工作区的技能。");
    }

    if (isRemoteWorkspace) {
      throw new Error("SeeWayWork 服务不可用，请重新连接后再导入技能。");
    }

    if (!isDesktopRuntime()) {
      throw new Error(t("skills.desktop_required"));
    }

    if (!isLocalWorkspace || !root) {
      throw new Error(t("skills.pick_workspace_first"));
    }

    const result = (await installSkillTemplate(root, name, content, {
      overwrite: optionsOverride?.overwrite ?? false,
    })) as { ok: boolean; stderr?: string; stdout?: string };
    if (!result.ok) {
      throw new Error(toChineseUserMessage(
        result.stderr || result.stdout,
        t("skills.install_failed"),
      ));
    }
  };

  const findImportedCloudSkill = (cloudSkillId: string) => snapshot.importedCloudSkills[cloudSkillId] ?? null;

  const persistImportedCloudSkillRecord = async (skill: DenOrgSkillCard, installedName: string) => {
    const imported = findImportedCloudSkill(skill.id);
    const nextSkills = {
      ...snapshot.importedCloudSkills,
      [skill.id]: {
        cloudSkillId: skill.id,
        installedName,
        title: skill.title,
        description: skill.description,
        shared: skill.shared,
        bundleHash: skill.bundleHash,
        updatedAt: skill.updatedAt,
        importedAt: imported?.importedAt ?? Date.now(),
      },
    } satisfies Record<string, CloudImportedSkill>;
    await persistImportedCloudSkills(nextSkills);
    return nextSkills[skill.id];
  };

  const deleteWorkspaceSkill = async (target: SkillTarget) => {
    const { name, source } = normalizeSkillTarget(target);
    if (source === "desktop-global") {
      if (!isDesktopRuntime()) throw new Error(t("skills.desktop_required"));
      const result = await uninstallGlobalSkill(name);
      if (!result.ok) {
        throw new Error(toChineseUserMessage(result.stderr || result.stdout, t("skills.uninstall_failed")));
      }
      return;
    }
    const isRemoteWorkspace = options.workspaceType() === "remote";
    const isLocalWorkspace = options.workspaceType() === "local";
    const root = options.selectedWorkspaceRoot().trim();
    const { openworkSnapshot, openworkClient, openworkWorkspaceId, hasOpenworkTarget } =
      await resolveWorkspaceServerTarget();
    const canUseOpenworkServer =
      hasOpenworkTarget &&
      openworkSnapshot.openworkServerCapabilities?.skills?.write !== false;

    if (canUseOpenworkServer && openworkClient && openworkWorkspaceId) {
      await openworkClient.deleteSkill(openworkWorkspaceId, name);
      return;
    }

    if (hasOpenworkTarget) {
      throw new Error("SeeWayWork 服务无法移除当前工作区的技能。");
    }

    if (isRemoteWorkspace) {
      throw new Error("SeeWayWork 服务不可用，请重新连接后再移除技能。");
    }

    if (!isDesktopRuntime()) {
      throw new Error(t("skills.desktop_required"));
    }

    if (!isLocalWorkspace || !root) {
      throw new Error(t("skills.pick_workspace_first"));
    }

    const result = (await uninstallSkillCommand(root, name)) as { ok: boolean; stderr?: string; stdout?: string };
    if (!result.ok) {
      throw new Error(toChineseUserMessage(
        result.stderr || result.stdout,
        t("skills.uninstall_failed"),
      ));
    }
  };

  const reconcileCompanySkillAccess = async (
    availableSkills: readonly DenOrgSkillCard[],
    importedSkills: Record<string, CloudImportedSkill>,
  ) => {
    if (Object.keys(importedSkills).length === 0) return;

    const { openworkSnapshot, openworkClient, openworkWorkspaceId, hasOpenworkTarget } =
      await resolveWorkspaceServerTarget();
    const canReconcile =
      hasOpenworkTarget
      && openworkSnapshot.openworkServerCapabilities?.skills?.read !== false
      && openworkSnapshot.openworkServerCapabilities?.skills?.write !== false
      && openworkClient
      && openworkWorkspaceId;
    if (!canReconcile) {
      throw new Error("公司技能已发生变化，但 SeeWayWork 服务暂时无法同步当前工作区。请重新连接后重试。");
    }

    const result = await reconcileImportedCompanySkills({
      availableSkills,
      openworkClient,
      workspaceId: openworkWorkspaceId,
      includeGlobal: options.workspaceType() === "local",
    });
    setStateField("importedCloudSkills", result.importedSkills);
    for (const name of result.installed) {
      options.markReloadRequired?.("skills", { type: "skill", name, action: "added" });
    }
    for (const name of result.restored) {
      options.markReloadRequired?.("skills", { type: "skill", name, action: "added" });
    }
    for (const name of result.updated) {
      options.markReloadRequired?.("skills", { type: "skill", name, action: "updated" });
    }
    for (const name of result.removed) {
      options.markReloadRequired?.("skills", { type: "skill", name, action: "removed" });
    }
    if (result.installed.length || result.restored.length || result.updated.length || result.removed.length) {
      await refreshSkills({ force: true });
    }
    if (result.failed.length > 0) {
      setStateField(
        "cloudOrgSkillsStatus",
        `${result.failed.length} 个已安装的公司技能暂时无法同步，SeeWayWork 会在恢复连接后重试。`,
      );
    }
  };

  const slugifyConfigObjectName = (title: string, fallback: string) => {
    const slug = slugifyOpencodeSkillName(title || fallback);
    return slug === "skill" && fallback ? slugifyOpencodeSkillName(fallback) : slug;
  };

  const pluginNamespace = (pluginName: string, pluginId: string) => {
    const base = slugifyConfigObjectName(pluginName, pluginId);
    return `${base.replace(/-plugin$/, "")}-plugin`;
  };

  const normalizePluginSourcePath = (path: string, objectType: string, namespace: string) => {
    const parts = path.trim().replace(/^\/+/, "").split("/").filter(Boolean);
    if (parts.length === 0 || parts.some((part) => part === ".." || part === ".")) return "";

    const folderByType: Record<string, string> = {
      agent: "agents",
      command: "commands",
      context: "context",
      hook: "hooks",
      mcp: "mcps",
      skill: "skills",
      tool: "tools",
    };
    const folder = folderByType[objectType];
    if (!folder) return "";
    const opencodeIndex = parts.findIndex((part) => part === ".opencode");
    const searchParts = opencodeIndex >= 0 ? parts.slice(opencodeIndex + 1) : parts;
    const folderIndex = searchParts.findIndex((part) => part === folder);
    if (folderIndex < 0 || folderIndex === searchParts.length - 1) return "";
    const rest = searchParts.slice(folderIndex + 1);
    if (rest[0] === namespace) return [".opencode", folder, ...rest].join("/");
    return [".opencode", folder, namespace, ...rest].join("/");
  };

  const getPluginObjectInstallPath = (
    object: NonNullable<DenOrgPluginResolved["memberships"][number]["configObject"]>,
    namespace: string,
  ) => {
    const existing = normalizePluginSourcePath(object.currentRelativePath ?? "", object.objectType, namespace);
    if (existing) {
      if (object.objectType === "skill") {
        const parts = existing.split("/").filter(Boolean);
        const lastPart = parts.at(-1) ?? "";
        const skillName = /^SKILL\.md$/i.test(lastPart)
          ? parts.at(-2) ?? slugifyConfigObjectName(object.title, object.id)
          : lastPart || slugifyConfigObjectName(object.title, object.id);
        return `.opencode/skills/${namespace}/${skillName}/SKILL.md`;
      }
      return existing;
    }
    const name = slugifyConfigObjectName(object.title, object.id);
    switch (object.objectType) {
      case "skill":
        return `.opencode/skills/${namespace}/${name}/SKILL.md`;
      case "agent":
        return `.opencode/agents/${namespace}/${name}.md`;
      case "command":
        return `.opencode/commands/${namespace}/${name}.md`;
      case "mcp":
        return `.opencode/mcps/${namespace}/${name}.json`;
      case "hook":
        return `.opencode/hooks/${namespace}/${name}.json`;
      case "tool":
        return `.opencode/tools/${namespace}/${name}.ts`;
      case "context":
        return `.opencode/context/${namespace}/${name}.md`;
      default:
        return `.opencode/plugins/${namespace}/${name}.txt`;
    }
  };

  const pluginMcpName = (rawName: string, namespace: string, fallback: string, namespaceName: boolean) => {
    const trimmed = rawName.trim();
    const base = OPENCODE_MCP_NAME_RE.test(trimmed)
      ? trimmed
      : slugifyConfigObjectName(trimmed || fallback, fallback);
    if (!namespaceName) return base;
    const namespaced = base.startsWith(`${namespace}-`) ? base : `${namespace}-${base}`;
    return OPENCODE_MCP_NAME_RE.test(namespaced)
      ? namespaced
      : slugifyConfigObjectName(namespaced, fallback);
  };

  const mcpCommandFromConfig = (config: Record<string, unknown>) => {
    if (Array.isArray(config.command)) return readStringArray(config.command);
    const command = readNonEmptyString(config.command);
    if (!command) return [];
    return [command, ...readStringArray(config.args)];
  };

  const normalizePluginMcpConfig = (input: unknown): Record<string, unknown> | null => {
    if (!isRecord(input)) return null;
    const enabled = typeof input.enabled === "boolean"
      ? input.enabled
      : typeof input.disabled === "boolean"
        ? !input.disabled
        : true;
    const url = readNonEmptyString(input.url);
    if (url) {
      const config: Record<string, unknown> = { type: "remote", url, enabled };
      const headers = readStringRecord(input.headers);
      if (headers) config.headers = headers;
      if (isRecord(input.oauth)) config.oauth = input.oauth;
      if (input.oauth === true) config.oauth = {};
      return config;
    }

    const command = mcpCommandFromConfig(input);
    if (command.length > 0) {
      const config: Record<string, unknown> = { type: "local", command, enabled };
      const environment = readStringRecord(input.environment) ?? readStringRecord(input.env);
      if (environment) config.environment = environment;
      return config;
    }

    return null;
  };

  const pluginMcpConfigsFromPayload = (
    object: NonNullable<DenOrgPluginResolved["memberships"][number]["configObject"]>,
    namespace: string,
  ) => {
    const version = object.latestVersion;
    const payload = version?.normalizedPayloadJson ?? parseJsonRecord(version?.rawSourceText ?? null);
    if (!payload) return [];

    const configs = new Map<string, { name: string; config: Record<string, unknown>; path: string }>();
    const addConfig = (rawName: string, rawConfig: unknown, namespaceName: boolean) => {
      const config = normalizePluginMcpConfig(rawConfig);
      if (!config) return;
      const name = pluginMcpName(rawName, namespace, object.id, namespaceName);
      configs.set(name, {
        name,
        config,
        path: `${OPENCODE_MCP_IMPORT_PATH_PREFIX}${name}`,
      });
    };

    if (isRecord(payload.mcp)) {
      for (const [name, config] of Object.entries(payload.mcp)) addConfig(name, config, false);
    }
    if (isRecord(payload.mcpServers)) {
      for (const [name, config] of Object.entries(payload.mcpServers)) addConfig(name, config, false);
    }
    if (configs.size === 0) addConfig(object.title, payload, true);

    return [...configs.values()];
  };

  const mcpNoConfigWarning = (title: string) =>
    `MCP component "${title}" could not be installed: no server config with a "url" or "command" was found.`;

  const mcpInactiveWarning = (title: string) =>
    `MCP component "${title}" could not be installed because it is not active.`;

  const cloudPluginImportMessage = (pluginName: string, fileCount: number, warnings: string[]) => {
    const message = `Imported ${pluginName} with ${fileCount} file${fileCount === 1 ? "" : "s"}.`;
    return warnings.length > 0 ? `${message} ${warnings.join(" ")}` : message;
  };

  const externalMcpConnectionIdFromPayload = (
    object: NonNullable<DenOrgPluginResolved["memberships"][number]["configObject"]>,
  ): string | null => {
    const version = object.latestVersion;
    const payload = version?.normalizedPayloadJson ?? parseJsonRecord(version?.rawSourceText ?? null);
    if (!payload) return null;
    if (payload.openworkManaged === "den_external_mcp") {
      const id = readNonEmptyString(payload.externalMcpConnectionId);
      if (id) return id;
    }
    const containers = [
      isRecord(payload.mcpServers) ? payload.mcpServers : null,
      isRecord(payload.mcp) ? payload.mcp : null,
    ].filter((entry): entry is Record<string, unknown> => Boolean(entry));
    for (const container of containers) {
      for (const config of Object.values(container)) {
        if (!isRecord(config) || config.openworkManaged !== "den_external_mcp") continue;
        const id = readNonEmptyString(config.externalMcpConnectionId);
        if (id) return id;
      }
    }
    return null;
  };

  const denSkillIdFromPayload = (
    object: NonNullable<DenOrgPluginResolved["memberships"][number]["configObject"]>,
  ): string | null => {
    const version = object.latestVersion;
    const payload = version?.normalizedPayloadJson ?? parseJsonRecord(version?.rawSourceText ?? null);
    if (!payload || payload.openworkManaged !== "den_skill") return null;
    return readNonEmptyString(payload.denSkillId);
  };

  const upsertPluginMcpConfig = async (name: string, config: Record<string, unknown>) => {
    const openworkSnapshot = getOpenworkServerSnapshot();
    const openworkClient = openworkSnapshot.openworkServerClient;
    const openworkWorkspaceId = options.runtimeWorkspaceId();
    if (
      openworkSnapshot.openworkServerStatus === "connected" &&
      openworkClient &&
      openworkWorkspaceId &&
      openworkSnapshot.openworkServerCapabilities?.mcp?.write
    ) {
      await openworkClient.addMcp(openworkWorkspaceId, { name, config });
      return;
    }
    throw new Error("SeeWayWork 服务不可用，请重新连接后再向当前工作区导入 MCP 服务。");
  };

  const deletePluginMcpConfig = async (name: string) => {
    const openworkSnapshot = getOpenworkServerSnapshot();
    const openworkClient = openworkSnapshot.openworkServerClient;
    const openworkWorkspaceId = options.runtimeWorkspaceId();
    if (
      openworkSnapshot.openworkServerStatus === "connected" &&
      openworkClient &&
      openworkWorkspaceId &&
      openworkSnapshot.openworkServerCapabilities?.mcp?.write
    ) {
      await openworkClient.removeMcp(openworkWorkspaceId, name);
      return;
    }
    throw new Error("SeeWayWork 服务不可用，请重新连接后再从当前工作区移除已导入的 MCP 服务。");
  };

  const pluginReloadReason = (objectType: string): ReloadReason => {
    switch (objectType) {
      case "skill":
        return "skills";
      case "agent":
        return "agents";
      case "command":
        return "commands";
      case "mcp":
        return "mcp";
      default:
        return "config";
    }
  };

  const writePluginWorkspaceFile = async (path: string, content: string) => {
    const { openworkSnapshot, openworkClient, openworkWorkspaceId, hasOpenworkTarget } =
      await resolveWorkspaceServerTarget();
    if (
      hasOpenworkTarget &&
      openworkClient &&
      openworkWorkspaceId &&
      openworkSnapshot.openworkServerCapabilities?.config?.write !== false &&
      typeof openworkClient.writeWorkspaceFile === "function"
    ) {
      await openworkClient.writeWorkspaceFile(openworkWorkspaceId, { path, content, force: true });
      return;
    }
    throw new Error("SeeWayWork 服务不可用，请重新连接后再向当前工作区导入插件文件。");
  };

  const deletePluginWorkspaceFiles = async (files: Array<{ path: string; recursive?: boolean }>) => {
    if (files.length === 0) return;
    const { openworkSnapshot, openworkClient, openworkWorkspaceId, hasOpenworkTarget } =
      await resolveWorkspaceServerTarget();
    if (
      hasOpenworkTarget &&
      openworkClient &&
      openworkWorkspaceId &&
      openworkSnapshot.openworkServerCapabilities?.config?.write !== false &&
      typeof openworkClient.deleteWorkspaceFiles === "function"
    ) {
      const results = await openworkClient.deleteWorkspaceFiles(openworkWorkspaceId, files);
      const failed = results.filter((result) => !result.ok && result.code !== "file_not_found");
      if (failed.length > 0) {
        throw new Error(
          `Failed to remove ${failed.length} imported plugin file${failed.length === 1 ? "" : "s"} from the workspace.`,
        );
      }
      return;
    }
    throw new Error("SeeWayWork 服务不可用，请重新连接后再从当前工作区移除已导入的插件文件。");
  };

  const applyCloudOrgPluginImport = async (
    marketplaceId: string | null,
    resolved: DenOrgPluginResolved,
  ): Promise<{ files: CloudImportedPluginFile[]; warnings: string[] }> => {
    const files: CloudImportedPluginFile[] = [];
    const warnings: string[] = [];
    const existing = snapshot.importedCloudPlugins[resolved.plugin.id];
    const namespace = pluginNamespace(resolved.plugin.name, resolved.plugin.id);

    for (const membership of resolved.memberships) {
      const object = membership.configObject;
      const version = object?.latestVersion ?? null;
      if (!object) continue;
      if (object.status !== "active") {
        if (object.objectType === "mcp") warnings.push(mcpInactiveWarning(object.title));
        continue;
      }

      if (object.objectType === "mcp") {
        const externalMcpConnectionId = externalMcpConnectionIdFromPayload(object);
        if (externalMcpConnectionId) {
          files.push({
            configObjectId: object.id,
            externalMcpConnectionId,
            versionId: version?.id ?? null,
            objectType: object.objectType,
            title: object.title,
            path: `den#mcp-connection.${externalMcpConnectionId}`,
            updatedAt: object.updatedAt,
          });
          continue;
        }
        const configs = pluginMcpConfigsFromPayload(object, namespace);
        if (configs.length === 0) warnings.push(mcpNoConfigWarning(object.title));
        for (const config of configs) {
          await upsertPluginMcpConfig(config.name, config.config);
          files.push({
            configObjectId: object.id,
            versionId: version?.id ?? null,
            objectType: object.objectType,
            title: object.title,
            path: config.path,
            updatedAt: object.updatedAt,
          });
          options.markReloadRequired?.("mcp", {
            type: "mcp",
            name: config.name,
            action: existing ? "updated" : "added",
          });
        }
        continue;
      }

      if (object.objectType === "skill") {
        const denSkillId = denSkillIdFromPayload(object);
        if (denSkillId) {
          files.push({
            configObjectId: object.id,
            denSkillId,
            versionId: version?.id ?? null,
            objectType: object.objectType,
            title: object.title,
            path: `den#skill.${denSkillId}`,
            updatedAt: object.updatedAt,
          });
          continue;
        }
      }

      if (version?.rawSourceText == null) continue;

      const path = getPluginObjectInstallPath(object, namespace);
      let content = version.rawSourceText;
      const rawDesc = (object.description?.trim() || object.title).trim();
      const description = rawDesc.slice(0, 1024) || object.title.slice(0, 1024);
      if (object.objectType === "skill") {
        const installName = path.match(/^\.opencode\/skills\/[^/]+\/([^/]+)\/SKILL\.md$/)?.[1] ?? slugifyConfigObjectName(object.title, object.id);
        content = buildCloudSkillContent(installName, description || "Skill", extractSkillBodyMarkdown(content));
      } else if (object.objectType === "agent") {
        content = buildCloudAgentContent(description, content);
      } else if (object.objectType === "command") {
        const fileName = path.match(/\/([^/]+)\.md$/)?.[1] ?? object.title;
        content = buildCloudCommandContent(slugifyConfigObjectName(fileName, object.id), description, content);
      }
      await writePluginWorkspaceFile(path, content);

      files.push({
        configObjectId: object.id,
        versionId: version.id,
        objectType: object.objectType,
        title: object.title,
        path,
        updatedAt: object.updatedAt,
      });
      options.markReloadRequired?.(pluginReloadReason(object.objectType), {
        type:
          object.objectType === "skill" || object.objectType === "agent" || object.objectType === "command"
            ? object.objectType
            : "config",
        name: object.title,
        action: existing ? "updated" : "added",
      });
    }

    const nextPaths = new Set(files.map((file) => file.path));
    const removedMcpNames = (existing?.files ?? []).flatMap((file) => {
      const name = file.objectType === "mcp" && !nextPaths.has(file.path)
        ? cloudPluginMcpNameFromPath(file.path)
        : null;
      return name ? [name] : [];
    });
    await Promise.all(removedMcpNames.map((name) => deletePluginMcpConfig(name)));

    const nextPlugins = {
      ...snapshot.importedCloudPlugins,
      [resolved.plugin.id]: {
        pluginId: resolved.plugin.id,
        marketplaceId,
        name: resolved.plugin.name,
        description: resolved.plugin.description,
        updatedAt: resolved.plugin.updatedAt,
        files,
        importedAt: existing?.importedAt ?? Date.now(),
      },
    } satisfies Record<string, CloudImportedPlugin>;
    await persistImportedCloudPlugins(nextPlugins);

    if (marketplaceId) {
      const marketplace = findCloudMarketplace(marketplaceId);
      const existingMarketplace = snapshot.importedCloudMarketplaces[marketplaceId] ?? null;
      const pluginIds = new Set(existingMarketplace?.pluginIds ?? []);
      pluginIds.add(resolved.plugin.id);
      await persistImportedCloudMarketplaces({
        ...snapshot.importedCloudMarketplaces,
        [marketplaceId]: {
          marketplaceId,
          name: marketplace?.name ?? existingMarketplace?.name ?? marketplaceId,
          updatedAt: marketplace?.updatedAt ?? existingMarketplace?.updatedAt ?? null,
          pluginIds: [...pluginIds].toSorted(),
          importedAt: existingMarketplace?.importedAt ?? Date.now(),
        },
      });
    }

    return { files, warnings };
  };

  const invalidateWorkspaceCaches = () => {
    skillsLoaded = false;
    hubSkillsLoaded = false;
    cloudOrgSkillsLoaded = false;
    cloudOrgMarketplacesLoaded = false;
    skillsRoot = "";
    hubSkillsLoadKey = "";
    cloudOrgSkillsLoadKey = "";
    cloudOrgMarketplacesLoadKey = "";
  };

  const getCurrentCloudOrgLoadKey = () => {
    const orgId = readDenSettings().activeOrgId?.trim() ?? "";
    return `${getWorkspaceContextKey()}::${orgId}`;
  };

  const touch = () => {
    refreshSnapshot();
    emitChange();
  };

  async function refreshHubSkills(optionsOverride?: { force?: boolean; query?: string }) {
    const settings = readDenSettings();
    const token = settings.authToken?.trim() ?? "";
    const orgId = settings.activeOrgId?.trim() ?? "";
    const query = optionsOverride?.query?.trim() ?? "";
    const effectiveQuery = query.length >= 2 ? query : "";
    const loadKey = `${getWorkspaceContextKey()}::${orgId}::${effectiveQuery}`;

    if (loadKey !== hubSkillsLoadKey) {
      hubSkillsLoaded = false;
    }

    if (!optionsOverride?.force && hubSkillsLoaded) return;
    const requestId = ++refreshHubSkillsRequestId;
    refreshHubSkillsInFlight = true;
    refreshHubSkillsAborted = false;

    try {
      setStateField("hubSkillsStatus", null);

      if (!token || !orgId) {
        mutateState((current) => ({
          ...current,
          hubSkills: [],
          hubSkillsStatus: "登录公司账号后即可浏览和安装在线技能。",
          hubSkillsContextKey: getWorkspaceContextKey(),
        }));
        hubSkillsLoaded = true;
        hubSkillsLoadKey = loadKey;
        return;
      }

      const client = createDenClient({ baseUrl: settings.baseUrl, token });
      const response = await client.listSkillsCatalog(orgId, {
        query: effectiveQuery || undefined,
        view: "trending",
        perPage: 50,
      });
      if (
        refreshHubSkillsAborted
        || requestId !== refreshHubSkillsRequestId
        || loadKey !== `${getWorkspaceContextKey()}::${readDenSettings().activeOrgId?.trim() ?? ""}::${effectiveQuery}`
      ) {
        return;
      }
      mutateState((current) => ({
        ...current,
        hubSkills: response.items,
        hubSkillsStatus: response.items.length ? null : "没有找到符合条件的在线技能。",
        hubSkillsContextKey: getWorkspaceContextKey(),
      }));
      hubSkillsLoaded = true;
      hubSkillsLoadKey = loadKey;
    } catch (error) {
      if (refreshHubSkillsAborted || requestId !== refreshHubSkillsRequestId) return;
      mutateState((current) => ({
        ...current,
        hubSkills: [],
        hubSkillsStatus: toChineseUserMessage(error, "无法加载在线技能，请稍后重试。"),
      }));
    } finally {
      if (requestId === refreshHubSkillsRequestId) refreshHubSkillsInFlight = false;
    }
  }

  async function refreshCloudOrgSkills(optionsOverride?: { force?: boolean }) {
    const wk = getWorkspaceContextKey();
    const settings = readDenSettings();
    const token = settings.authToken?.trim() ?? "";
    const orgId = settings.activeOrgId?.trim() ?? "";
    const loadKey = `${wk}::${orgId}`;

    if (loadKey !== cloudOrgSkillsLoadKey) {
      cloudOrgSkillsLoaded = false;
    }

    if (!optionsOverride?.force && cloudOrgSkillsLoaded) {
      await refreshImportedCloudSkills();
      return;
    }
    if (refreshCloudOrgSkillsInFlight && refreshCloudOrgSkillsInFlightKey === loadKey) return;

    refreshCloudOrgSkillsInFlight = true;
    refreshCloudOrgSkillsInFlightKey = loadKey;
    refreshCloudOrgSkillsAborted = false;

    try {
      setStateField("cloudOrgSkillsStatus", null);

      if (!token || !orgId) {
        const importedSkills = await refreshImportedCloudSkills();
        await reconcileCompanySkillAccess([], importedSkills);
        mutateState((current) => ({
          ...current,
          cloudOrgSkills: [],
          cloudOrgSkillsStatus: null,
          cloudOrgSkillsContextKey: loadKey,
        }));
        cloudOrgSkillsLoaded = true;
        cloudOrgSkillsLoadKey = loadKey;
        return;
      }

      const client = createDenClient({ baseUrl: settings.baseUrl, token });
      const catalog = await fetchDenOrgSkillsCatalog(client, orgId);
      if (refreshCloudOrgSkillsAborted || getCurrentCloudOrgLoadKey() !== loadKey) return;
      mutateState((current) => ({
        ...current,
        cloudOrgSkills: catalog,
        cloudOrgSkillsStatus: null,
        cloudOrgSkillsContextKey: loadKey,
      }));
      cloudOrgSkillsLoaded = true;
      cloudOrgSkillsLoadKey = loadKey;
      const importedSkills = await refreshImportedCloudSkills();
      await reconcileCompanySkillAccess(catalog, importedSkills);
    } catch (error) {
      if (refreshCloudOrgSkillsAborted || getCurrentCloudOrgLoadKey() !== loadKey) return;
      mutateState((current) => ({
        ...current,
        cloudOrgSkills: [],
        cloudOrgSkillsStatus: toChineseUserMessage(error, t("skills.cloud_org_load_failed")),
      }));
    } finally {
      if (refreshCloudOrgSkillsInFlightKey === loadKey) {
        refreshCloudOrgSkillsInFlight = false;
        refreshCloudOrgSkillsInFlightKey = "";
      }
    }
  }

  async function refreshCloudOrgMarketplaces(optionsOverride?: { force?: boolean }) {
    const wk = getWorkspaceContextKey();
    const settings = readDenSettings();
    const token = settings.authToken?.trim() ?? "";
    const orgId = settings.activeOrgId?.trim() ?? "";
    const loadKey = `${wk}::${orgId}`;

    if (loadKey !== cloudOrgMarketplacesLoadKey) {
      cloudOrgMarketplacesLoaded = false;
    }

    if (!optionsOverride?.force && cloudOrgMarketplacesLoaded) {
      await refreshImportedCloudPlugins();
      return;
    }
    if (refreshCloudOrgMarketplacesInFlight && refreshCloudOrgMarketplacesInFlightKey === loadKey) return;

    refreshCloudOrgMarketplacesInFlight = true;
    refreshCloudOrgMarketplacesInFlightKey = loadKey;
    refreshCloudOrgMarketplacesAborted = false;

    try {
      setStateField("cloudOrgMarketplacesStatus", null);

      if (!token || !orgId) {
        mutateState((current) => ({
          ...current,
          cloudOrgMarketplaces: [],
          cloudOrgMarketplacesStatus: null,
        }));
        cloudOrgMarketplacesLoaded = true;
        cloudOrgMarketplacesLoadKey = loadKey;
        await refreshImportedCloudPlugins();
        return;
      }

      const client = createDenClient({ baseUrl: settings.baseUrl, token });
      const marketplaces = await client.listOrgMarketplaces(orgId);
      const resolved = await Promise.all(
        marketplaces.map((marketplace) => client.getOrgMarketplaceResolved(orgId, marketplace.id)),
      );
      if (refreshCloudOrgMarketplacesAborted || getCurrentCloudOrgLoadKey() !== loadKey) return;
      mutateState((current) => ({
        ...current,
        cloudOrgMarketplaces: resolved,
        cloudOrgMarketplacesStatus: null,
      }));

      // 首次加载只记录已有插件，后续新增插件才提醒员工。
      const allPluginIds = new Set<string>();
      for (const marketplace of resolved) {
        for (const plugin of marketplace.plugins ?? []) {
          if (plugin.id) allPluginIds.add(plugin.id);
        }
      }
      if (seenMarketplacePluginIds.size === 0) {
        // 首次加载不发送通知。
        for (const id of allPluginIds) seenMarketplacePluginIds.add(id);
      } else {
        for (const marketplace of resolved) {
          const marketplaceName = marketplace.marketplace?.name ?? "公司扩展市场";
          for (const plugin of marketplace.plugins ?? []) {
            if (plugin.id && !seenMarketplacePluginIds.has(plugin.id)) {
              seenMarketplacePluginIds.add(plugin.id);
              notifyEvent({
                kind: "cloud",
                severity: "info",
                title: "有新的公司扩展",
                body: `${plugin.name ?? plugin.id} 已加入 ${marketplaceName}`,
                dedupeKey: `new-marketplace-plugin:${plugin.id}`,
                action: { type: "open-extensions-marketplace", pluginName: plugin.name ?? plugin.id },
                actionLabel: "前往扩展市场查看",
              });
            }
          }
        }
      }

      cloudOrgMarketplacesLoaded = true;
      cloudOrgMarketplacesLoadKey = loadKey;
      await refreshImportedCloudPlugins();
    } catch (error) {
      if (refreshCloudOrgMarketplacesAborted || getCurrentCloudOrgLoadKey() !== loadKey) return;
      mutateState((current) => ({
        ...current,
        cloudOrgMarketplaces: [],
        cloudOrgMarketplacesStatus: toChineseUserMessage(
          error,
          "无法加载公司扩展市场，请稍后重试。",
        ),
      }));
    } finally {
      if (refreshCloudOrgMarketplacesInFlightKey === loadKey) {
        refreshCloudOrgMarketplacesInFlight = false;
        refreshCloudOrgMarketplacesInFlightKey = "";
      }
    }
  }

  async function importCloudOrgPlugin(
    marketplaceId: string | null,
    plugin: DenOrgPlugin,
  ): Promise<{ ok: boolean; message: string; warnings: string[]; files: CloudImportedPluginFile[] }> {
    options.setBusy(true);
    options.setError(null);
    setStateField("cloudOrgMarketplacesStatus", null);

    try {
      const settings = readDenSettings();
      const token = settings.authToken?.trim() ?? "";
      const orgId = settings.activeOrgId?.trim() ?? "";
      if (!token || !orgId) throw new Error("请先登录公司账号并选择公司。");
      const client = createDenClient({ baseUrl: settings.baseUrl, token });
      const resolved = await client.getOrgPluginResolved(orgId, plugin);
      const target = await resolveWorkspaceServerTarget();
      if (target.openworkClient && target.openworkWorkspaceId) {
        const marketplace = marketplaceId ? findCloudMarketplace(marketplaceId) : null;
        const result = await target.openworkClient.installCloudPlugin(target.openworkWorkspaceId, {
          marketplaceId,
          marketplace,
          resolved,
        });
        await refreshSkills({ force: true });
        await refreshCloudOrgMarketplaces({ force: true });
        void refreshPendingCloudPluginChanges();
        return {
          ok: true,
          message: cloudPluginImportMessage(plugin.name, result.item.files.length, result.warnings),
          warnings: result.warnings,
          files: result.item.files,
        };
      }
      const result = await applyCloudOrgPluginImport(marketplaceId, resolved);
      await refreshSkills({ force: true });
      await refreshCloudOrgMarketplaces({ force: true });
      return {
        ok: true,
        message: cloudPluginImportMessage(plugin.name, result.files.length, result.warnings),
        warnings: result.warnings,
        files: result.files,
      };
    } catch (error) {
      const message = toChineseUserMessage(
        addOpencodeCacheHint(error instanceof Error ? error.message : ""),
        t("skills.unknown_error"),
      );
      options.setError(addOpencodeCacheHint(message));
      return { ok: false, message, warnings: [], files: [] };
    } finally {
      options.setBusy(false);
    }
  }

  async function previewClaudePlugin(url: string): Promise<OpenworkClaudePluginPreview> {
    const target = await resolveWorkspaceServerTarget();
    if (!target.openworkClient || !target.openworkWorkspaceId) {
      throw new Error("SeeWayWork 服务不可用，请重新连接后再从 GitHub 安装插件。");
    }
    const result = await target.openworkClient.previewClaudePlugin(target.openworkWorkspaceId, { url });
    return result.preview;
  }

  async function installClaudePlugin(url: string): Promise<{ ok: boolean; message: string }> {
    options.setBusy(true);
    options.setError(null);
    try {
      const target = await resolveWorkspaceServerTarget();
      if (!target.openworkClient || !target.openworkWorkspaceId) {
        throw new Error("SeeWayWork 服务不可用，请重新连接后再从 GitHub 安装插件。");
      }
      const result = await target.openworkClient.installClaudePlugin(target.openworkWorkspaceId, { url });
      await refreshSkills({ force: true });
      await refreshImportedCloudPlugins();
      return {
        ok: true,
        message: `已安装 ${result.item.name}，包含 ${result.item.files.length} 个组件。`,
      };
    } catch (error) {
      const message = toChineseUserMessage(
        addOpencodeCacheHint(error instanceof Error ? error.message : ""),
        t("skills.unknown_error"),
      );
      options.setError(addOpencodeCacheHint(message));
      return { ok: false, message };
    } finally {
      options.setBusy(false);
    }
  }

  async function removeCloudOrgPlugin(pluginId: string): Promise<{ ok: boolean; message: string }> {
    options.setBusy(true);
    options.setError(null);
    setStateField("cloudOrgMarketplacesStatus", null);

    try {
      const target = await resolveWorkspaceServerTarget();
      if (target.openworkClient && target.openworkWorkspaceId) {
        const result = await target.openworkClient.removeCloudPlugin(target.openworkWorkspaceId, pluginId);
        await refreshSkills({ force: true });
        await refreshCloudOrgMarketplaces({ force: true });
        void refreshPendingCloudPluginChanges();
        return {
          ok: true,
          message: `已移除 ${result.item.name}。`,
        };
      }

      const imported = snapshot.importedCloudPlugins[pluginId];
      if (!imported) throw new Error("当前工作区尚未安装这个扩展。");

      const removedMcpNames: string[] = [];
      const fileDeletes: Array<{ path: string; recursive?: boolean }> = [];
      for (const file of imported.files) {
        const mcpName = file.objectType === "mcp" ? cloudPluginMcpNameFromPath(file.path) : null;
        if (mcpName) {
          removedMcpNames.push(mcpName);
          continue;
        }
        if (!file.path.startsWith(".opencode/")) continue;
        const skillDir = file.path.match(/^(\.opencode\/skills\/[^/]+\/[^/]+)\/SKILL\.md$/)?.[1];
        fileDeletes.push(skillDir ? { path: skillDir, recursive: true } : { path: file.path });
      }
      await Promise.all(removedMcpNames.map((name) => deletePluginMcpConfig(name)));
      await deletePluginWorkspaceFiles(fileDeletes);

      const nextPlugins = { ...snapshot.importedCloudPlugins };
      delete nextPlugins[pluginId];
      await persistImportedCloudPlugins(nextPlugins);

      if (removedMcpNames.length > 0) {
        options.markReloadRequired?.("mcp", { type: "mcp", name: imported.name, action: "removed" });
      }
      if (fileDeletes.length > 0) {
        options.markReloadRequired?.("config", { type: "config", name: imported.name, action: "removed" });
      }
      await Promise.all([
        refreshSkills({ force: true }),
        refreshCloudOrgMarketplaces({ force: true }),
      ]);

      return { ok: true, message: `已移除 ${imported.name}。` };
    } catch (error) {
      const message = toChineseUserMessage(
        addOpencodeCacheHint(error instanceof Error ? error.message : ""),
        t("skills.unknown_error"),
      );
      options.setError(addOpencodeCacheHint(message));
      return { ok: false, message };
    } finally {
      options.setBusy(false);
    }
  }

  async function installHubSkill(skill: HubSkillCard): Promise<{ ok: boolean; message: string }> {
    const isRemoteWorkspace = options.workspaceType() === "remote";
    const { openworkSnapshot, openworkClient, openworkWorkspaceId, hasOpenworkTarget } =
      await resolveWorkspaceServerTarget();
    const canUseOpenworkServer =
      hasOpenworkTarget &&
      openworkSnapshot.openworkServerCapabilities?.skills?.write !== false;

    if (!canUseOpenworkServer) {
      if (isRemoteWorkspace) return { ok: false, message: "SeeWayWork 服务不可用，请重新连接后再安装技能。" };
      return { ok: false, message: "请先连接 SeeWayWork 服务，再从技能中心安装。" };
    }

    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", null);

    try {
      if (!openworkClient || !openworkWorkspaceId) return { ok: false, message: "请先连接 SeeWayWork 服务，再从技能中心安装。" };
      const settings = readDenSettings();
      const token = settings.authToken?.trim() ?? "";
      const orgId = settings.activeOrgId?.trim() ?? "";
      if (!token || !orgId) return { ok: false, message: "请先登录公司账号，再安装在线技能。" };

      const client = createDenClient({ baseUrl: settings.baseUrl, token });
      const audit = await client.getSkillsCatalogAudit(orgId, skill.id);
      if (!audit.assessment.installable) {
        return { ok: false, message: audit.assessment.message };
      }
      const detail = await client.getSkillsCatalogDetail(orgId, skill.id);
      if (detail.id !== skill.id || detail.slug !== skill.slug) {
        return { ok: false, message: "在线技能身份校验失败，已停止安装。" };
      }
      const result = await openworkClient.installCatalogSkill(openworkWorkspaceId, skill.slug, {
        sourceId: detail.id,
        sourceHash: detail.hash,
        bundleHash: detail.bundleHash,
        files: detail.files,
        overwrite: snapshot.skills.some((entry) => entry.name === skill.slug),
      });
      await Promise.all([refreshSkills({ force: true }), refreshHubSkills({ force: true })]);
      if (!result?.ok) return { ok: false, message: "安装失败，请稍后重试。" };
      const auditNotice = audit.assessment.verdict === "pass" ? "" : ` ${audit.assessment.message}`;
      return { ok: true, message: `已安装 ${skill.name}。${auditNotice}`.trim() };
    } catch (error) {
      const message = toChineseUserMessage(
        addOpencodeCacheHint(error instanceof Error ? error.message : ""),
        t("skills.unknown_error"),
      );
      options.setError(addOpencodeCacheHint(message));
      return { ok: false, message };
    } finally {
      options.setBusy(false);
    }
  }

  async function installCloudOrgSkill(skill: DenOrgSkillCard): Promise<{ ok: boolean; message: string }> {
    const existingImport = findImportedCloudSkill(skill.id);
    const installedNames = new Set(snapshot.skills.map((entry) => entry.name));
    const preferredName = existingImport?.installedName?.trim() ?? "";
    if (preferredName) installedNames.delete(preferredName);
    const installName = resolveCompanySkillInstallName(skill, installedNames, preferredName);
    const action = existingImport ? "updated" : "added";

    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", null);

    try {
      const { openworkSnapshot, openworkClient, openworkWorkspaceId, hasOpenworkTarget } =
        await resolveWorkspaceServerTarget();
      const canInstallBundle =
        hasOpenworkTarget
        && openworkSnapshot.openworkServerCapabilities?.skills?.write !== false
        && openworkClient
        && openworkWorkspaceId;
      if (!canInstallBundle) {
        throw new Error("SeeWayWork 服务不可用，请重新连接后再安装公司技能。");
      }
      await openworkClient.installCatalogSkill(
        openworkWorkspaceId,
        installName,
        buildCompanySkillInstallPayload(skill, Boolean(existingImport)),
      );
      await persistImportedCloudSkillRecord(skill, installName);
      options.markReloadRequired?.("skills", { type: "skill", name: installName, action });
      await Promise.all([refreshSkills({ force: true }), refreshCloudOrgSkills({ force: true })]);
      return {
        ok: true,
        message: t(existingImport ? "skills.cloud_updated" : "skills.cloud_installed", { name: installName }),
      };
    } catch (error) {
      const message = toChineseUserMessage(
        addOpencodeCacheHint(error instanceof Error ? error.message : ""),
        t("skills.unknown_error"),
      );
      options.setError(addOpencodeCacheHint(message));
      return { ok: false, message };
    } finally {
      options.setBusy(false);
    }
  }

  async function syncCloudOrgSkill(skill: DenOrgSkillCard): Promise<{ ok: boolean; message: string }> {
    return installCloudOrgSkill(skill);
  }

  async function removeCloudOrgSkill(cloudSkillId: string): Promise<{ ok: boolean; message: string; removedName: string | null }> {
    const imported = findImportedCloudSkill(cloudSkillId);
    if (!imported) {
      return { ok: false, message: "当前工作区尚未安装这个公司技能。", removedName: null };
    }

    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", null);

    try {
      if (snapshot.skills.some((skill) => skill.name === imported.installedName)) {
        await deleteWorkspaceSkill(imported.installedName);
      }
      const nextImports = { ...snapshot.importedCloudSkills };
      delete nextImports[cloudSkillId];
      await persistImportedCloudSkills(nextImports);
      options.markReloadRequired?.("skills", { type: "skill", name: imported.installedName, action: "removed" });
      await Promise.all([refreshSkills({ force: true }), refreshCloudOrgSkills({ force: true })]);
      return {
        ok: true,
        message: t("skills.cloud_removed", { name: imported.installedName }),
        removedName: imported.installedName,
      };
    } catch (error) {
      const message = toChineseUserMessage(
        addOpencodeCacheHint(error instanceof Error ? error.message : ""),
        t("skills.unknown_error"),
      );
      options.setError(addOpencodeCacheHint(message));
      return { ok: false, message, removedName: null };
    } finally {
      options.setBusy(false);
    }
  }

  const isPluginInstalledByName = (pluginName: string, aliases: string[] = []) =>
    isPluginInstalled(snapshot.pluginList.map((entry) => entry.name), pluginName, aliases);

  const loadPluginsFromConfig = (config: OpencodeConfigFile | null) => {
    const nextPluginNames: string[] = [];
    let nextPluginStatus: string | null = null;
    loadPluginsFromConfigHelpers(
      config,
      (value) => {
        nextPluginNames.splice(0, nextPluginNames.length, ...applyStateAction(nextPluginNames, value));
      },
      (message) => {
        nextPluginStatus = message;
      },
    );
    mutateState((current) => ({
      ...current,
      pluginList: toConfigPluginListEntries(nextPluginNames),
      pluginStatus: nextPluginStatus,
    }));
  };

  async function refreshSkills(optionsOverride?: { force?: boolean }) {
    const root = options.selectedWorkspaceRoot().trim();
    const isLocalWorkspace = options.workspaceType() === "local";
    const { openworkSnapshot, openworkClient, openworkWorkspaceId, hasOpenworkTarget } =
      await resolveWorkspaceServerTarget();
    const canUseOpenworkServer =
      hasOpenworkTarget &&
      openworkSnapshot.openworkServerCapabilities?.skills?.read !== false;

    if (!root && !hasOpenworkTarget) {
      mutateState((current) => ({
        ...current,
        skills: [],
        skillsStatus: t("skills.pick_workspace_first"),
      }));
      return;
    }

    if (canUseOpenworkServer && openworkClient && openworkWorkspaceId) {
      const skillCacheKey = root || openworkWorkspaceId;
      if (skillCacheKey !== skillsRoot) skillsLoaded = false;
      if (!optionsOverride?.force && skillsLoaded) return;
      if (refreshSkillsInFlight) return;

      refreshSkillsInFlight = true;
      refreshSkillsAborted = false;
      try {
        setStateField("skillsStatus", null);
        const [workspaceResult, desktopGlobalResult] = await Promise.allSettled([
          openworkClient.listSkills(openworkWorkspaceId, {
            includeGlobal: isLocalWorkspace && !isDesktopRuntime(),
          }),
          isDesktopRuntime()
            ? listGlobalSkills()
            : Promise.resolve([]),
        ]);
        if (refreshSkillsAborted) return;
        if (workspaceResult.status === "rejected" && desktopGlobalResult.status === "rejected") {
          throw workspaceResult.reason;
        }
        const workspaceSkills: SkillCard[] = workspaceResult.status === "fulfilled" && Array.isArray(workspaceResult.value.items)
          ? workspaceResult.value.items.map((entry) => ({
              name: entry.name,
              description: entry.description,
              path: entry.path,
              trigger: entry.trigger,
              source: "workspace",
            }))
          : [];
        const desktopGlobalSkills: SkillCard[] = desktopGlobalResult.status === "fulfilled" && Array.isArray(desktopGlobalResult.value)
          ? desktopGlobalResult.value.map((entry) => ({
              name: entry.name,
              description: entry.description,
                path: entry.path,
                trigger: entry.trigger,
                source: "desktop-global",
              }))
          : [];
        const byName = new Map<string, SkillCard>();
        for (const skill of [...workspaceSkills, ...desktopGlobalSkills]) {
          if (!byName.has(skill.name)) byName.set(skill.name, skill);
        }
        const next = Array.from(byName.values()).toSorted((a, b) => a.name.localeCompare(b.name));
        mutateState((current) => ({
          ...current,
          skills: next,
          skillsStatus: next.length ? null : t("skills.no_skills_found"),
          skillsContextKey: getWorkspaceContextKey(),
        }));
        skillsLoaded = true;
        skillsRoot = skillCacheKey;
      } catch (error) {
        if (refreshSkillsAborted) return;
        mutateState((current) => ({
          ...current,
          skills: [],
          skillsStatus: toChineseUserMessage(error, t("skills.failed_to_load")),
        }));
      } finally {
        refreshSkillsInFlight = false;
      }
      return;
    }

    if (hasOpenworkTarget) {
      mutateState((current) => ({
        ...current,
        skills: [],
        skillsStatus: "SeeWayWork 服务无法读取当前工作区的技能。",
      }));
      return;
    }

    if (isLocalWorkspace && isDesktopRuntime()) {
      if (root !== skillsRoot) skillsLoaded = false;
      if (!optionsOverride?.force && skillsLoaded) return;
      if (refreshSkillsInFlight) return;

      refreshSkillsInFlight = true;
      refreshSkillsAborted = false;
      try {
        setStateField("skillsStatus", null);
        const local = await listLocalSkills(root);
        if (refreshSkillsAborted) return;
        const next: SkillCard[] = Array.isArray(local)
          ? local.map((entry) => ({
              name: entry.name,
              description: entry.description,
              path: entry.path,
              trigger: entry.trigger,
              source: entry.source,
            }))
          : [];
        mutateState((current) => ({
          ...current,
          skills: next,
          skillsStatus: next.length ? null : t("skills.no_skills_found"),
          skillsContextKey: getWorkspaceContextKey(),
        }));
        skillsLoaded = true;
        skillsRoot = root;
      } catch (error) {
        if (refreshSkillsAborted) return;
        mutateState((current) => ({
          ...current,
          skills: [],
          skillsStatus: toChineseUserMessage(error, t("skills.failed_to_load")),
        }));
      } finally {
        refreshSkillsInFlight = false;
      }
      return;
    }

    const client = options.client();
    if (!client) {
      mutateState((current) => ({
        ...current,
        skills: [],
        skillsStatus: "SeeWayWork 服务不可用，请重新连接后再加载技能。",
      }));
      return;
    }

    if (root !== skillsRoot) skillsLoaded = false;
    if (!optionsOverride?.force && skillsLoaded) return;
    if (refreshSkillsInFlight) return;

    refreshSkillsInFlight = true;
    refreshSkillsAborted = false;
    try {
      setStateField("skillsStatus", null);
      const rawClient = client as unknown as { _client?: { get: (input: { url: string }) => Promise<unknown> } };
      if (!rawClient._client) throw new Error("工作区运行环境暂时不可用。");
      const result = await rawClient._client.get({ url: "/skill" }) as {
        data?: Array<{ name: string; description: string; location: string }>;
        error?: unknown;
      };
      if (result?.data === undefined) {
        const err = result?.error;
        const message = err instanceof Error ? err.message : typeof err === "string" ? err : t("skills.failed_to_load");
        throw new Error(message);
      }
      if (refreshSkillsAborted) return;
      const next: SkillCard[] = Array.isArray(result.data)
        ? result.data.map((entry) => ({
            name: entry.name,
            description: entry.description,
            path: formatSkillPath(entry.location),
          }))
        : [];
      mutateState((current) => ({
        ...current,
        skills: next,
        skillsStatus: next.length ? null : t("skills.no_skills_found"),
        skillsContextKey: getWorkspaceContextKey(),
      }));
      skillsLoaded = true;
      skillsRoot = root;
    } catch (error) {
      if (refreshSkillsAborted) return;
      mutateState((current) => ({
        ...current,
        skills: [],
        skillsStatus: toChineseUserMessage(error, t("skills.failed_to_load")),
      }));
    } finally {
      refreshSkillsInFlight = false;
    }
  }

  async function refreshPlugins(scopeOverride?: PluginScope) {
    const isRemoteWorkspace = options.workspaceType() === "remote";
    const isLocalWorkspace = options.workspaceType() === "local";
    const { openworkSnapshot, openworkClient, openworkWorkspaceId, hasOpenworkTarget } =
      await resolveWorkspaceServerTarget();
    const canUseOpenworkServer =
      hasOpenworkTarget &&
      openworkSnapshot.openworkServerCapabilities?.plugins?.read !== false;

    if (refreshPluginsInFlight) return;
    refreshPluginsInFlight = true;
    refreshPluginsAborted = false;

    const scope = scopeOverride ?? snapshot.pluginScope;
    const targetDir = options.projectDir().trim();

    if (scope !== "project" && !isLocalWorkspace) {
      mutateState((current) => ({
        ...current,
        pluginStatus: "全局插件仅支持本地工作区。",
        pluginList: [],
        sidebarPluginStatus: "全局插件需要本地工作区。",
        sidebarPluginList: [],
      }));
      refreshPluginsInFlight = false;
      return;
    }

    if (scope === "project" && canUseOpenworkServer && openworkClient && openworkWorkspaceId) {
      mutateState((current) => ({
        ...current,
        pluginConfig: null,
        pluginConfigPath: `工作区配置（${isRemoteWorkspace ? "远程" : "本机"}服务）`,
      }));

      try {
        mutateState((current) => ({ ...current, pluginStatus: null, sidebarPluginStatus: null }));
        if (refreshPluginsAborted) return;
        const result = await openworkClient.listPlugins(openworkWorkspaceId, { includeGlobal: false });
        if (refreshPluginsAborted) return;
        const projectItems = result.items.filter((item) => item.scope === "project");
        const list = toProjectPluginListEntries(projectItems);
        mutateState((current) => ({
          ...current,
          pluginList: list,
          sidebarPluginList: list.map((entry) => entry.name),
          pluginStatus: list.length ? null : "当前尚未配置插件。",
          sidebarPluginStatus: null,
          pluginsContextKey: getWorkspaceContextKey(),
        }));
      } catch (error) {
        if (refreshPluginsAborted) return;
        mutateState((current) => ({
          ...current,
          pluginList: [],
          sidebarPluginList: [],
          sidebarPluginStatus: "无法加载插件。",
          pluginStatus: toChineseUserMessage(error, "无法加载插件，请稍后重试。"),
        }));
      } finally {
        refreshPluginsInFlight = false;
      }
      return;
    }

    if (scope === "project" && hasOpenworkTarget) {
      mutateState((current) => ({
        ...current,
        pluginStatus: "SeeWayWork 服务无法读取当前工作区的插件。",
        pluginList: [],
        sidebarPluginStatus: "SeeWayWork 服务无法读取当前工作区的插件。",
        sidebarPluginList: [],
      }));
      refreshPluginsInFlight = false;
      return;
    }

    if (!isDesktopRuntime()) {
      mutateState((current) => ({
        ...current,
        pluginStatus: t("skills.plugin_management_host_only"),
        pluginList: [],
        sidebarPluginStatus: t("skills.plugins_host_only"),
        sidebarPluginList: [],
      }));
      refreshPluginsInFlight = false;
      return;
    }

    if (!isLocalWorkspace && !canUseOpenworkServer) {
      mutateState((current) => ({
        ...current,
        pluginStatus: "SeeWayWork 服务不可用，请重新连接后再管理插件。",
        pluginList: [],
        sidebarPluginStatus: "请连接 SeeWayWork 服务后再加载插件。",
        sidebarPluginList: [],
      }));
      refreshPluginsInFlight = false;
      return;
    }

    if (scope === "project" && !targetDir) {
      mutateState((current) => ({
        ...current,
        pluginStatus: t("skills.pick_project_for_plugins"),
        pluginList: [],
        sidebarPluginStatus: t("skills.pick_project_for_active"),
        sidebarPluginList: [],
      }));
      refreshPluginsInFlight = false;
      return;
    }

    try {
      mutateState((current) => ({ ...current, pluginStatus: null, sidebarPluginStatus: null }));
      if (refreshPluginsAborted) return;
      const config = (await readOpencodeConfig(scope, targetDir)) as OpencodeConfigFile;
      if (refreshPluginsAborted) return;
      mutateState((current) => ({ ...current, pluginConfig: (config as OpencodeConfigFile | null), pluginConfigPath: config.path ?? null }));

      if (!config.exists) {
        mutateState((current) => ({
          ...current,
          pluginList: [],
          pluginStatus: t("skills.no_opencode_found"),
          sidebarPluginList: [],
          sidebarPluginStatus: t("skills.no_opencode_workspace"),
        }));
        return;
      }

      let nextSidebarPluginList: string[] = [];
      let nextSidebarPluginStatus: string | null = null;
      try {
        nextSidebarPluginList = parsePluginListFromContent(config.content ?? "");
      } catch {
        nextSidebarPluginList = [];
        nextSidebarPluginStatus = t("skills.failed_parse_opencode");
      }

      const nextPluginNames: string[] = [];
      let nextPluginStatus: string | null = null;
      loadPluginsFromConfigHelpers(
        config as never,
        (value) => {
          nextPluginNames.splice(0, nextPluginNames.length, ...applyStateAction(nextPluginNames, value));
        },
        (message) => {
          nextPluginStatus = message;
        },
      );

      mutateState((current) => ({
        ...current,
        pluginList: toConfigPluginListEntries(nextPluginNames),
        pluginStatus: nextPluginStatus,
        sidebarPluginList: nextSidebarPluginList,
        sidebarPluginStatus: nextSidebarPluginStatus,
        pluginsContextKey: getWorkspaceContextKey(),
      }));
    } catch (error) {
      if (refreshPluginsAborted) return;
      mutateState((current) => ({
        ...current,
        pluginConfig: null,
        pluginConfigPath: null,
        pluginList: [],
        pluginStatus: toChineseUserMessage(error, t("skills.failed_load_opencode")),
        sidebarPluginStatus: t("skills.failed_load_active"),
        sidebarPluginList: [],
      }));
    } finally {
      refreshPluginsInFlight = false;
    }
  }

  async function addPlugin(pluginNameOverride?: string) {
    const pluginName = (pluginNameOverride ?? snapshot.pluginInput).trim();
    const isManualInput = pluginNameOverride == null;
    const triggerName = stripPluginVersion(pluginName);

    const isLocalWorkspace = options.workspaceType() === "local";
    const { openworkSnapshot, openworkClient, openworkWorkspaceId, hasOpenworkTarget } =
      await resolveWorkspaceServerTarget();
    const canUseOpenworkServer =
      hasOpenworkTarget &&
      openworkSnapshot.openworkServerCapabilities?.plugins?.write !== false;

    if (!pluginName) {
      if (isManualInput) setStateField("pluginStatus", t("skills.enter_plugin_name"));
      return;
    }

    if (snapshot.pluginScope !== "project" && !isLocalWorkspace) {
      setStateField("pluginStatus", "全局插件仅支持本地工作区。");
      return;
    }

    if (snapshot.pluginScope === "project" && canUseOpenworkServer && openworkClient && openworkWorkspaceId) {
      try {
        setStateField("pluginStatus", null);
        await openworkClient.addPlugin(openworkWorkspaceId, pluginName);
        options.markReloadRequired?.("plugins", { type: "plugin", name: triggerName, action: "added" });
        if (isManualInput) setStateField("pluginInput", "");
        await refreshPlugins("project");
      } catch (error) {
        setStateField("pluginStatus", toChineseUserMessage(error, "无法添加插件，请稍后重试。"));
      }
      return;
    }

    if (snapshot.pluginScope === "project" && hasOpenworkTarget) {
      setStateField("pluginStatus", "SeeWayWork 服务无法修改当前工作区的插件。");
      return;
    }

    if (!isDesktopRuntime()) {
      setStateField("pluginStatus", t("skills.plugin_management_host_only"));
      return;
    }

    if (!isLocalWorkspace) {
      setStateField("pluginStatus", "SeeWayWork 服务不可用，请重新连接后再管理插件。");
      return;
    }

    const scope = snapshot.pluginScope;
    const targetDir = options.projectDir().trim();

    if (scope === "project" && !targetDir) {
      setStateField("pluginStatus", t("skills.pick_project_for_plugins"));
      return;
    }

    try {
      setStateField("pluginStatus", null);
      const config = (await readOpencodeConfig(scope, targetDir)) as OpencodeConfigFile;
      const raw = config.content ?? "";

      if (!raw.trim()) {
        const payload = { plugin: [pluginName] };
        await writeOpencodeConfig(scope, targetDir, `${JSON.stringify(payload, null, 2)}\n`);
        options.markReloadRequired?.("plugins", { type: "plugin", name: triggerName, action: "added" });
        if (isManualInput) setStateField("pluginInput", "");
        await refreshPlugins(scope);
        return;
      }

      const plugins = parsePluginListFromContent(raw);
      const desired = stripPluginVersion(pluginName).toLowerCase();
      if (plugins.some((entry) => stripPluginVersion(entry).toLowerCase() === desired)) {
        setStateField("pluginStatus", t("skills.plugin_already_listed"));
        return;
      }

      const next = [...plugins, pluginName];
      const edits = modify(raw, ["plugin"], next, { formattingOptions: { insertSpaces: true, tabSize: 2 } });
      const updated = applyEdits(raw, edits);
      await writeOpencodeConfig(scope, targetDir, updated);
      options.markReloadRequired?.("plugins", { type: "plugin", name: triggerName, action: "added" });
      if (isManualInput) setStateField("pluginInput", "");
      await refreshPlugins(scope);
    } catch (error) {
      setStateField("pluginStatus", toChineseUserMessage(error, t("skills.failed_update_opencode")));
    }
  }

  async function removePlugin(pluginName: string) {
    const name = pluginName.trim();
    if (!name) return;
    const triggerName = stripPluginVersion(name);
    const existingPlugin = snapshot.pluginList.find((entry) => entry.name === name);
    if (existingPlugin && !existingPlugin.removable) {
      setStateField("pluginStatus", "从文件夹发现的插件为只读，无法在此移除。");
      return;
    }

    const isLocalWorkspace = options.workspaceType() === "local";
    const { openworkSnapshot, openworkClient, openworkWorkspaceId, hasOpenworkTarget } =
      await resolveWorkspaceServerTarget();
    const canUseOpenworkServer =
      hasOpenworkTarget &&
      openworkSnapshot.openworkServerCapabilities?.plugins?.write !== false;

    if (snapshot.pluginScope !== "project" && !isLocalWorkspace) {
      setStateField("pluginStatus", "全局插件仅支持本地工作区。");
      return;
    }

    if (snapshot.pluginScope === "project" && canUseOpenworkServer && openworkClient && openworkWorkspaceId) {
      try {
        setStateField("pluginStatus", null);
        await openworkClient.removePlugin(openworkWorkspaceId, name);
        options.markReloadRequired?.("plugins", { type: "plugin", name: triggerName, action: "removed" });
        await refreshPlugins("project");
      } catch (error) {
        setStateField("pluginStatus", toChineseUserMessage(error, "无法移除插件，请稍后重试。"));
      }
      return;
    }

    if (snapshot.pluginScope === "project" && hasOpenworkTarget) {
      setStateField("pluginStatus", "SeeWayWork 服务无法修改当前工作区的插件。");
      return;
    }

    if (!isDesktopRuntime()) {
      setStateField("pluginStatus", t("skills.plugin_management_host_only"));
      return;
    }

    if (!isLocalWorkspace) {
      setStateField("pluginStatus", "SeeWayWork 服务不可用，请重新连接后再管理插件。");
      return;
    }

    const scope = snapshot.pluginScope;
    const targetDir = options.projectDir().trim();
    if (scope === "project" && !targetDir) {
      setStateField("pluginStatus", t("skills.pick_project_for_plugins"));
      return;
    }

    try {
      setStateField("pluginStatus", null);
      const config = (await readOpencodeConfig(scope, targetDir)) as OpencodeConfigFile;
      const raw = config.content ?? "";
      if (!raw.trim()) {
        setStateField("pluginStatus", "当前尚未配置插件。");
        return;
      }

      const plugins = parsePluginListFromContent(raw);
      const desired = stripPluginVersion(name).toLowerCase();
      const next = plugins.filter((entry) => stripPluginVersion(entry).toLowerCase() !== desired);
      if (next.length === plugins.length) {
        setStateField("pluginStatus", "未找到该插件。");
        return;
      }

      const edits = modify(raw, ["plugin"], next, { formattingOptions: { insertSpaces: true, tabSize: 2 } });
      const updated = applyEdits(raw, edits);
      await writeOpencodeConfig(scope, targetDir, updated);
      options.markReloadRequired?.("plugins", { type: "plugin", name: triggerName, action: "removed" });
      await refreshPlugins(scope);
    } catch (error) {
      setStateField("pluginStatus", toChineseUserMessage(error, t("skills.failed_update_opencode")));
    }
  }

  async function importLocalSkill() {
    const isLocalWorkspace = options.workspaceType() === "local";
    if (!isDesktopRuntime()) {
      options.setError(t("skills.desktop_required"));
      return;
    }
    if (!isLocalWorkspace) {
      options.setError("只有本地工作区可以导入技能。");
      return;
    }
    const targetDir = options.projectDir().trim();
    if (!targetDir) {
      options.setError(t("skills.pick_project_first"));
      return;
    }

    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", null);
    try {
      const selection = await pickDirectory({ title: t("skills.select_skill_folder") });
      const sourceDir = typeof selection === "string" ? selection : Array.isArray(selection) ? selection[0] : null;
      if (!sourceDir) return;
      const inferredName = sourceDir.split(/[\\/]/).filter(Boolean).pop();
      const result = (await importSkill(targetDir, sourceDir, { overwrite: false })) as { ok: boolean; stderr?: string; stdout?: string; status?: number };
      if (!result.ok) {
        setStateField("skillsStatus", toChineseUserMessage(
          result.stderr || result.stdout,
          t("skills.import_failed").replace("{status}", String(result.status)),
        ));
      } else {
        setStateField("skillsStatus", toChineseUserMessage(result.stdout, t("skills.imported")));
        options.markReloadRequired?.("skills", { type: "skill", name: inferredName, action: "added" });
      }
      await refreshSkills({ force: true });
    } catch (error) {
      const message = toChineseUserMessage(
        addOpencodeCacheHint(error instanceof Error ? error.message : ""),
        t("skills.unknown_error"),
      );
      options.setError(addOpencodeCacheHint(message));
    } finally {
      options.setBusy(false);
    }
  }

  async function installSkillCreator(): Promise<{ ok: boolean; message: string }> {
    const isRemoteWorkspace = options.workspaceType() === "remote";
    const isLocalWorkspace = options.workspaceType() === "local";
    const { openworkSnapshot, openworkClient, openworkWorkspaceId, hasOpenworkTarget } =
      await resolveWorkspaceServerTarget();
    const canUseOpenworkServer =
      hasOpenworkTarget &&
      openworkSnapshot.openworkServerCapabilities?.skills?.write !== false;

    if (canUseOpenworkServer && openworkClient && openworkWorkspaceId) {
      options.setBusy(true);
      options.setError(null);
      setStateField("skillsStatus", t("skills.installing_skill_creator"));
      try {
        await openworkClient.upsertSkill(openworkWorkspaceId, { name: "skill-creator", content: skillCreatorTemplate });
        const message = t("skills.skill_creator_installed");
        setStateField("skillsStatus", message);
        options.markReloadRequired?.("skills", { type: "skill", name: "skill-creator", action: "added" });
        await refreshSkills({ force: true });
        return { ok: true, message };
      } catch (error) {
        const message = toChineseUserMessage(
          addOpencodeCacheHint(error instanceof Error ? error.message : ""),
          t("skills.unknown_error"),
        );
        setStateField("skillsStatus", message);
        options.setError(message);
        return { ok: false, message };
      } finally {
        options.setBusy(false);
      }
    }

    if (hasOpenworkTarget) {
      const message = "SeeWayWork 服务无法修改当前工作区的技能。";
      setStateField("skillsStatus", message);
      return { ok: false, message };
    }

    if (isRemoteWorkspace) {
      const message = "SeeWayWork 服务不可用，请重新连接后再安装技能。";
      setStateField("skillsStatus", message);
      return { ok: false, message };
    }
    if (!isDesktopRuntime()) {
      const message = t("skills.desktop_required");
      setStateField("skillsStatus", message);
      return { ok: false, message };
    }
    if (!isLocalWorkspace) {
      const message = "只有本地工作区可以安装技能。";
      options.setError(message);
      setStateField("skillsStatus", message);
      return { ok: false, message };
    }

    const targetDir = options.selectedWorkspaceRoot().trim();
    if (!targetDir) {
      const message = t("skills.pick_workspace_first");
      setStateField("skillsStatus", message);
      return { ok: false, message };
    }

    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", t("skills.installing_skill_creator"));
    try {
      const result = (await installSkillTemplate(targetDir, "skill-creator", skillCreatorTemplate, { overwrite: false })) as { ok: boolean; stderr: string; stdout: string };
      if (!result.ok && /already exists/i.test(result.stderr)) {
        const message = t("skills.skill_creator_already_installed");
        setStateField("skillsStatus", message);
        await refreshSkills({ force: true });
        return { ok: true, message };
      }
      if (!result.ok) {
        const message = toChineseUserMessage(
          result.stderr || result.stdout,
          t("skills.install_failed"),
        );
        setStateField("skillsStatus", message);
        await refreshSkills({ force: true });
        return { ok: false, message };
      }
      const message = toChineseUserMessage(result.stdout, t("skills.skill_creator_installed"));
      setStateField("skillsStatus", message);
      options.markReloadRequired?.("skills", { type: "skill", name: "skill-creator", action: "added" });
      await refreshSkills({ force: true });
      return { ok: true, message };
    } catch (error) {
      const message = toChineseUserMessage(
        addOpencodeCacheHint(error instanceof Error ? error.message : ""),
        t("skills.unknown_error"),
      );
      setStateField("skillsStatus", message);
      options.setError(message);
      return { ok: false, message };
    } finally {
      options.setBusy(false);
    }
  }

  async function revealSkillsFolder() {
    if (!isDesktopRuntime()) {
      setStateField("skillsStatus", t("skills.desktop_required"));
      return;
    }
    const root = options.selectedWorkspaceRoot().trim();
    if (!root) {
      setStateField("skillsStatus", t("skills.pick_workspace_first"));
      return;
    }

    try {
      const [opencodeSkills, claudeSkills, legacySkills] = await Promise.all([
        joinDesktopPath(root, ".opencode", "skills"),
        joinDesktopPath(root, ".claude", "skills"),
        joinDesktopPath(root, ".opencode", "skill"),
      ]);
      const tryOpen = async (target: string) => {
        try {
          await openDesktopPath(target);
          return true;
        } catch {
          return false;
        }
      };
      if (await tryOpen(opencodeSkills)) return;
      if (await tryOpen(claudeSkills)) return;
      if (await tryOpen(legacySkills)) return;
      await revealDesktopItemInDir(opencodeSkills);
    } catch (error) {
      setStateField("skillsStatus", toChineseUserMessage(error, t("skills.reveal_failed")));
    }
  }

  async function uninstallSkill(target: SkillTarget) {
    const { name: trimmed } = normalizeSkillTarget(target);
    if (!trimmed) return;

    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", null);
    try {
      await deleteWorkspaceSkill(target);
      setStateField("skillsStatus", t("skills.uninstalled"));
      options.markReloadRequired?.("skills", { type: "skill", name: trimmed, action: "removed" });
      await refreshSkills({ force: true });
    } catch (error) {
      const message = toChineseUserMessage(
        addOpencodeCacheHint(error instanceof Error ? error.message : ""),
        t("skills.unknown_error"),
      );
      setStateField("skillsStatus", message);
      options.setError(addOpencodeCacheHint(message));
    } finally {
      options.setBusy(false);
    }
  }

  async function readSkill(target: SkillTarget): Promise<{ name: string; path: string; content: string } | null> {
    const { name: trimmed, source } = normalizeSkillTarget(target);
    if (!trimmed) return null;
    if (source === "desktop-global") {
      if (!isDesktopRuntime()) {
        setStateField("skillsStatus", t("skills.desktop_required"));
        return null;
      }
      try {
        setStateField("skillsStatus", null);
        const result = await readGlobalSkill(trimmed);
        return { name: trimmed, path: result.path, content: result.content };
      } catch (error) {
        setStateField("skillsStatus", toChineseUserMessage(error, t("skills.failed_to_load")));
        return null;
      }
    }
    const root = options.selectedWorkspaceRoot().trim();
    const isRemoteWorkspace = options.workspaceType() === "remote";
    const isLocalWorkspace = options.workspaceType() === "local";
    const { openworkSnapshot, openworkClient, openworkWorkspaceId, hasOpenworkTarget } =
      await resolveWorkspaceServerTarget();
    const canUseOpenworkServer =
      hasOpenworkTarget &&
      openworkSnapshot.openworkServerCapabilities?.skills?.read !== false;

    if (canUseOpenworkServer && openworkClient && openworkWorkspaceId) {
      try {
        setStateField("skillsStatus", null);
        const result = await openworkClient.getSkill(openworkWorkspaceId, trimmed, { includeGlobal: isLocalWorkspace });
        return { name: result.item.name, path: result.item.path, content: result.content };
      } catch (error) {
        setStateField("skillsStatus", toChineseUserMessage(error, t("skills.failed_to_load")));
        return null;
      }
    }

    if (hasOpenworkTarget) {
      setStateField("skillsStatus", "SeeWayWork 服务无法读取当前工作区的技能。");
      return null;
    }

    if (!root) {
      setStateField("skillsStatus", t("skills.pick_workspace_first"));
      return null;
    }

    if (isRemoteWorkspace) {
      setStateField("skillsStatus", "SeeWayWork 服务不可用，请重新连接后再查看技能。");
      return null;
    }
    if (!isDesktopRuntime()) {
      setStateField("skillsStatus", t("skills.desktop_required"));
      return null;
    }
    if (!isLocalWorkspace) {
      setStateField("skillsStatus", "只有本地工作区可以查看技能。");
      return null;
    }

    try {
      setStateField("skillsStatus", null);
      const result = (await readLocalSkill(root, trimmed)) as { path: string; content: string };
      return { name: trimmed, path: result.path, content: result.content };
    } catch (error) {
      setStateField("skillsStatus", toChineseUserMessage(error, t("skills.failed_to_load")));
      return null;
    }
  }

  async function saveSkill(input: { name: string; content: string; description?: string; source?: SkillCard["source"] }) {
    const trimmed = input.name.trim();
    if (!trimmed) return;
    if (input.source === "desktop-global") {
      if (!isDesktopRuntime()) {
        setStateField("skillsStatus", t("skills.desktop_required"));
        return;
      }
      options.setBusy(true);
      options.setError(null);
      setStateField("skillsStatus", null);
      try {
        const result = await writeGlobalSkill(trimmed, input.content);
        if (!result.ok) {
          setStateField("skillsStatus", toChineseUserMessage(result.stderr || result.stdout, t("skills.unknown_error")));
        } else {
          setStateField("skillsStatus", toChineseUserMessage(result.stdout, "已保存。"));
          options.markReloadRequired?.("skills", { type: "skill", name: trimmed, action: "updated" });
        }
        await refreshSkills({ force: true });
      } catch (error) {
        options.setError(toChineseUserMessage(error, t("skills.unknown_error")));
      } finally {
        options.setBusy(false);
      }
      return;
    }
    const root = options.selectedWorkspaceRoot().trim();
    const isRemoteWorkspace = options.workspaceType() === "remote";
    const isLocalWorkspace = options.workspaceType() === "local";
    const { openworkSnapshot, openworkClient, openworkWorkspaceId, hasOpenworkTarget } =
      await resolveWorkspaceServerTarget();
    const canUseOpenworkServer =
      hasOpenworkTarget &&
      openworkSnapshot.openworkServerCapabilities?.skills?.write !== false;

    if (canUseOpenworkServer && openworkClient && openworkWorkspaceId) {
      options.setBusy(true);
      options.setError(null);
      setStateField("skillsStatus", null);
      try {
        await openworkClient.upsertSkill(openworkWorkspaceId, {
          name: trimmed,
          content: input.content,
          description: input.description,
        });
        options.markReloadRequired?.("skills", { type: "skill", name: trimmed, action: "updated" });
        await refreshSkills({ force: true });
        setStateField("skillsStatus", "已保存。");
      } catch (error) {
        const message = toChineseUserMessage(
          addOpencodeCacheHint(error instanceof Error ? error.message : ""),
          t("skills.unknown_error"),
        );
        options.setError(addOpencodeCacheHint(message));
      } finally {
        options.setBusy(false);
      }
      return;
    }

    if (hasOpenworkTarget) {
      setStateField("skillsStatus", "SeeWayWork 服务无法修改当前工作区的技能。");
      return;
    }

    if (!root) {
      setStateField("skillsStatus", t("skills.pick_workspace_first"));
      return;
    }

    if (isRemoteWorkspace) {
      setStateField("skillsStatus", "SeeWayWork 服务不可用，请重新连接后再编辑技能。");
      return;
    }
    if (!isDesktopRuntime()) {
      setStateField("skillsStatus", t("skills.desktop_required"));
      return;
    }
    if (!isLocalWorkspace) {
      setStateField("skillsStatus", "只有本地工作区可以编辑技能。");
      return;
    }

    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", null);
    try {
      const result = (await writeLocalSkill(root, trimmed, input.content)) as { ok: boolean; stderr?: string; stdout?: string };
      if (!result.ok) {
        setStateField("skillsStatus", toChineseUserMessage(
          result.stderr || result.stdout,
          t("skills.unknown_error"),
        ));
      } else {
        setStateField("skillsStatus", toChineseUserMessage(result.stdout, "已保存。"));
        options.markReloadRequired?.("skills", { type: "skill", name: trimmed, action: "updated" });
      }
      await refreshSkills({ force: true });
    } catch (error) {
      const message = toChineseUserMessage(
        addOpencodeCacheHint(error instanceof Error ? error.message : ""),
        t("skills.unknown_error"),
      );
      options.setError(addOpencodeCacheHint(message));
    } finally {
      options.setBusy(false);
    }
  }

  function abortRefreshes() {
    refreshSkillsAborted = true;
    refreshPluginsAborted = true;
    refreshHubSkillsAborted = true;
    refreshCloudOrgSkillsAborted = true;
    refreshCloudOrgMarketplacesAborted = true;
  }

  function ensureSkillsFresh() {
    if (!snapshot.skillsStale) return;
    void refreshSkills({ force: true });
  }

  function ensurePluginsFresh(scopeOverride?: PluginScope) {
    if (!snapshot.pluginsStale) return;
    void refreshPlugins(scopeOverride);
  }

  function ensureHubSkillsFresh() {
    if (!snapshot.hubSkillsStale) return;
    void refreshHubSkills({ force: true });
  }

  function ensureCloudOrgSkillsFresh() {
    if (!snapshot.cloudOrgSkillsStale) return;
    void refreshCloudOrgSkills({ force: true });
  }

  const start = () => {
    if (started) return;
    // StrictMode double-mount re-arms after dispose.
    disposed = false;
    started = true;

    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(LEGACY_HUB_REPOS_STORAGE_KEY);
      } catch {
        // ignore
      }

      const onDenSessionUpdated = () => {
        cloudOrgSkillsLoaded = false;
        cloudOrgMarketplacesLoaded = false;
        mutateState((current) => ({ ...current, cloudOrgSkillsContextKey: "" }));
      };
      window.addEventListener("openwork-den-session-updated", onDenSessionUpdated);
      stopDenSessionListener = () => window.removeEventListener("openwork-den-session-updated", onDenSessionUpdated);
    }

    stopOpenworkSubscription = options.openworkServer.subscribe(() => {
      syncFromOptions();
    });

    syncFromOptions();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    started = false;
    abortRefreshes();
    stopOpenworkSubscription?.();
    stopOpenworkSubscription = null;
    stopDenSessionListener?.();
    stopDenSessionListener = null;
    listeners.clear();
  };

  const syncFromOptions = () => {
    if (disposed) return;
    const key = getWorkspaceContextKey();
    if (key === lastWorkspaceContextKey) return;
    lastWorkspaceContextKey = key;
    invalidateWorkspaceCaches();
    touch();
    if (!key || key === "::::") return;
    void refreshSkills({ force: true });
    void refreshPlugins();
    void refreshImportedCloudSkills();
    void refreshImportedCloudPlugins();
  };

  refreshSnapshot();

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const getSnapshot = () => snapshot;

  return {
    subscribe,
    getSnapshot,
    start,
    dispose,
    syncFromOptions,
    skills: () => snapshot.skills,
    skillsStatus: () => snapshot.skillsStatus,
    hubSkills: () => snapshot.hubSkills,
    hubSkillsStatus: () => snapshot.hubSkillsStatus,
    cloudOrgSkills: () => snapshot.cloudOrgSkills,
    cloudOrgSkillsStatus: () => snapshot.cloudOrgSkillsStatus,
    importedCloudSkills: () => snapshot.importedCloudSkills,
    cloudOrgMarketplaces: () => snapshot.cloudOrgMarketplaces,
    cloudOrgMarketplacesStatus: () => snapshot.cloudOrgMarketplacesStatus,
    importedCloudMarketplaces: () => snapshot.importedCloudMarketplaces,
    importedCloudPlugins: () => snapshot.importedCloudPlugins,
    pendingCloudPluginChanges: () => snapshot.pendingCloudPluginChanges,
    get pluginScope() {
      return snapshot.pluginScope;
    },
    setPluginScope(value: SetStateAction<PluginScope>) {
      const resolved = applyStateAction(state.pluginScope, value);
      setStateField("pluginScope", resolved);
    },
    pluginConfig: () => snapshot.pluginConfig,
    pluginConfigPath: () => snapshot.pluginConfigPath,
    pluginList: () => snapshot.pluginList,
    pluginInput: () => snapshot.pluginInput,
    setPluginInput(value: SetStateAction<string>) {
      const resolved = applyStateAction(state.pluginInput, value);
      setStateField("pluginInput", resolved);
    },
    pluginStatus: () => snapshot.pluginStatus,
    activePluginGuide: () => snapshot.activePluginGuide,
    setActivePluginGuide(value: SetStateAction<string | null>) {
      const resolved = applyStateAction(state.activePluginGuide, value);
      setStateField("activePluginGuide", resolved);
    },
    sidebarPluginList: () => snapshot.sidebarPluginList,
    sidebarPluginStatus: () => snapshot.sidebarPluginStatus,
    workspaceContextKey: () => snapshot.workspaceContextKey,
    skillsStale: () => snapshot.skillsStale,
    pluginsStale: () => snapshot.pluginsStale,
    hubSkillsStale: () => snapshot.hubSkillsStale,
    cloudOrgSkillsStale: () => snapshot.cloudOrgSkillsStale,
    isPluginInstalledByName,
    refreshSkills,
    refreshHubSkills,
    refreshCloudOrgSkills,
    refreshCloudOrgMarketplaces,
    refreshPlugins,
    addPlugin,
    removePlugin,
    importLocalSkill,
    installSkillCreator,
    installHubSkill,
    installCloudOrgSkill,
    syncCloudOrgSkill,
    removeCloudOrgSkill,
    importCloudOrgPlugin,
    removeCloudOrgPlugin,
    previewClaudePlugin,
    installClaudePlugin,
    revealSkillsFolder,
    uninstallSkill,
    readSkill,
    saveSkill,
    abortRefreshes,
    ensureSkillsFresh,
    ensurePluginsFresh,
    ensureHubSkillsFresh,
    ensureCloudOrgSkillsFresh,
  };
}

export function useExtensionsStoreSnapshot(store: ExtensionsStore) {
  return React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
