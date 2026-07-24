/**
 * 智能添加连接的纯投影逻辑：识别管理员输入、生成本地预设建议，
 * 再把服务端解析结果转换为一键添加方案或完整表单。
 * 此处逻辑保持确定性，无需渲染弹窗即可做单元测试。
 */
import type {
  CreateMcpConnectionInput,
  ExternalMcpPreset,
  McpRequirementsDiscovery,
} from "./mcp-connections-data";

export type SmartAddInputKind = "empty" | "url" | "domain" | "name" | "invalid";

const NAME_QUERY_PATTERN = /^[a-z0-9][a-z0-9 &_'-]{0,63}$/i;

export function classifySmartAddInput(rawQuery: string): SmartAddInputKind {
  const query = rawQuery.trim();
  if (!query) return "empty";
  if (query.length > 200) return "invalid";

  if (/^https?:\/\//i.test(query)) {
    try {
      const parsed = new URL(query);
      return parsed.username || parsed.password || parsed.hash ? "invalid" : "url";
    } catch {
      return "invalid";
    }
  }

  if (query.includes(".") && !/\s/.test(query)) {
    try {
      const parsed = new URL(`https://${query}`);
      return parsed.username || parsed.password || parsed.hash ? "invalid" : "domain";
    } catch {
      return "invalid";
    }
  }

  return NAME_QUERY_PATTERN.test(query) ? "name" : "invalid";
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function hostnameOf(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * 管理员输入时即时生成本地建议。显示名称前缀匹配优先，
 * 其次是名称片段和主机名匹配；预设范围外的结果以服务端解析为准。
 */
export function filterPresetSuggestions(
  presets: readonly ExternalMcpPreset[],
  rawQuery: string,
  limit = 3,
): ExternalMcpPreset[] {
  const query = rawQuery.trim();
  const normalized = normalizeText(query);
  if (normalized.length < 2) return [];
  const queryHost = hostnameOf(query) ?? hostnameOf(`https://${query}`);

  const prefix: ExternalMcpPreset[] = [];
  const partial: ExternalMcpPreset[] = [];
  for (const preset of presets) {
    const name = normalizeText(preset.displayName);
    const id = normalizeText(preset.presetId);
    if (name.startsWith(normalized) || id.startsWith(normalized)) {
      prefix.push(preset);
    } else if (
      name.includes(normalized)
      || id.includes(normalized)
      || (queryHost !== null && hostnameOf(preset.url) === queryHost)
    ) {
      partial.push(preset);
    }
  }
  return [...prefix, ...partial].slice(0, limit);
}

export type SmartAddPlan =
  | { readiness: "one_click"; input: CreateMcpConnectionInput }
  | { readiness: "needs_details"; reasons: string[] }
  | { readiness: "unsupported"; reasons: string[] };

const EVERYONE_ACCESS = { orgWide: true, memberIds: [], teamIds: [] } as const;

/**
 * 判断解析后的服务能否按安全默认值一键添加：默认全公司可用，
 * OAuth 由每名成员登录自己的账号；其余情况交给管理员在完整表单中配置。
 */
export function planSmartAdd(
  discovery: McpRequirementsDiscovery,
  target: { name: string; url: string },
): SmartAddPlan {
  if (discovery.status === "unreachable") {
    return { readiness: "unsupported", reasons: ["无法连接此地址上的 MCP 服务。"] };
  }

  if (discovery.status === "ready") {
    if (discovery.authentication.kind === "none") {
      return {
        readiness: "one_click",
        input: {
          name: target.name,
          url: target.url,
          authType: "none",
          credentialMode: "shared",
          access: { ...EVERYONE_ACCESS, memberIds: [], teamIds: [] },
        },
      };
    }
    if (discovery.authentication.kind === "oauth") {
      const servers = discovery.authentication.authorizationServers;
      return {
        readiness: "one_click",
        input: {
          name: target.name,
          url: target.url,
          authType: "oauth",
          credentialMode: "per_member",
          ...(servers.length === 1 ? { authorizationServerIssuer: servers[0].issuer } : {}),
          requestedScopes: [...new Set([
            ...discovery.authentication.requiredScopes,
            ...discovery.authentication.recommendedScopes,
          ])],
          access: { ...EVERYONE_ACCESS, memberIds: [], teamIds: [] },
        },
      };
    }
  }

  const reasons = discovery.manualRequirements
    .filter((requirement) => requirement.required)
    .map((requirement) => requirement.label);
  if (discovery.authentication.kind === "manual_bearer" && !reasons.includes("API key")) {
    reasons.push("此服务需要 API 密钥或 Bearer Token。");
  }
  if (reasons.length === 0) {
    reasons.push("添加前需要补充检查此服务。");
  }
  return { readiness: "needs_details", reasons };
}

/** 返回智能添加结果卡中显示的认证方式。 */
export function smartAddAuthLabel(discovery: McpRequirementsDiscovery): string {
  switch (discovery.authentication.kind) {
    case "none":
      return "无需登录";
    case "oauth":
      return "OAuth 登录";
    case "manual_bearer":
      return "API 密钥";
    default:
      return "认证方式待确认";
  }
}
