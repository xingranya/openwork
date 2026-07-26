/** @jsxImportSource react */
import { useState, type ComponentProps, type ReactNode } from "react";
import { CircleAlert, Cpu, Database, Info, RefreshCcw, Server } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { OpenworkCloudMcpHealth, OpenworkRuntimeConfigStatus, OpenworkServerStatus } from "@/app/lib/openwork-server";
import { sanitizeCloudMcpHealthDiagnostic, sanitizeDiagnosticRecord } from "@/app/lib/diagnostic-sanitizer";
import {
  DEFAULT_DEN_API_BASE_URL,
  DEFAULT_DEN_BASE_URL,
  readDenBootstrapConfig,
  readDenSettings,
} from "@/app/lib/den";
import {
  describeCloudMcpTarget,
  describeDenEndpointSource,
  type DenEndpointSource,
} from "@/app/lib/den-endpoint-sources";
import { isDesktopRuntime } from "@/app/utils";
import { t } from "@/i18n";
import { ControlPlaneUrlEditor } from "../cloud/control-plane-url-editor";
import {
  displayCustomControlPlaneUrl,
  isValidControlPlaneUrl,
} from "../cloud/control-plane-url";
import {
  SettingsInset,
  SettingsNotice,
  SettingsStatusBadge,
} from "../settings-section";
import {
  LayoutSection,
  LayoutSectionDescription,
  LayoutSectionHeader,
  LayoutSectionItem,
  LayoutSectionItemDescription,
  LayoutSectionItemFootnote,
  LayoutSectionItemHeader,
  LayoutSectionItemHeaderActions,
  LayoutSectionItemTitle,
  LayoutSectionTitle,
} from "../settings-layout";

type SettingsTone = ComponentProps<typeof SettingsStatusBadge>["tone"];

const DESKTOP_BOOTSTRAP_PATH_HINT = "~/.config/openwork/desktop-bootstrap.json";

function sourceBadgeLabel(source: DenEndpointSource): string {
  switch (source) {
    case "custom":
      return t("settings.server_endpoints_source_custom");
    case "bootstrap":
      return t("settings.server_endpoints_source_bootstrap");
    case "default":
      return t("settings.server_endpoints_source_default");
  }
}

function sourceBadgeClass(source: DenEndpointSource): string {
  switch (source) {
    case "custom":
      return "border-blue-7/40 bg-blue-3 text-blue-11";
    case "bootstrap":
      return "border-amber-7/40 bg-amber-3 text-amber-11";
    case "default":
      return "border-gray-7/50 bg-gray-3 text-gray-11";
  }
}

function EndpointSourceBadge(props: { source: DenEndpointSource }) {
  return (
    <Badge variant="outline" className={sourceBadgeClass(props.source)}>
      {sourceBadgeLabel(props.source)}
    </Badge>
  );
}

function EndpointWarningBadge(props: { children: ReactNode }) {
  return (
    <Badge variant="outline" className="border-amber-7/40 bg-amber-3 text-amber-11">
      {props.children}
    </Badge>
  );
}

function EndpointRow(props: { label: string; value: string; children?: ReactNode }) {
  return (
    <div className="grid gap-1 rounded-xl border border-gray-6/50 bg-gray-1/60 p-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-gray-9">
        {props.label}
      </div>
      <div className="min-w-0 space-y-2">
        <div className="truncate font-mono text-xs text-gray-12" title={props.value}>
          {props.value}
        </div>
        {props.children ? <div className="flex flex-wrap gap-1.5">{props.children}</div> : null}
      </div>
    </div>
  );
}

function bootstrapValueWhenNotDefault(value: string, buildDefault: string): string | null {
  const fallback = describeDenEndpointSource({
    storedValue: null,
    bootstrapValue: null,
    buildDefault,
  });
  return value === fallback.effective ? null : value;
}

function ServerEndpointsCard(props: { cloudMcpUrl: string | null }) {
  const settings = readDenSettings();
  const effectiveApiBaseUrl = settings.apiBaseUrl ?? DEFAULT_DEN_API_BASE_URL;
  const bootstrap = readDenBootstrapConfig();
  const organizationServer = describeDenEndpointSource({
    storedValue: null,
    bootstrapValue: bootstrapValueWhenNotDefault(bootstrap.baseUrl, DEFAULT_DEN_BASE_URL),
    buildDefault: DEFAULT_DEN_BASE_URL,
  });
  const apiEndpoint = describeDenEndpointSource({
    storedValue: null,
    bootstrapValue: bootstrapValueWhenNotDefault(bootstrap.apiBaseUrl, DEFAULT_DEN_API_BASE_URL),
    buildDefault: DEFAULT_DEN_API_BASE_URL,
  });
  const cloudMcp = describeCloudMcpTarget({
    mcpUrl: props.cloudMcpUrl,
    effectiveApiBaseUrl,
  });
  const hasBootstrapSource = organizationServer.source === "bootstrap" || apiEndpoint.source === "bootstrap";

  return (
    <SettingsInset className="space-y-3 bg-gray-1/40">
      <div className="space-y-1">
        <div className="text-sm font-medium text-gray-12">{t("settings.server_endpoints_title")}</div>
        <div className="text-xs text-gray-9">{t("settings.server_endpoints_desc")}</div>
      </div>

      <div className="space-y-2">
        <EndpointRow label={t("settings.server_endpoints_org")} value={settings.baseUrl}>
          <EndpointSourceBadge source={organizationServer.source} />
        </EndpointRow>
        <EndpointRow label={t("settings.server_endpoints_api")} value={effectiveApiBaseUrl}>
          <EndpointSourceBadge source={apiEndpoint.source} />
        </EndpointRow>
        <EndpointRow
          label={t("settings.server_endpoints_cloud_mcp")}
          value={cloudMcp.url ?? t("settings.server_endpoints_not_configured")}
        >
          {cloudMcp.url && cloudMcp.isLocalhost ? (
            <EndpointWarningBadge>{t("settings.server_endpoints_local_dev")}</EndpointWarningBadge>
          ) : null}
          {cloudMcp.url && !cloudMcp.matchesApi ? (
            <EndpointWarningBadge>{t("settings.server_endpoints_mismatch")}</EndpointWarningBadge>
          ) : null}
        </EndpointRow>
      </div>

      {hasBootstrapSource ? (
        <div className="text-[11px] text-amber-11">
          {t("settings.server_endpoints_bootstrap_hint", { path: DESKTOP_BOOTSTRAP_PATH_HINT })}
        </div>
      ) : null}
    </SettingsInset>
  );
}

interface AdvancedOrganizationServerSectionProps {
  authBusy: boolean;
  baseUrl: string;
  baseUrlBusy: boolean;
  baseUrlDraft: string;
  baseUrlError: string | null;
  onApplyBaseUrl: () => void | Promise<void>;
  onBaseUrlDraftChange: (value: string) => void;
  onClearServerConfiguration: () => void | Promise<void>;
  onResetBaseUrlToDefault: () => void | Promise<void>;
  sessionBusy: boolean;
  cloudMcpUrl: string | null;
}

export function AdvancedOrganizationServerSection(props: AdvancedOrganizationServerSectionProps) {
  const [clearConfirming, setClearConfirming] = useState(false);
  const controlsDisabled = [props.authBusy, props.baseUrlBusy, props.sessionBusy].some(Boolean);
  const customUrl = displayCustomControlPlaneUrl(props.baseUrlDraft);
  const currentUrl = displayCustomControlPlaneUrl(props.baseUrl);
  const clearServerConfiguration = () => {
    if (!clearConfirming) {
      setClearConfirming(true);
      return;
    }
    setClearConfirming(false);
    void props.onClearServerConfiguration();
  };

  return (
    <LayoutSection>
      <LayoutSectionHeader>
        <LayoutSectionTitle>{t("settings.organization_server_title")}</LayoutSectionTitle>
        <LayoutSectionDescription>{t("settings.organization_server_desc")}</LayoutSectionDescription>
      </LayoutSectionHeader>

      <LayoutSectionItem>
        <ControlPlaneUrlEditor
          disabled={controlsDisabled}
          hint={t("settings.organization_server_url_hint")}
          label={t("settings.organization_server_url_label")}
          onReset={props.onResetBaseUrlToDefault}
          onSave={props.onApplyBaseUrl}
          onValueChange={props.onBaseUrlDraftChange}
          placeholder={DEFAULT_DEN_BASE_URL}
          resetLabel={t("common.reset")}
          saveDisabled={!isValidControlPlaneUrl(customUrl)}
          saveLabel={t("common.save")}
          value={customUrl}
        />
        <LayoutSectionItemFootnote>
          {currentUrl
            ? t("settings.organization_server_current", { url: currentUrl })
            : t("settings.organization_server_default")}
        </LayoutSectionItemFootnote>
        {isDesktopRuntime() ? <ServerEndpointsCard cloudMcpUrl={props.cloudMcpUrl} /> : null}
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-9">
          <Button
            variant={clearConfirming ? "destructive" : "outline"}
            size="sm"
            onClick={clearServerConfiguration}
            disabled={controlsDisabled}
          >
            {clearConfirming
              ? t("den.cloud_control_plane_clear_confirm")
              : t("den.cloud_control_plane_clear")}
          </Button>
          <span>
            {clearConfirming
              ? t("den.cloud_control_plane_clear_confirm_hint")
              : t("den.cloud_control_plane_clear_hint")}
          </span>
        </div>
        {props.baseUrlError ? <SettingsNotice tone="error">{props.baseUrlError}</SettingsNotice> : null}
      </LayoutSectionItem>
    </LayoutSection>
  );
}

interface RuntimeStatusCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  statusLabel: string;
  tone: SettingsTone;
  detailLines?: string[];
}

function RuntimeStatusCard(props: RuntimeStatusCardProps) {
  return (
    <SettingsInset className="space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-gray-6/60 bg-gray-1/70 text-gray-12">
          {props.icon}
        </div>
        <div>
          <div className="text-sm font-medium text-gray-12">{props.title}</div>
          <div className="text-xs text-gray-9">{props.description}</div>
        </div>
      </div>
      <SettingsStatusBadge className="inline-flex min-h-0 justify-start px-0 py-0" tone={props.tone} label={props.statusLabel} />
      {props.detailLines?.length ? (
        <div className="space-y-1 border-t border-gray-6/50 pt-2 text-[11px] text-gray-9">
          {props.detailLines.map((line) => (
            <div key={line} className="truncate" title={line}>
              {line}
            </div>
          ))}
        </div>
      ) : null}
    </SettingsInset>
  );
}

interface AdvancedRuntimeSectionProps {
  clientStatusLabel: string;
  clientTone: SettingsTone;
  clientDetailLines: string[];
  openworkStatusLabel: string;
  openworkTone: SettingsTone;
  openworkDetailLines: string[];
}

export function AdvancedRuntimeSection(props: AdvancedRuntimeSectionProps) {
  return (
    <LayoutSection>
      <LayoutSectionHeader>
        <LayoutSectionTitle>{t("settings.runtime_title")}</LayoutSectionTitle>
        <LayoutSectionDescription>{t("settings.runtime_desc")}</LayoutSectionDescription>
      </LayoutSectionHeader>

      <div className="grid gap-3 sm:grid-cols-2">
        <RuntimeStatusCard
          icon={<Cpu size={18} />}
          title={t("settings.opencode_engine_label")}
          description={t("settings.opencode_engine_desc")}
          statusLabel={props.clientStatusLabel}
          tone={props.clientTone}
          detailLines={props.clientDetailLines}
        />
        <RuntimeStatusCard
          icon={<Server size={18} />}
          title={t("settings.openwork_server_label")}
          description={t("settings.openwork_server_desc")}
          statusLabel={props.openworkStatusLabel}
          tone={props.openworkTone}
          detailLines={props.openworkDetailLines}
        />
      </div>
    </LayoutSection>
  );
}

function DiagnosticRow(props: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-lg border border-gray-6 bg-gray-2/50 p-2 sm:grid-cols-[12rem_minmax(0,1fr)]">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-8">{props.label}</div>
      <div className="min-w-0 break-all font-mono text-[11px] text-gray-12">{props.value}</div>
    </div>
  );
}

function joinList(values: string[]): string {
  return values.length ? values.join("、") : "无";
}

function formatMaybe(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined || value === "") return "未知";
  if (typeof value === "boolean") return value ? "是" : "否";
  return String(value);
}

function formatMetadataRecord(value: Record<string, string | number | boolean | null> | null | undefined): string {
  if (!value || Object.keys(value).length === 0) return "无";
  return Object.entries(value).map(([key, nested]) => `${key}=${formatMaybe(nested)}`).join("、");
}

function formatSupportedFeatures(features: OpenworkCloudMcpHealth["compatibility"]["supportedFeatures"]): string {
  return Object.entries(features).map(([key, enabled]) => `${key}:${enabled ? "是" : "否"}`).join("、");
}

function formatPluginHashes(hashes: OpenworkCloudMcpHealth["compatibility"]["pluginFileHashes"]): string {
  if (hashes.length === 0) return "无";
  return hashes.map((hash) => `${hash.name}=${hash.sha256 ? hash.sha256.slice(0, 12) : "不可用"}`).join("、");
}

function formatMcpToolExposure(input: { checked: boolean; includesMcpTools: boolean | null; present: string[]; missing: string[]; limitation?: string }): string {
  if (!input.checked) return "未检查";
  const includes = input.includesMcpTools === null ? "未知" : input.includesMcpTools ? "是" : "否";
  return `包含 MCP 工具：${includes}；已有：${joinList(input.present)}；缺少：${joinList(input.missing)}${input.limitation ? `；限制：${input.limitation}` : ""}`;
}

interface AdvancedCloudMcpDiagnosticsSectionProps {
  cloudMcpHealth: OpenworkCloudMcpHealth | null;
  onRefresh: () => Promise<OpenworkCloudMcpHealth | null>;
}

export function AdvancedCloudMcpDiagnosticsSection(props: AdvancedCloudMcpDiagnosticsSectionProps) {
  const [busy, setBusy] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const safeHealth = sanitizeCloudMcpHealthDiagnostic(props.cloudMcpHealth);
  const projection = props.cloudMcpHealth?.tools.providerProjection;
  const compatibility = props.cloudMcpHealth?.compatibility;

  const refresh = async () => {
    setBusy(true);
    setCopyStatus(null);
    try {
      await props.onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    const payload = JSON.stringify({ cloudMcpHealth: safeHealth }, null, 2);
    await navigator.clipboard.writeText(payload);
    setCopyStatus("已复制脱敏后的公司服务诊断信息。");
  };

  return (
    <LayoutSection>
      <LayoutSectionHeader>
        <LayoutSectionTitle>AI 服务权限诊断</LayoutSectionTitle>
        <LayoutSectionDescription>
          查看 FoxWork 公司 MCP 的下发详情。显示或复制前会移除令牌和 Authorization 请求头。
        </LayoutSectionDescription>
      </LayoutSectionHeader>

      <LayoutSectionItem>
        <LayoutSectionItemHeader>
          <LayoutSectionItemTitle>FoxWork 公司 MCP 运行状态</LayoutSectionItemTitle>
          <LayoutSectionItemDescription>
            用于排查具体运行状态；日常连接信息仍在“连接”页面查看。
          </LayoutSectionItemDescription>
          <LayoutSectionItemHeaderActions>
            <Button type="button" variant="outline" size="sm" onClick={() => void refresh()} disabled={busy}>
              <RefreshCcw size={14} className={busy ? "animate-spin" : ""} />
              刷新
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void copy()} disabled={!props.cloudMcpHealth}>
              复制脱敏诊断信息
            </Button>
          </LayoutSectionItemHeaderActions>
        </LayoutSectionItemHeader>

        {copyStatus ? <SettingsNotice>{copyStatus}</SettingsNotice> : null}
        {props.cloudMcpHealth ? (
          <div className="space-y-2 rounded-xl border border-gray-6 bg-gray-1/60 p-3">
            <div className="grid gap-2">
              <DiagnosticRow label="当前工作区" value={`${props.cloudMcpHealth.workspace.id}（${props.cloudMcpHealth.workspace.directory ?? "无目录"}）`} />
              <DiagnosticRow label="目标版本" value={props.cloudMcpHealth.desired.revision ?? "无"} />
              <DiagnosticRow label="已应用版本" value={props.cloudMcpHealth.delivery.appliedRevision ?? "无"} />
              <DiagnosticRow label="下发状态" value={`${props.cloudMcpHealth.delivery.state}${props.cloudMcpHealth.delivery.trigger ? ` / ${props.cloudMcpHealth.delivery.trigger}` : ""}`} />
              <DiagnosticRow label="引擎状态" value={props.cloudMcpHealth.engine.status} />
              <DiagnosticRow label="模型服务 / 模型" value={projection?.checked ? `${projection.provider ?? "未知"}/${projection.model ?? "未知"}；来源：${projection.source ?? "未知"}；工具调用：${formatMaybe(projection.toolCalling)}；已有：${joinList(projection.present)}；缺少：${joinList(projection.missing)}${projection.limitation ? `；限制：${projection.limitation}` : ""}` : "未检查"} />
              <DiagnosticRow label="公司工具" value={`已派生：${joinList(props.cloudMcpHealth.tools.present)}；缺少：${joinList(props.cloudMcpHealth.tools.missing)}`} />
              <DiagnosticRow label="直接工具列表" value={`已有：${joinList(props.cloudMcpHealth.tools.direct.present)}；缺少：${joinList(props.cloudMcpHealth.tools.direct.missing)}`} />
              <DiagnosticRow label="插件探针" value={`已有：${joinList(props.cloudMcpHealth.pluginCanaries.present)}；缺少：${joinList(props.cloudMcpHealth.pluginCanaries.missing)}`} />
              <DiagnosticRow label="受控能力" value={`Schema v${props.cloudMcpHealth.schemaVersion}；连接目录：${props.cloudMcpHealth.connectCatalogEnabled ? "已启用" : "已关闭"}`} />
              {compatibility ? (
                <>
                  <DiagnosticRow label="FoxWork 版本" value={`服务端：${formatMaybe(compatibility.openwork.serverVersion)}；应用：${formatMetadataRecord(compatibility.openwork.app)}`} />
                  <DiagnosticRow label="运行引擎兼容性" value={`预期：${formatMaybe(compatibility.opencode.expectedVersion)}；实际：${formatMaybe(compatibility.opencode.actualVersion)}；探测：${compatibility.opencode.probe}`} />
                  <DiagnosticRow label="功能探针" value={formatSupportedFeatures(compatibility.supportedFeatures)} />
                  <DiagnosticRow label="实验工具 ID" value={formatMcpToolExposure(compatibility.experimentalToolIds)} />
                  <DiagnosticRow label="实验模型服务工具" value={formatMcpToolExposure(compatibility.experimentalProviderTools)} />
                  <DiagnosticRow label="插件哈希" value={formatPluginHashes(compatibility.pluginFileHashes)} />
                </>
              ) : null}
              <DiagnosticRow label="实时检查时间" value={props.cloudMcpHealth.checkedAt} />
            </div>
            <details className="rounded-lg bg-gray-3 p-2">
              <summary className="cursor-pointer text-[11px] font-medium text-gray-11">显示脱敏后的运行状态 JSON</summary>
              <pre className="mt-2 max-h-72 overflow-auto font-mono text-[11px] text-gray-11">
                {JSON.stringify(safeHealth, null, 2)}
              </pre>
            </details>
          </div>
        ) : (
          <SettingsNotice>尚未加载当前工作区的公司 MCP 运行状态。</SettingsNotice>
        )}
      </LayoutSectionItem>
    </LayoutSection>
  );
}

interface AdvancedRuntimeMigrationSectionProps {
  busy: boolean;
  canMigrate: boolean;
  migrationBusy: boolean;
  migrationStatus: string | null;
  configStatus: OpenworkRuntimeConfigStatus | null;
  configStatusBusy: boolean;
  configStatusError: string | null;
  onRefresh: () => Promise<void>;
  onMigrate: () => Promise<void>;
}

function formatKeys(keys: string[]) {
  return keys.length ? keys.join("、") : "无";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizedConfig(config: Record<string, unknown>): Record<string, unknown> {
  return sanitizeDiagnosticRecord(config);
}

function countRecord(value: unknown) {
  return isRecord(value) ? Object.keys(value).length : 0;
}

function countArray(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function providerModelCount(config: Record<string, unknown>) {
  const providers = isRecord(config.provider) ? config.provider : {};
  return Object.values(providers).reduce<number>((total, provider) => {
    if (!isRecord(provider)) return total;
    return total + countRecord(provider.models);
  }, 0);
}

function RuntimeConfigSummary(props: { config: Record<string, unknown> }) {
  const config = props.config;
  const providers = countRecord(config.provider);
  const models = providerModelCount(config);
  const agents = countRecord(config.agent);
  const plugins = countArray(config.plugin);
  const mcps = countRecord(config.mcp);
  const permissions = countRecord(config.permission);
  const disabledProviders = countArray(config.disabled_providers);
  const defaultAgent = typeof config.default_agent === "string" ? config.default_agent : "未设置";

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-lg border border-gray-6 bg-gray-2/60 p-2">
        <div className="text-[10px] tracking-wide text-gray-8">默认 Agent</div>
        <div className="mt-1 truncate font-mono text-[11px] text-gray-12" title={defaultAgent}>{defaultAgent}</div>
      </div>
      <div className="rounded-lg border border-gray-6 bg-gray-2/60 p-2">
        <div className="text-[10px] tracking-wide text-gray-8">模型服务 / 模型</div>
        <div className="mt-1 font-mono text-[11px] text-gray-12">{providers} 个服务，{models} 个模型</div>
      </div>
      <div className="rounded-lg border border-gray-6 bg-gray-2/60 p-2">
        <div className="text-[10px] tracking-wide text-gray-8">Agents / 插件</div>
        <div className="mt-1 font-mono text-[11px] text-gray-12">{agents} 个 Agent，{plugins} 个插件</div>
      </div>
      <div className="rounded-lg border border-gray-6 bg-gray-2/60 p-2">
        <div className="text-[10px] tracking-wide text-gray-8">MCP / 权限</div>
        <div className="mt-1 font-mono text-[11px] text-gray-12">{mcps} 个 MCP，{permissions} 个权限项</div>
      </div>
      {disabledProviders ? (
        <div className="rounded-lg border border-gray-6 bg-gray-2/60 p-2 sm:col-span-2 lg:col-span-4">
          <div className="text-[10px] tracking-wide text-gray-8">已停用的模型服务</div>
          <div className="mt-1 font-mono text-[11px] text-gray-12">{disabledProviders}</div>
        </div>
      ) : null}
    </div>
  );
}

function RuntimeConfigSourceBlock(props: {
  title: string;
  description: string;
  path?: string;
  exists?: boolean;
  keys: string[];
  config: Record<string, unknown>;
}) {
  const safeConfig = sanitizedConfig(props.config);
  return (
    <div className="space-y-2 rounded-xl border border-gray-6 bg-gray-1/70 p-3">
      <div>
        <div className="font-medium text-gray-12">{props.title}</div>
        <div className="text-[11px] text-gray-9">{props.description}</div>
        {props.path ? <div className="mt-1 break-all font-mono text-[11px] text-gray-8">{props.path}</div> : null}
        {props.exists !== undefined ? <div className="text-[11px] text-gray-9">{props.exists ? "已找到" : "未找到"}</div> : null}
        <div className="text-[11px] text-gray-9">配置项：{formatKeys(props.keys)}</div>
      </div>
      <RuntimeConfigSummary config={safeConfig} />
      <details className="rounded-lg bg-gray-3 p-2">
        <summary className="cursor-pointer text-[11px] font-medium text-gray-11">显示原始 JSON</summary>
        <pre className="mt-2 max-h-56 overflow-auto font-mono text-[11px] text-gray-11">
          {JSON.stringify(safeConfig, null, 2)}
        </pre>
      </details>
    </div>
  );
}

export function AdvancedRuntimeMigrationSection(props: AdvancedRuntimeMigrationSectionProps) {
  const effectiveRuntimeConfig = props.configStatus
    ? sanitizedConfig(props.configStatus.effectiveRuntime ?? props.configStatus.runtime)
    : null;
  const runtimeConfig = props.configStatus ? sanitizedConfig(props.configStatus.runtime) : null;
  return (
    <LayoutSection>
      <LayoutSectionHeader>
        <LayoutSectionTitle>运行配置来源</LayoutSectionTitle>
        <LayoutSectionDescription>
          检查 FoxWork 管理的运行配置和工作区自有配置。即使本地运行引擎暂时不可用，也可以查看这些信息。
        </LayoutSectionDescription>
      </LayoutSectionHeader>

      <LayoutSectionItem>
        <LayoutSectionItemHeader>
          <LayoutSectionItemTitle>迁移 FoxWork 管理的配置</LayoutSectionItemTitle>
          <LayoutSectionItemDescription>
            将旧版配置文件中可安全迁移的 FoxWork 配置移入运行时数据库。
          </LayoutSectionItemDescription>
          <LayoutSectionItemHeaderActions>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void props.onRefresh()}
              disabled={props.busy || props.configStatusBusy || !props.canMigrate}
            >
              <RefreshCcw size={14} className={props.configStatusBusy ? "animate-spin" : ""} />
              刷新
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void props.onMigrate()}
              disabled={props.busy || props.migrationBusy || !props.canMigrate}
            >
              <Database size={14} />
              {props.migrationBusy ? "正在迁移…" : "迁移"}
            </Button>
          </LayoutSectionItemHeaderActions>
        </LayoutSectionItemHeader>
        {props.migrationStatus ? <SettingsNotice>{props.migrationStatus}</SettingsNotice> : null}
        {props.configStatusError ? <SettingsNotice>{props.configStatusError}</SettingsNotice> : null}
        {props.configStatus ? (
          <div className="space-y-3 rounded-xl border border-gray-6 bg-gray-1/60 p-3 text-xs text-gray-10">
            <div className="space-y-2 rounded-xl border border-blue-6/50 bg-blue-2/40 p-3">
              <div className="font-medium text-gray-12">FoxWork 目标运行时配置</div>
              <div className="text-[11px] text-gray-9">
                此配置由 FoxWork 生成，写入运行时数据库后由服务端安全注入。敏感请求头会在此处脱敏。
              </div>
              <RuntimeConfigSummary config={effectiveRuntimeConfig ?? {}} />
              <details className="rounded-lg bg-gray-3 p-2">
                <summary className="cursor-pointer text-[11px] font-medium text-gray-11">显示目标 JSON</summary>
                <pre className="mt-2 max-h-72 overflow-auto font-mono text-[11px] text-gray-11">
                  {JSON.stringify(effectiveRuntimeConfig, null, 2)}
                </pre>
              </details>
            </div>
            {props.configStatus.sources ? (
              <div className="space-y-3">
                <div>
                  <div className="font-medium text-gray-12">配置来源明细</div>
                  <div className="text-[11px] text-gray-9">
                    本地运行引擎会读取项目和用户级配置。FoxWork 另行注入受管配置；排查公司管理项时，以注入配置为准。
                  </div>
                </div>
                <RuntimeConfigSourceBlock
                  title="项目高级配置"
                  description="由员工或项目维护的工作区级运行配置。"
                  exists={props.configStatus.sources.projectOpencode.exists}
                  keys={props.configStatus.sources.projectOpencode.keys}
                  config={props.configStatus.sources.projectOpencode.config}
                />
                <RuntimeConfigSourceBlock
                  title="用户级高级配置"
                  description="适用于当前员工全部本地工作区的运行配置。"
                  exists={props.configStatus.sources.globalOpencode.exists}
                  keys={props.configStatus.sources.globalOpencode.keys}
                  config={props.configStatus.sources.globalOpencode.config}
                />
                <RuntimeConfigSourceBlock
                  title="FoxWork 运行时数据库"
                  description="保存在工作区文件之外、由 FoxWork 管理的运行时配置。"
                  keys={props.configStatus.sources.runtimeDatabase.keys}
                  config={props.configStatus.sources.runtimeDatabase.config}
                />
                <RuntimeConfigSourceBlock
                  title="FoxWork 注入配置"
                  description="FoxWork 注入本地运行引擎的受管配置。"
                  keys={props.configStatus.sources.injected.keys}
                  config={props.configStatus.sources.injected.config}
                />
              </div>
            ) : null}
            <div>
              <div className="font-medium text-gray-12">运行时数据库</div>
              <div>已存配置项：{formatKeys(props.configStatus.runtimeKeys)}</div>
            </div>
            <div>
              <div className="font-medium text-gray-12">旧版 FoxWork 元数据</div>
              {props.configStatus.legacyOpenwork.error ? (
                <div className="text-amber-11">旧配置文件存在错误，请先修复后再迁移。</div>
              ) : null}
              <div>可迁移配置项：{formatKeys(props.configStatus.legacyOpenwork.keys)}</div>
            </div>
            <div>
              <div className="font-medium text-gray-12">员工自有高级配置</div>
              <div>{props.configStatus.userOpencode.exists ? "已找到" : "未找到"}</div>
              <div>员工自有配置项：{formatKeys(props.configStatus.userOpencode.keys)}</div>
              <div>可迁移配置项：{formatKeys(props.configStatus.userOpencode.migratableKeys)}</div>
            </div>
            <div>
              <div className="font-medium text-gray-12">运行时数据库 JSON</div>
              <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-gray-3 p-2 font-mono text-[11px] text-gray-11">
                {JSON.stringify(runtimeConfig, null, 2)}
              </pre>
            </div>
          </div>
        ) : null}
      </LayoutSectionItem>
    </LayoutSection>
  );
}

interface AdvancedOpencodeSectionProps {
  busy: boolean;
  enabled: boolean;
  onToggle: () => void;
}

export function AdvancedOpencodeSection(props: AdvancedOpencodeSectionProps) {
  return (
    <LayoutSection>
      <LayoutSectionHeader>
        <LayoutSectionTitle>
          {t("settings.opencode_section_label")}
        </LayoutSectionTitle>
        <LayoutSectionDescription>{t("settings.opencode_engine_desc")}</LayoutSectionDescription>
      </LayoutSectionHeader>

      <LayoutSectionItem>
        <LayoutSectionItemHeader>
          <LayoutSectionItemTitle>{t("settings.enable_exa")}</LayoutSectionItemTitle>
          <LayoutSectionItemDescription>{t("settings.enable_exa_desc")}</LayoutSectionItemDescription>
          <LayoutSectionItemHeaderActions>
            <Switch
              aria-label={t("settings.enable_exa")}
              checked={props.enabled}
              disabled
              onCheckedChange={props.onToggle}
            />
          </LayoutSectionItemHeaderActions>
        </LayoutSectionItemHeader>
        <Alert>
          <Info />
          <AlertDescription>{t("settings.exa_unavailable")}</AlertDescription>
        </Alert>
        <LayoutSectionItemFootnote>{t("settings.exa_restart_hint")}</LayoutSectionItemFootnote>
      </LayoutSectionItem>
    </LayoutSection>
  );
}

interface AdvancedFeatureFlagsSectionProps {
  busy: boolean;
  microsandboxCreateSandboxEnabled: boolean;
  onToggleMicrosandboxCreateSandbox: () => void;
}

export function AdvancedFeatureFlagsSection(props: AdvancedFeatureFlagsSectionProps) {
  return (
    <LayoutSection>
      <LayoutSectionHeader>
        <LayoutSectionTitle>实验功能</LayoutSectionTitle>
        <LayoutSectionDescription>控制沙箱和工作区的实验行为。</LayoutSectionDescription>
      </LayoutSectionHeader>

      <LayoutSectionItem>
        <LayoutSectionItemHeader>
          <LayoutSectionItemTitle>创建沙箱时使用 microsandbox 镜像</LayoutSectionItemTitle>
          <LayoutSectionItemDescription>
            启用后，“创建沙箱”会使用 microsandbox 镜像启动独立 Worker，而不使用默认 Docker 镜像流程。
          </LayoutSectionItemDescription>
          <LayoutSectionItemHeaderActions>
            <Switch
              aria-label="创建沙箱时使用 microsandbox 镜像"
              checked={props.microsandboxCreateSandboxEnabled}
              disabled={props.busy || !isDesktopRuntime()}
              onCheckedChange={props.onToggleMicrosandboxCreateSandbox}
            />
          </LayoutSectionItemHeaderActions>
        </LayoutSectionItemHeader>
      </LayoutSectionItem>
    </LayoutSection>
  );
}

interface AdvancedDeveloperSectionProps {
  busy: boolean;
  developerMode: boolean;
  opencodeDevModeEnabled: boolean;
  deepLinkOpen: boolean;
  deepLinkInput: string;
  deepLinkBusy: boolean;
  deepLinkStatus: string | null;
  onToggleDeveloperMode: () => void;
  onToggleDeepLink: () => void;
  onDeepLinkInput: (input: string) => void;
  onSubmitDeepLink: () => Promise<void>;
}

export function AdvancedDeveloperSection(props: AdvancedDeveloperSectionProps) {
  return (
    <LayoutSection>
      <LayoutSectionHeader>
        <LayoutSectionTitle>{t("settings.developer")}</LayoutSectionTitle>
      </LayoutSectionHeader>

      <LayoutSectionItem>
        <LayoutSectionItemHeader>
          <LayoutSectionItemTitle>{t("settings.developer_mode_title")}</LayoutSectionItemTitle>
          <LayoutSectionItemDescription>{t("settings.developer_mode_desc")}</LayoutSectionItemDescription>
          <LayoutSectionItemHeaderActions>
            <Switch
              aria-label={t("settings.developer_mode_title")}
              checked={props.developerMode}
              onCheckedChange={props.onToggleDeveloperMode}
            />
          </LayoutSectionItemHeaderActions>
        </LayoutSectionItemHeader>
      </LayoutSectionItem>

      {isDesktopRuntime() && props.opencodeDevModeEnabled && props.developerMode ? (
        <LayoutSectionItem>
          <LayoutSectionItemHeader>
            <LayoutSectionItemTitle>{t("settings.open_deeplink_title")}</LayoutSectionItemTitle>
            <LayoutSectionItemDescription>{t("settings.open_deeplink_desc")}</LayoutSectionItemDescription>
            <LayoutSectionItemHeaderActions>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={props.onToggleDeepLink}
                disabled={props.busy || props.deepLinkBusy}
              >
                {props.deepLinkOpen ? t("common.hide") : t("settings.open_deeplink_button")}
              </Button>
            </LayoutSectionItemHeaderActions>
          </LayoutSectionItemHeader>

          {props.deepLinkOpen ? (
            <div className="space-y-3">
              <Field>
                <FieldLabel htmlFor="advanced-debug-deep-link">{t("settings.open_deeplink_title")}</FieldLabel>
                <Textarea
                  id="advanced-debug-deep-link"
                  value={props.deepLinkInput}
                  onChange={(event) => props.onDeepLinkInput(event.currentTarget.value)}
                  rows={3}
                  placeholder="foxwork://...（仅供调试）"
                  className="font-mono text-xs"
                />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void props.onSubmitDeepLink()}
                  disabled={props.busy || props.deepLinkBusy || !props.deepLinkInput.trim()}
                >
                  {props.deepLinkBusy ? t("settings.opening") : t("settings.open_deeplink_action")}
                </Button>
                <div className="text-xs text-gray-8">{t("settings.deeplink_hint")}</div>
              </div>
            </div>
          ) : null}

          {props.deepLinkStatus ? <SettingsNotice>{props.deepLinkStatus}</SettingsNotice> : null}
        </LayoutSectionItem>
      ) : null}
    </LayoutSection>
  );
}

interface AdvancedConnectionSectionProps {
  busy: boolean;
  headerStatus: string;
  baseUrl: string;
  openworkServerUrl: string;
  openworkServerStatus: OpenworkServerStatus;
  openworkReconnectBusy: boolean;
  isLocalEngineRunning: boolean;
  restartBusy: boolean;
  reconnectStatus: string | null;
  reconnectError: string | null;
  restartStatus: string | null;
  restartError: string | null;
  onReconnect: () => Promise<void>;
  onRestart: () => Promise<void>;
  onStopHost: () => void;
}

export function AdvancedConnectionSection(props: AdvancedConnectionSectionProps) {
  return (
    <LayoutSection>
      <LayoutSectionHeader>
        <LayoutSectionTitle>{t("settings.connection_title")}</LayoutSectionTitle>
        <LayoutSectionDescription>{props.headerStatus}</LayoutSectionDescription>
      </LayoutSectionHeader>

      <LayoutSectionItem className="gap-3">
        <div className="break-all font-mono text-xs text-gray-8">{props.baseUrl}</div>
        <div className="flex flex-wrap gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void props.onReconnect()}
            disabled={props.busy || props.openworkReconnectBusy || !props.openworkServerUrl.trim()}
          >
            <RefreshCcw size={14} className={props.openworkReconnectBusy ? "animate-spin" : ""} />
            {props.openworkReconnectBusy ? t("settings.reconnecting") : t("settings.reconnect_server")}
          </Button>

          {props.isLocalEngineRunning ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void props.onRestart()}
              disabled={props.busy || props.restartBusy}
            >
              <RefreshCcw size={14} className={props.restartBusy ? "animate-spin" : ""} />
              {props.restartBusy ? t("settings.restarting") : t("settings.restart_openwork_server")}
            </Button>
          ) : null}

          {props.isLocalEngineRunning ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={props.onStopHost}
              disabled={props.busy}
            >
              <CircleAlert size={14} />
              {t("settings.stop_local_server")}
            </Button>
          ) : null}

          {!props.isLocalEngineRunning && props.openworkServerStatus === "connected" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={props.onStopHost}
              disabled={props.busy}
            >
              {t("settings.disconnect_server")}
            </Button>
          ) : null}
        </div>

        {props.reconnectStatus ? <SettingsNotice>{props.reconnectStatus}</SettingsNotice> : null}
        {props.reconnectError ? <SettingsNotice tone="error">{props.reconnectError}</SettingsNotice> : null}
        {props.restartStatus ? <SettingsNotice>{props.restartStatus}</SettingsNotice> : null}
        {props.restartError ? <SettingsNotice tone="error">{props.restartError}</SettingsNotice> : null}
      </LayoutSectionItem>
    </LayoutSection>
  );
}
