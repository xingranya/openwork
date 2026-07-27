import { z } from "zod";
import {
  FOXWORK_COMPANY_MCP_EXPECTED_TOOLS,
  FOXWORK_COMPANY_MCP_NAME,
  LEGACY_OPENWORK_CLOUD_MCP_NAME,
} from "@openwork/types/den/mcp-connection-action";

export type OpenCodeContext = {
  agent?: string;
  sessionID?: string;
  messageID?: string;
  directory?: string;
  worktree?: string;
  workspaceId?: string;
  workspaceID?: string;
};

export type OpenWorkExtensionConnectState = {
  connectEnabled: boolean;
  connectCatalogEnabled: boolean;
  cloudMcpPresent: boolean;
  cloudHealth: OpenWorkCloudHealthSummary | null;
  workspace?: {
    resolution?: string;
    id?: string | null;
    directory?: string | null;
    reason?: string;
  };
  googleWorkspace: {
    legacyConfigured: boolean;
  };
};

export type OpenWorkCloudHealthSummary = {
  usable: boolean;
  usableByCurrentModel: boolean | null;
  phase: string;
  connectCatalogEnabled?: boolean;
  workspace: {
    id: string;
    directory: string | null;
  };
  desired: {
    present: boolean;
    revision: string | null;
  };
  delivery?: {
    appliedRevision?: string | null;
  };
  engine?: {
    status?: string;
  };
  firstFailure: {
    code: string;
    stage: string;
    recommendedAction: string;
    message: string;
  } | null;
};

type OpenWorkFetch = (url: string, init?: RequestInit) => Promise<Response>;

type EngineMcpStatusRequest = {
  query?: {
    directory?: string;
  };
};

export type OpenWorkEngineMcpStatusClient = {
  mcp: {
    status: (request?: EngineMcpStatusRequest) => Promise<unknown>;
  };
};

export type OpenWorkEngineMcpStatusSource = {
  client?: OpenWorkEngineMcpStatusClient;
  directory?: string;
};

type EngineMcpStatusResult =
  | { found: true; status: string | undefined }
  | { found: false };

type ProviderModel = {
  provider: string;
  model: string;
};

const cloudFailureSchema = z.object({
  code: z.string(),
  stage: z.string(),
  recommendedAction: z.string(),
  message: z.string(),
}).passthrough();

const cloudHealthSchema = z.object({
  usable: z.boolean(),
  usableByCurrentModel: z.boolean().nullable(),
  phase: z.string(),
  connectCatalogEnabled: z.boolean().optional(),
  workspace: z.object({
    id: z.string(),
    directory: z.string().nullable(),
  }).passthrough(),
  desired: z.object({
    present: z.boolean(),
    revision: z.string().nullable(),
  }).passthrough(),
  delivery: z.object({
    appliedRevision: z.string().nullable().optional(),
  }).passthrough().optional(),
  engine: z.object({
    status: z.string().optional(),
  }).passthrough().optional(),
  firstFailure: cloudFailureSchema.nullable(),
}).passthrough();

const connectStateResponseSchema = z.object({
  ok: z.literal(true),
  schemaVersion: z.number(),
  connectEnabled: z.boolean(),
  connectCatalogEnabled: z.boolean().optional(),
  cloudMcpPresent: z.boolean(),
  cloudHealth: cloudHealthSchema.nullable().optional(),
  workspace: z.object({
    resolution: z.string().optional(),
    id: z.string().nullable().optional(),
    directory: z.string().nullable().optional(),
    reason: z.string().optional(),
  }).passthrough().optional(),
  googleWorkspace: z.object({
    legacyConfigured: z.boolean(),
  }).passthrough(),
}).passthrough();

export const OPENWORK_EXTENSION_DISCOVERY_INSTRUCTION =
  "如果员工提出的任务无法直接用内置工具完成，先检查 FoxWork 扩展，再判断能力是否可用。使用 openwork_extension_list_actions 查看可用动作，再通过 openwork_extension_call 调用匹配动作。";

export const OPENWORK_CLOUD_CONNECTION_INSTRUCTION =
  `当前工作区和模型已经可以使用公司能力。处理邮件、日历、Google Drive 或公司连接的 Notion、Linear、Slack 等服务时，先用 ${FOXWORK_COMPANY_MCP_EXPECTED_TOOLS[0]} 按 2 至 4 组关键词检索，再用 ${FOXWORK_COMPANY_MCP_EXPECTED_TOOLS[1]} 调用返回的准确能力名称；检索前不要直接声称不可用。图片生成等本地动作仍可通过 FoxWork 扩展完成。Google Workspace 的设置入口是“设置 > 公司连接”。检索成功只代表公司能力服务已经授权，下游连接失败不等于需要重新连接公司服务。若结果包含 connection_status，请准确说明连接名称和处理动作；员工个人授权在“我的连接”处理，公司共享连接由管理员在后台处理，供应商故障由对应供应商后台处理。人工完成处理后，应在同一任务中重新检索，因为结果来自实时状态。`;

export const OPENWORK_CONNECT_SIGN_IN_INSTRUCTION =
  `${OPENWORK_EXTENSION_DISCOVERY_INSTRUCTION} 当前尚未登录公司服务，或本工作区还没有 AI 使用权限。请引导员工登录 FoxWork，并在“设置 > 公司连接”完成连接。`;

export const OPENWORK_CONNECT_DISABLED_INSTRUCTION =
  `${OPENWORK_EXTENSION_DISCOVERY_INSTRUCTION} 当前工作区的公司 AI 使用权限已关闭。请说明员工可以在“设置 > 公司连接”重新启用。`;

const OPENWORK_CLOUD_MCP_NAME = FOXWORK_COMPANY_MCP_NAME;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function getRecordProperty(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function readNestedString(value: unknown, keys: string[]): string | undefined {
  let current = value;
  for (const key of keys) current = getRecordProperty(current, key);
  return readString(current);
}

function readContext(input: unknown): OpenCodeContext {
  const context = getRecordProperty(input, "context");
  const session = getRecordProperty(input, "session");
  const directory = readNestedString(input, ["directory"]) ?? readNestedString(context, ["directory"]) ?? readNestedString(session, ["directory"]);
  const worktree = readNestedString(input, ["worktree"]) ?? readNestedString(context, ["worktree"]) ?? readNestedString(session, ["worktree"]);
  const workspaceId = readNestedString(input, ["workspaceId"]) ?? readNestedString(input, ["workspaceID"]) ?? readNestedString(context, ["workspaceId"]) ?? readNestedString(context, ["workspaceID"]);
  return {
    ...(directory ? { directory } : {}),
    ...(worktree ? { worktree } : {}),
    ...(workspaceId ? { workspaceId } : {}),
  };
}

function readProviderModel(input: unknown): ProviderModel | undefined {
  const model = getRecordProperty(input, "model");
  const provider = readNestedString(model, ["providerID"]) ?? readNestedString(model, ["provider"]) ?? readNestedString(input, ["provider"]);
  const modelId = readNestedString(model, ["modelID"]) ?? readNestedString(model, ["id"]) ?? readNestedString(input, ["modelID"]);
  if (provider && modelId) return { provider, model: modelId };
  const combined = modelId?.includes("/") ? modelId : readNestedString(input, ["model"]) ?? readNestedString(model, ["name"]);
  if (combined?.includes("/")) {
    const [providerPart, ...modelParts] = combined.split("/");
    const joinedModel = modelParts.join("/").trim();
    if (providerPart?.trim() && joinedModel) return { provider: providerPart.trim(), model: joinedModel };
  }
  return undefined;
}

function serverUrl(): string {
  return String(process.env.OPENWORK_SERVER_URL || "").replace(/\/$/, "");
}

function serverToken(): string {
  return String(process.env.OPENWORK_SERVER_TOKEN || "");
}

function requireOpenWorkServer(): { url: string; token: string } {
  const url = serverUrl();
  const token = serverToken();
  if (!url || !token) {
    throw new Error("OpenWork extension tools are only available when OpenCode is launched by OpenWork.");
  }
  return { url, token };
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function getStringProperty(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const property = value[key];
  return typeof property === "string" ? property : null;
}

function errorMessage(payload: unknown, fallback: string): string {
  return getStringProperty(payload, "message") ?? getStringProperty(payload, "code") ?? fallback;
}

function readEngineDirectory(input: unknown, fallback?: string): string | undefined {
  const context = readContext(input);
  return context.directory ?? context.worktree ?? readString(fallback);
}

function engineStatusPayload(result: unknown): unknown {
  if (!isRecord(result)) return result;
  const data = result.data;
  if (data !== undefined) return data;
  if (result.error !== undefined) throw new Error("OpenCode MCP status request failed");
  const responseOk = getRecordProperty(result.response, "ok");
  if (responseOk === false) throw new Error("OpenCode MCP status request failed");
  return result;
}

function readEngineMcpStatus(result: unknown): EngineMcpStatusResult {
  const payload = engineStatusPayload(result);
  const entry = getRecordProperty(payload, OPENWORK_CLOUD_MCP_NAME)
    ?? getRecordProperty(payload, LEGACY_OPENWORK_CLOUD_MCP_NAME);
  if (entry === undefined) return { found: false };
  if (typeof entry === "string") return { found: true, status: readString(entry) };
  return { found: true, status: readNestedString(entry, ["status"]) };
}

async function fetchEngineMcpStatus(input: unknown, engine: OpenWorkEngineMcpStatusSource): Promise<EngineMcpStatusResult> {
  if (!engine.client) return { found: false };
  const directory = readEngineDirectory(input, engine.directory);
  const request = directory ? { query: { directory } } : undefined;
  return readEngineMcpStatus(await engine.client.mcp.status(request));
}

async function fetchOpenWorkConnectState(input: unknown, fetcher: OpenWorkFetch): Promise<OpenWorkExtensionConnectState> {
  const { url, token } = requireOpenWorkServer();
  const context = readContext(input);
  const providerModel = readProviderModel(input);
  const query = new URLSearchParams();
  const workspaceId = context.workspaceId ?? context.workspaceID;
  const directory = context.worktree ?? context.directory;
  if (workspaceId) query.set("workspaceId", workspaceId);
  if (directory) query.set("directory", directory);
  if (providerModel) {
    query.set("provider", providerModel.provider);
    query.set("model", providerModel.model);
  }
  const suffix = query.size ? `?${query.toString()}` : "";
  const response = await fetcher(`${url}/experimental/connect/state${suffix}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await parseResponse(response);
  if (!response.ok) throw new Error(errorMessage(payload, "OpenWork connect state request failed"));
  const parsed = connectStateResponseSchema.parse(payload);
  return {
    connectEnabled: parsed.connectEnabled,
    connectCatalogEnabled: parsed.connectCatalogEnabled ?? parsed.connectEnabled,
    cloudMcpPresent: parsed.cloudMcpPresent,
    cloudHealth: parsed.cloudHealth ?? null,
    ...(parsed.workspace ? { workspace: parsed.workspace } : {}),
    googleWorkspace: {
      legacyConfigured: parsed.googleWorkspace.legacyConfigured,
    },
  };
}

export function composeOpenWorkExtensionDiscoveryInstruction(state: OpenWorkExtensionConnectState | null): string {
  if (!state) return OPENWORK_EXTENSION_DISCOVERY_INSTRUCTION;
  if (state.workspace?.resolution && state.workspace.resolution !== "resolved") return OPENWORK_EXTENSION_DISCOVERY_INSTRUCTION;
  const health = state.cloudHealth;
  if (health?.usable === true && health.usableByCurrentModel !== false) return OPENWORK_CLOUD_CONNECTION_INSTRUCTION;
  if (health?.phase === "engine_disabled" || health?.firstFailure?.code === "engine_disabled" || health?.firstFailure?.code === "cloud_mcp_disabled") return OPENWORK_CONNECT_DISABLED_INSTRUCTION;
  if (health) {
    if (!health.desired.present || health.firstFailure?.code === "cloud_mcp_missing") return OPENWORK_CONNECT_SIGN_IN_INSTRUCTION;
    return OPENWORK_EXTENSION_DISCOVERY_INSTRUCTION;
  }
  if (!state.connectCatalogEnabled || state.googleWorkspace.legacyConfigured) return OPENWORK_EXTENSION_DISCOVERY_INSTRUCTION;
  return OPENWORK_CONNECT_SIGN_IN_INSTRUCTION;
}

export function composeSteeringFromEngineMcpStatus(status: string | undefined): string {
  if (status === "connected") return OPENWORK_CLOUD_CONNECTION_INSTRUCTION;
  if (status === "disabled") return OPENWORK_CONNECT_DISABLED_INSTRUCTION;
  if (status === "needs_auth" || status === "needs_client_registration") return OPENWORK_CONNECT_SIGN_IN_INSTRUCTION;
  return OPENWORK_EXTENSION_DISCOVERY_INSTRUCTION;
}

export function resetOpenWorkExtensionDiscoveryInstructionCacheForTests(): void {
  // Retained for older tests; steering is deliberately uncached so repair is observed immediately.
}

export async function resolveOpenWorkExtensionDiscoveryInstruction(
  input?: unknown,
  fetcher: OpenWorkFetch = fetch,
  engine: OpenWorkEngineMcpStatusSource = {},
): Promise<string> {
  if (engine.client) {
    try {
      // Invariant: the OpenCode engine owns MCP registration and builds the
      // prompt tool list, so tool-availability steering must come from that
      // same in-process MCP state. Server health probes may fail for reasons
      // (for example corporate TLS trust) that do not affect engine tools.
      const engineStatus = await fetchEngineMcpStatus(input, engine);
      if (engineStatus.found) return composeSteeringFromEngineMcpStatus(engineStatus.status);
    } catch {
      return OPENWORK_EXTENSION_DISCOVERY_INSTRUCTION;
    }
  }
  try {
    return composeOpenWorkExtensionDiscoveryInstruction(await fetchOpenWorkConnectState(input, fetcher));
  } catch {
    return OPENWORK_EXTENSION_DISCOVERY_INSTRUCTION;
  }
}
