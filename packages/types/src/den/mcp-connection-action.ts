import { z } from "zod"

/** 公司能力 MCP 的运行时名称。旧版本名称只用于一次性迁移。 */
export const FOXWORK_COMPANY_MCP_NAME = "foxwork-company" as const
export const LEGACY_OPENWORK_CLOUD_MCP_NAME = "openwork-cloud" as const
export const FOXWORK_COMPANY_MCP_DIRECT_TOOL_NAMES = [
  "search_capabilities",
  "execute_capability",
] as const
export const FOXWORK_COMPANY_MCP_EXPECTED_TOOLS = [
  "foxwork-company_search_capabilities",
  "foxwork-company_execute_capability",
] as const

export const OPENWORK_CLOUD_MCP_CONNECTION_ACTION_VERSION = 1 as const
export const OPENWORK_CLOUD_MCP_CONNECTION_ACTION_KIND = "connection_action" as const
export const OPENWORK_CLOUD_MCP_CONNECTION_ACTION_SOURCE = FOXWORK_COMPANY_MCP_NAME
export const LEGACY_OPENWORK_CLOUD_MCP_CONNECTION_ACTION_SOURCE = LEGACY_OPENWORK_CLOUD_MCP_NAME

export const openworkCloudMcpConnectionActionSchema = z.object({
  version: z.literal(OPENWORK_CLOUD_MCP_CONNECTION_ACTION_VERSION),
  kind: z.literal(OPENWORK_CLOUD_MCP_CONNECTION_ACTION_KIND),
  // 兼容旧版 Den 返回的动作；新版本只会生成 foxwork-company。
  source: z.union([
    z.literal(OPENWORK_CLOUD_MCP_CONNECTION_ACTION_SOURCE),
    z.literal(LEGACY_OPENWORK_CLOUD_MCP_CONNECTION_ACTION_SOURCE),
  ]),
  connectionId: z.string().min(1),
  connectionName: z.string().min(1),
  authType: z.enum(["oauth", "apikey", "none"]),
  credentialMode: z.enum(["shared", "per_member"]),
  state: z.enum(["needs_connection", "reauth_required", "provider_error"]),
  actor: z.enum([
    "member",
    "organization_admin",
    "provider_admin",
    "network_admin",
    "openwork",
  ]),
  action: z.object({
    type: z.enum([
      "connect",
      "reconnect",
      "update_credentials",
      "inspect_connection",
      "fix_provider",
      "fix_network",
      "contact_openwork",
    ]),
    surface: z.enum([
      "openwork_your_connections",
      "openwork_organization_connections",
      "provider_admin_console",
      "network_infrastructure",
      "openwork_support",
    ]),
    retry: z.literal("search_capabilities"),
  }),
})

/**
 * The only connection action that chat may execute directly. Shared OAuth,
 * API-key, provider-admin, and support actions remain descriptive because the
 * current member may not own the credential or have permission to repair it.
 */
export const openworkCloudMcpInlineReconnectSchema = openworkCloudMcpConnectionActionSchema.extend({
  authType: z.literal("oauth"),
  credentialMode: z.literal("per_member"),
  state: z.literal("reauth_required"),
  actor: z.literal("member"),
  action: z.object({
    type: z.literal("reconnect"),
    surface: z.literal("openwork_your_connections"),
    retry: z.literal("search_capabilities"),
  }),
})

export type OpenworkCloudMcpConnectionAction = z.infer<typeof openworkCloudMcpConnectionActionSchema>
export type OpenworkCloudMcpInlineReconnect = z.infer<typeof openworkCloudMcpInlineReconnectSchema>
