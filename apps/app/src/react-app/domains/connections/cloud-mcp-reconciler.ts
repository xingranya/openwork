import {
  type DenMcpToken,
  type DenMcpTokenMintContext,
  resolveCloudMcpResourceUrl,
} from "../../../app/lib/den";
import { FOXWORK_COMPANY_MCP_EXPECTED_TOOLS } from "@openwork/types/den/mcp-connection-action";
import type {
  OpenworkCloudMcpEngineRefresh,
  OpenworkCloudMcpEngineRefreshResult,
  OpenworkCloudMcpFailure,
  OpenworkCloudMcpHealth,
  OpenworkCloudMcpProviderModelContext,
  OpenworkCloudMcpReconcilePayload,
} from "../../../app/lib/openwork-server";
import {
  CLOUD_MCP_SERVER_NAME,
  LEGACY_CLOUD_MCP_SERVER_NAME,
  clearCloudMcpScopedMetadata,
  clearCloudMcpUserState,
  getCloudMcpScopeKey,
  isCloudMcpSyncMarkerFresh,
  normalizeCloudMcpScope,
  readCloudMcpSyncMarker,
  readCloudMcpUserState,
  writeCloudMcpSyncMarker,
  writeCloudMcpUserState,
  type CloudMcpScope,
  type CloudMcpUserState,
} from "./cloud-mcp-user-state";

export const OPENWORK_CLOUD_EXPECTED_TOOLS = [...FOXWORK_COMPANY_MCP_EXPECTED_TOOLS];

export type CloudMcpClient = {
  baseUrl: string;
  getOpenworkCloudMcpHealth: (
    workspaceId: string,
    providerModel?: OpenworkCloudMcpProviderModelContext,
    options?: { probe?: boolean },
  ) => Promise<OpenworkCloudMcpHealth>;
  reconcileOpenworkCloudMcp: (
    workspaceId: string,
    payload: OpenworkCloudMcpReconcilePayload,
  ) => Promise<OpenworkCloudMcpHealth>;
  refreshOpenworkCloudMcpEngine?: (
    workspaceId: string,
    payload?: { provider?: string; model?: string; trigger?: string },
  ) => Promise<OpenworkCloudMcpEngineRefreshResult>;
};

export type CloudMcpOperationContext = CloudMcpScope & {
  denAuthToken: string | null;
  orgSlug?: string | null;
  orgName?: string | null;
  fallbackUrl?: string | null;
  providerModel?: OpenworkCloudMcpProviderModelContext;
  connectCatalogEnabled?: boolean;
  trigger?: string;
};

export type CloudMcpOperationMode = "health" | "repair";

export type CloudMcpOperationResult = {
  status: "checked" | "ready" | "repaired" | "unchanged" | "skipped" | "failed";
  health: OpenworkCloudMcpHealth | null;
  skippedReason?: "signed_out" | "missing_org" | "missing_workspace" | "disabled" | "deduped" | "mint_failed";
  attempts: number;
  markerWritten: boolean;
  reminted: boolean;
};

export type CloudMcpMainStatus = "ready" | "connecting" | "disabled" | "degraded" | "signed_out";

export type CloudMcpDisplaySummary = {
  status: CloudMcpMainStatus;
  statusLabel: "已就绪" | "正在连接" | "已关闭" | "需要处理" | "未登录";
  tone: "ready" | "warning" | "neutral" | "error";
  stageLabel: string;
  recommendedAction: string;
};

type MintCloudMcpToken = (context: DenMcpTokenMintContext) => Promise<DenMcpToken | null>;

type CloudMcpReconcilerInput = {
  mode: CloudMcpOperationMode;
  client: CloudMcpClient;
  context: CloudMcpOperationContext;
  mintToken: MintCloudMcpToken;
  force?: boolean;
  refreshMarginMs: number;
  now?: number;
  configuredEnabled?: boolean | null;
  /**
   * Ask the SeeWayWork server to also verify the Cloud endpoint directly
   * (initialize + tools/list outside the engine). Only meaningful for
   * mode "health"; repair reconciles always probe on the server.
   */
  probe?: boolean;
};

type OpenCodeDisconnectClient = {
  mcp: {
    disconnect: (input: { directory: string; name: string }) => Promise<unknown>;
  };
};

type CleanupClient = {
  baseUrl: string;
  removeMcp: (workspaceId: string, name: string) => Promise<unknown>;
};

const repairInFlight = new Map<string, Promise<CloudMcpOperationResult>>();

const APP_VERSION = String(import.meta.env.VITE_OPENWORK_APP_VERSION ?? "").trim();
const APP_BUILD_SHA = String(import.meta.env.VITE_OPENWORK_BUILD_SHA ?? import.meta.env.VITE_OPENWORK_GIT_SHA ?? "").trim();

function normalizeCode(code: string | null | undefined): string {
  return code?.trim().toLowerCase().replace(/[-.]/g, "_") ?? "";
}

function isProviderProjectionFailure(failure?: OpenworkCloudMcpFailure | null): boolean {
  if (!failure) return false;
  if (failure.stage === "provider_projection") return true;
  const code = normalizeCode(failure.code);
  if (
    code === "provider_tool_projection_missing" ||
    code === "provider_projection_missing" ||
    code === "provider_projection_unavailable"
  ) {
    return true;
  }
  return code.includes("provider_projection") || code.includes("provider_tool_projection");
}

function normalizedContextScope(context: CloudMcpOperationContext): CloudMcpScope | null {
  return normalizeCloudMcpScope({
    denBaseUrl: context.denBaseUrl,
    serverBaseUrl: context.serverBaseUrl,
    orgId: context.orgId,
    workspaceId: context.workspaceId,
  });
}

function tokenMetadata(token: DenMcpToken): Record<string, string | number | boolean | null> {
  return {
    organizationId: token.organizationId,
    expiresAt: token.expiresAt,
    resource: token.resource,
    scopes: token.scopes.join(" "),
  };
}

function orgMetadata(context: CloudMcpOperationContext): Record<string, string | number | boolean | null> {
  return {
    id: context.orgId.trim(),
    slug: context.orgSlug?.trim() || null,
    name: context.orgName?.trim() || null,
  };
}

function appMetadata(): Record<string, string | number | boolean | null> | undefined {
  const metadata: Record<string, string | number | boolean | null> = {};
  if (APP_VERSION) metadata.version = APP_VERSION;
  if (APP_BUILD_SHA) metadata.buildSha = APP_BUILD_SHA;
  return Object.keys(metadata).length ? metadata : undefined;
}

function resolveMcpUrl(token: DenMcpToken, fallbackUrl?: string | null): string | null {
  const healedResource = resolveCloudMcpResourceUrl(token.resource);
  if (healedResource) return `${healedResource}/agent`;
  const fallback = fallbackUrl?.trim() ?? "";
  return fallback || null;
}

export function buildOpenworkCloudMcpReconcilePayload(input: {
  context: CloudMcpOperationContext;
  token: DenMcpToken;
}): OpenworkCloudMcpReconcilePayload | null {
  const workspaceId = input.context.workspaceId.trim();
  const url = resolveMcpUrl(input.token, input.context.fallbackUrl);
  if (!workspaceId || !url) return null;
  const app = appMetadata();
  return {
    workspaceId,
    name: CLOUD_MCP_SERVER_NAME,
    config: {
      type: "remote",
      enabled: true,
      url,
      headers: { Authorization: `Bearer ${input.token.token}` },
      oauth: false,
    },
    tokenMetadata: tokenMetadata(input.token),
    org: orgMetadata(input.context),
    ...(app ? { app, appVersion: typeof app.version === "string" ? app.version : undefined, buildSha: typeof app.buildSha === "string" ? app.buildSha : undefined } : {}),
    connectCatalogEnabled: input.context.connectCatalogEnabled ?? true,
    trigger: input.context.trigger ?? "desktop-repair",
    ...(input.context.providerModel ? {
      provider: input.context.providerModel.provider,
      model: input.context.providerModel.model,
    } : {}),
  };
}

export function isCloudMcpAuthTokenFailureCode(code: string | null | undefined): boolean {
  const normalized = normalizeCode(code);
  if (!normalized) return false;
  if (
    normalized.includes("membership") ||
    normalized.includes("scope") ||
    normalized.includes("policy") ||
    normalized.includes("forbidden") ||
    normalized.includes("resource") ||
    normalized.includes("not_found") ||
    normalized.includes("client_registration")
  ) {
    return false;
  }
  return normalized === "openwork_cloud_auth_required" ||
    normalized === "openwork_cloud_auth_invalid" ||
    normalized === "openwork_cloud_token_expired" ||
    // The Den rejects an expired/missing first-party bearer with exactly these
    // codes; the `_mcp_` infix means the `invalid_token` substring below never
    // matches them (field incident: token sat expired for 7 days because the
    // remint retry never fired).
    normalized === "invalid_mcp_token" ||
    normalized === "missing_mcp_token" ||
    normalized.includes("invalid_token") ||
    normalized.includes("unauthorized") ||
    normalized.includes("expired") ||
    normalized.includes("auth");
}

/**
 * Health failures carry the primary `code` plus optional `aliases` (e.g. the
 * direct-probe 401 reports code `invalid_mcp_token` with alias
 * `openwork_cloud_token_expired`). Remint decisions must consider both.
 */
export function isCloudMcpAuthTokenFailure(failure: Pick<OpenworkCloudMcpFailure, "code" | "aliases"> | null | undefined): boolean {
  if (!failure) return false;
  if (isCloudMcpAuthTokenFailureCode(failure.code)) return true;
  return (failure.aliases ?? []).some((alias) => isCloudMcpAuthTokenFailureCode(alias));
}

function shouldSkipForPrerequisite(input: CloudMcpReconcilerInput, scope: CloudMcpScope): CloudMcpOperationResult | null {
  if (!scope.workspaceId) return { status: "skipped", health: null, skippedReason: "missing_workspace", attempts: 0, markerWritten: false, reminted: false };
  if (input.mode === "health") return null;
  if (!input.context.denAuthToken?.trim()) return { status: "skipped", health: null, skippedReason: "signed_out", attempts: 0, markerWritten: false, reminted: false };
  if (!scope.orgId) return { status: "skipped", health: null, skippedReason: "missing_org", attempts: 0, markerWritten: false, reminted: false };
  if (input.configuredEnabled === false) {
    return { status: "skipped", health: null, skippedReason: "disabled", attempts: 0, markerWritten: false, reminted: false };
  }
  // Recorded user intent only blocks provisioning (entry absent/unknown). A
  // known-enabled entry must keep its token fresh even when a stale
  // disabled/removed intent is still recorded.
  if (input.configuredEnabled !== true && readCloudMcpUserState(scope) !== null) {
    return { status: "skipped", health: null, skippedReason: "disabled", attempts: 0, markerWritten: false, reminted: false };
  }
  return null;
}

function writeUsableMarker(input: {
  health: OpenworkCloudMcpHealth | null;
  scope: CloudMcpScope;
  expiresAt: string | null;
}): boolean {
  if (!input.health?.usable || !input.expiresAt) return false;
  writeCloudMcpSyncMarker({ ...input.scope, expiresAt: input.expiresAt });
  return true;
}

async function probeHealth(input: CloudMcpReconcilerInput, scope: CloudMcpScope, options?: { writeFreshnessMarker?: boolean }): Promise<CloudMcpOperationResult> {
  const health = await input.client.getOpenworkCloudMcpHealth(
    scope.workspaceId,
    input.context.providerModel,
    input.probe ? { probe: true } : undefined,
  );
  const marker = options?.writeFreshnessMarker ? readCloudMcpSyncMarker(scope) : null;
  const markerWritten = options?.writeFreshnessMarker === true
    ? writeUsableMarker({ health, scope, expiresAt: marker?.expiresAt ?? null })
    : false;
  return {
    status: health.usable ? "ready" : "checked",
    health,
    attempts: 0,
    markerWritten,
    reminted: false,
  };
}

async function mintAndPost(input: CloudMcpReconcilerInput, scope: CloudMcpScope): Promise<{ health: OpenworkCloudMcpHealth | null; token: DenMcpToken | null }> {
  const token = await input.mintToken({
    baseUrl: scope.denBaseUrl,
    authToken: input.context.denAuthToken,
    orgId: scope.orgId,
  });
  if (!token) return { health: null, token: null };
  const payload = buildOpenworkCloudMcpReconcilePayload({ context: { ...input.context, ...scope }, token });
  if (!payload) return { health: null, token };
  return {
    health: await input.client.reconcileOpenworkCloudMcp(scope.workspaceId, payload),
    token,
  };
}

async function repairCloudMcp(input: CloudMcpReconcilerInput, scope: CloudMcpScope): Promise<CloudMcpOperationResult> {
  if (!input.force) {
    const healthResult = await probeHealth(input, scope, { writeFreshnessMarker: true });
    if (healthResult.health?.usable) return { ...healthResult, status: "unchanged" };
  }

  const marker = readCloudMcpSyncMarker(scope);
  if (!input.force && marker && isCloudMcpSyncMarkerFresh({
    expiresAt: marker.expiresAt,
    now: input.now ?? Date.now(),
    refreshMarginMs: input.refreshMarginMs,
  })) {
    const health = await input.client.getOpenworkCloudMcpHealth(scope.workspaceId, input.context.providerModel);
    if (health.usable) return { status: "unchanged", health, attempts: 0, markerWritten: false, reminted: false };
  }

  const first = await mintAndPost(input, scope);
  if (!first.token) {
    return { status: "skipped", health: null, skippedReason: "mint_failed", attempts: 1, markerWritten: false, reminted: false };
  }

  let attempts = 1;
  let health = first.health;
  let token = first.token;
  let reminted = false;
  if (isCloudMcpAuthTokenFailure(health?.firstFailure)) {
    const second = await mintAndPost(input, scope);
    attempts += 1;
    reminted = true;
    if (second.token) token = second.token;
    if (second.health) health = second.health;
  }

  const markerWritten = writeUsableMarker({ health, scope, expiresAt: token.expiresAt });
  return {
    status: health?.usable ? "repaired" : "failed",
    health,
    attempts,
    markerWritten,
    reminted,
  };
}

export async function runOpenworkCloudMcpReconciler(input: CloudMcpReconcilerInput): Promise<CloudMcpOperationResult> {
  const scope = normalizedContextScope(input.context);
  if (!scope) return { status: "skipped", health: null, skippedReason: "missing_workspace", attempts: 0, markerWritten: false, reminted: false };
  const prerequisite = shouldSkipForPrerequisite(input, scope);
  if (prerequisite) return prerequisite;

  if (input.mode === "health") return probeHealth(input, scope);

  const scopeKey = getCloudMcpScopeKey(scope);
  if (!scopeKey) return { status: "skipped", health: null, skippedReason: "missing_workspace", attempts: 0, markerWritten: false, reminted: false };
  const existing = repairInFlight.get(scopeKey);
  if (existing) return existing;
  const task = repairCloudMcp(input, scope).finally(() => {
    repairInFlight.delete(scopeKey);
  });
  repairInFlight.set(scopeKey, task);
  return task;
}

export type CloudMcpEngineRefreshRunResult = {
  status: "refreshed" | "failed" | "skipped";
  skippedReason?: "missing_workspace" | "unsupported";
  health: OpenworkCloudMcpHealth | null;
  refresh: OpenworkCloudMcpEngineRefresh | null;
};

const engineRefreshInFlight = new Map<string, Promise<CloudMcpEngineRefreshRunResult>>();

/**
 * Force the engine to drop its openwork-cloud MCP client and reconnect.
 * OpenCode keeps a failed MCP failed forever (no automatic retry), so this is
 * the explicit "try again from scratch" lever: engine disconnect, then
 * re-registration from the persisted desired config, then a direct probe.
 */
export async function runOpenworkCloudMcpEngineRefresh(input: {
  client: CloudMcpClient;
  context: CloudMcpOperationContext;
}): Promise<CloudMcpEngineRefreshRunResult> {
  const scope = normalizedContextScope(input.context);
  if (!scope?.workspaceId) {
    return { status: "skipped", skippedReason: "missing_workspace", health: null, refresh: null };
  }
  const refreshEngine = input.client.refreshOpenworkCloudMcpEngine;
  if (!refreshEngine) {
    return { status: "skipped", skippedReason: "unsupported", health: null, refresh: null };
  }
  const scopeKey = getCloudMcpScopeKey(scope);
  if (!scopeKey) {
    return { status: "skipped", skippedReason: "missing_workspace", health: null, refresh: null };
  }
  const existing = engineRefreshInFlight.get(scopeKey);
  if (existing) return existing;
  const task = (async (): Promise<CloudMcpEngineRefreshRunResult> => {
    const providerModel = input.context.providerModel;
    const result = await refreshEngine(scope.workspaceId, {
      ...(providerModel ? { provider: providerModel.provider, model: providerModel.model } : {}),
      trigger: input.context.trigger ?? "desktop-engine-refresh",
    });
    return {
      status: result.health.usable ? "refreshed" : "failed",
      health: result.health,
      refresh: result.refresh,
    };
  })().finally(() => {
    engineRefreshInFlight.delete(scopeKey);
  });
  engineRefreshInFlight.set(scopeKey, task);
  return task;
}

export function cloudMcpFailureStageLabel(input: {
  signedIn: boolean;
  orgSelected: boolean;
  userState?: CloudMcpUserState | null;
  health?: OpenworkCloudMcpHealth | null;
}): string {
  if (!input.signedIn) return "需要登录";
  if (!input.orgSelected) return "请选择公司";
  if (input.userState) return "AI 服务权限已关闭";
  if (!input.health) return "尚未完成 AI 服务权限检查";
  const code = normalizeCode(input.health?.firstFailure?.code);
  if (!code) return input.health?.usableByCurrentModel === null ? "尚未检查当前模型权限" : "AI 服务权限已就绪";
  if (code === "cloud_mcp_disabled" || code === "cloud_disabled") return "AI 服务权限已关闭";
  if (code === "cloud_desired_missing" || code === "cloud_mcp_missing") return "无法为当前工作区启用公司服务";
  if (code.includes("auth") || code.includes("token") || code.includes("unauthorized")) return "公司登录状态已过期";
  if (code === "cloud_tools_missing") return "公司服务缺少所需工具";
  if (code === "cloud_status_missing" || code === "cloud_registration_failed") return "公司工具尚未完成注册";
  if (isProviderProjectionFailure(input.health?.firstFailure)) return "当前模型不能使用公司工具";
  if (code.includes("tool_ids") || code.includes("client_registration")) return "SeeWayWork 组件需要更新";
  if (code === "extensions_plugin_missing") return "AI 工作说明需要更新";
  if (code.includes("unreachable") || code.includes("connection") || code.includes("status_missing")) return "公司服务暂时无法连接";
  return "无法为当前工作区启用公司服务";
}

export function cloudMcpRecommendedAction(input: {
  signedIn: boolean;
  orgSelected: boolean;
  userState?: CloudMcpUserState | null;
  health?: OpenworkCloudMcpHealth | null;
}): string {
  if (!input.signedIn) return "请登录 SeeWayWork 公司服务。";
  if (!input.orgSelected) return "请选择 AI 要使用的公司。";
  if (input.userState) return "如需使用已连接服务，请启用 AI 权限，或执行“修复并检查”。";
  if (!input.health) return "请重新检查 AI 服务权限。";
  const code = normalizeCode(input.health?.firstFailure?.code);
  if (!code) {
    if (input.health?.usableByCurrentModel === null) return "尚未选择当前模型，因此未检查模型权限。";
    return "无需操作。";
  }
  if (code === "cloud_mcp_disabled" || code === "cloud_disabled") return "如需使用已连接服务，请启用 AI 权限，或执行“修复并检查”。";
  if (code === "cloud_desired_missing" || code === "cloud_mcp_missing") return "请执行“修复并检查”，为当前工作区启用 AI 权限。";
  if (code.includes("auth") || code.includes("token") || code.includes("unauthorized")) return "请执行“修复并检查”，刷新公司登录状态。";
  if (code.includes("membership")) return "请联系公司管理员授予权限。";
  if (code.includes("scope")) return "请重新连接公司服务并授予所需权限。";
  if (code.includes("policy") || code.includes("forbidden") || code.includes("resource")) return "请检查公司策略和资源权限。";
  if (isProviderProjectionFailure(input.health?.firstFailure)) return "请选择能够使用公司工具的模型。";
  if (code.includes("tool_ids") || code.includes("client_registration")) return "请更新 SeeWayWork 后重试。";
  if (code === "extensions_plugin_missing") return "请重新加载 AI，让工作说明更新到当前版本。";
  if (code === "cloud_tools_missing") return "请重新连接公司服务，让所需工具完成注册。";
  if (code === "cloud_status_missing" || code === "cloud_registration_failed") return "请执行“修复并检查”，完成公司工具注册。";
  return "请执行“修复并检查”；如果仍然失败，请在高级设置中查看诊断信息。";
}

export function cloudMcpDisplaySummary(input: {
  signedIn: boolean;
  orgSelected: boolean;
  connecting: boolean;
  userState?: CloudMcpUserState | null;
  health?: OpenworkCloudMcpHealth | null;
}): CloudMcpDisplaySummary {
  if (input.connecting) {
    return {
      status: "connecting",
      statusLabel: "正在连接",
      tone: "warning",
      stageLabel: "公司服务暂时无法连接",
      recommendedAction: "正在检查 AI 服务权限。",
    };
  }
  if (!input.signedIn) {
    return {
      status: "signed_out",
      statusLabel: "未登录",
      tone: "neutral",
      stageLabel: cloudMcpFailureStageLabel(input),
      recommendedAction: cloudMcpRecommendedAction(input),
    };
  }
  const code = normalizeCode(input.health?.firstFailure?.code);
  const configEnabled = input.health?.desired.config?.enabled;
  const disabled = input.userState || code === "cloud_mcp_disabled" || code === "cloud_disabled" || configEnabled === false;
  if (disabled) {
    return {
      status: "disabled",
      statusLabel: "已关闭",
      tone: "neutral",
      stageLabel: cloudMcpFailureStageLabel(input),
      recommendedAction: cloudMcpRecommendedAction(input),
    };
  }
  if (input.health?.usable) {
    return {
      status: "ready",
      statusLabel: "已就绪",
      tone: "ready",
      stageLabel: cloudMcpFailureStageLabel(input),
      recommendedAction: cloudMcpRecommendedAction(input),
    };
  }
  return {
    status: "degraded",
    statusLabel: "需要处理",
    tone: "error",
    stageLabel: cloudMcpFailureStageLabel(input),
    recommendedAction: cloudMcpRecommendedAction(input),
  };
}

export async function cleanupOpenworkCloudMcpAfterSignOut(input: {
  context: CloudMcpScope;
  openworkClient: CleanupClient | null;
  opencodeClient: OpenCodeDisconnectClient | null;
  directory: string;
}): Promise<void> {
  const scope = normalizeCloudMcpScope(input.context);
  const workspaceId = input.context.workspaceId.trim();
  if (scope) clearCloudMcpScopedMetadata(scope);

  await Promise.all([
    ...(input.openworkClient && workspaceId
      ? [
          input.openworkClient.removeMcp(workspaceId, CLOUD_MCP_SERVER_NAME).catch(() => null),
          input.openworkClient.removeMcp(workspaceId, LEGACY_CLOUD_MCP_SERVER_NAME).catch(() => null),
        ]
      : []),
    ...(input.opencodeClient && input.directory.trim()
      ? [
          input.opencodeClient.mcp.disconnect({ directory: input.directory.trim(), name: CLOUD_MCP_SERVER_NAME }).catch(() => null),
          input.opencodeClient.mcp.disconnect({ directory: input.directory.trim(), name: LEGACY_CLOUD_MCP_SERVER_NAME }).catch(() => null),
        ]
      : []),
  ]);
}

export function recordCloudMcpDisabledIntent(scope: CloudMcpScope, state: CloudMcpUserState): void {
  writeCloudMcpUserState(state, scope);
  clearCloudMcpScopedMetadata(scope);
}

export function clearCloudMcpDisabledIntent(scope: CloudMcpScope): void {
  clearCloudMcpUserState(scope);
}
