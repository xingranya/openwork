import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { ErrorCode, McpError, type ToolAnnotations } from "@modelcontextprotocol/sdk/types.js"
import { StreamableHTTPTransport } from "@hono/mcp"
import { eq } from "@openwork-ee/den-db/drizzle"
import { OrganizationTable } from "@openwork-ee/den-db/schema"
import { normalizeDenTypeId } from "@openwork-ee/utils/typeid"
import { openworkCloudMcpConnectionActionSchema } from "@openwork/types/den/mcp-connection-action"
import type { Hono } from "hono"
import { z } from "zod"
import { memberFacingMcpConnectionsEnabled } from "../capability-sources/external-mcp-rollout.js"
import { EXTERNAL_MCP_DIAGNOSTIC_PHASES } from "../capability-sources/external-mcp-diagnostics.js"
import { publicRoute, tokenRoute } from "../middleware/index.js"
import { db } from "../db.js"
import { getMcpResourceContext, verifyMcpRequest } from "./auth.js"
import { invokeMcpOperation, normalizeToolBody, normalizeToolRecord } from "./invoke.js"
import { getCatalog, protectedResourceMetadata } from "./index.js"
import { preflightMcpJsonRpcRequest } from "./json-rpc-preflight.js"
import { compareCapabilityMatches, SEARCH_CAPABILITIES_TOOL_NAME, searchCapabilities, searchCapabilitySourceFilter, type CapabilityMatch } from "./search.js"
import { executeExternalCapability, externalMcpSearchCoverageHint, parseExternalCapabilityName, resolveMcpMemberIdentity, searchExternalCapabilities, type ExternalCapabilityExecuteResult } from "./external-capabilities.js"
import { executeMarketplaceCapability, parseMarketplaceCapabilityName, searchMarketplaceCapabilities, type MarketplaceCapabilityObjectType } from "./marketplace-capabilities.js"
import { executeSkillCapability, parseSkillCapabilityName, searchSkillCapabilities } from "./skill-capabilities.js"
import { resolvePublicOrigin } from "../capability-sources/generic-oauth.js"
import { env } from "../env.js"
import { isPlatformAdminUserId } from "../middleware/admin.js"
import { executeAvailableAdminCapability, parseAdminCapabilityName, searchAvailableAdminCapabilities } from "./admin-capabilities.js"

export const EXECUTE_CAPABILITY_TOOL_NAME = "execute_capability"
const searchCapabilityTypeSchema = z.enum(["all", "api", "admin", "mcp", "marketplace", "skills"])
const skillMarketplaceObjectTypes: MarketplaceCapabilityObjectType[] = ["skill"]
export const EXECUTE_CAPABILITY_TIMEOUT_MS = 180_000
export const SEARCH_CAPABILITIES_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
}
export const EXECUTE_CAPABILITY_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
}

const externalMcpDiagnosticOutputSchema = z.object({
  referenceId: z.string(),
  phase: z.enum(EXTERNAL_MCP_DIAGNOSTIC_PHASES),
  category: z.string(),
  code: z.string(),
  highestPassed: z.enum(["configured", "reachable", "authorized", "protocol_ready", "catalog_ready", "operation_ready"]),
  retryable: z.boolean(),
  actionOwner: z.enum(["openwork", "network_admin", "provider_admin", "organization_admin", "member"]),
  operatorAction: z.string(),
  message: z.string(),
  httpStatus: z.number().int().optional(),
  operationPhase: z.enum(EXTERNAL_MCP_DIAGNOSTIC_PHASES).optional(),
  outbound: z.object({ origin: z.string(), pathHash: z.string() }).optional(),
  providerRequestId: z.string().optional(),
  providerStatus: z.number().int().optional(),
  providerCode: z.string().optional(),
  payloadBytes: z.number().int().optional(),
  jsonRpcCode: z.number().int().optional(),
  connectUrl: z.string().url().optional(),
  providerErrorMessage: z.string().optional(),
  providerErrorData: z.string().optional(),
})

const connectionStatusOutputSchema = openworkCloudMcpConnectionActionSchema.extend({
  layer: z.enum(["mcp_connection", "downstream_provider"]),
  errorCode: z.enum(["not_connected", "invalid_refresh_token", "invalid_grant", "unauthorized", "provider_error"]),
  message: z.string(),
  action: z.object({
    type: z.enum(["connect", "reconnect", "update_credentials", "inspect_connection", "fix_provider", "fix_network", "contact_openwork"]),
    label: z.string(),
    surface: z.enum(["openwork_your_connections", "openwork_organization_connections", "provider_admin_console", "network_infrastructure", "openwork_support"]),
    retry: z.literal("search_capabilities"),
    url: z.string().url().optional(),
  }),
  diagnostic: externalMcpDiagnosticOutputSchema.optional(),
})

const capabilityMatchOutputSchema = z.object({
  name: z.string(),
  method: z.string(),
  path: z.string(),
  score: z.number(),
  summary: z.string(),
  pathParams: z.array(z.string()),
  queryParams: z.array(z.string()),
  hasBody: z.boolean(),
  bodySchema: z.unknown().optional(),
  argumentsSchema: z.unknown().optional(),
  schemaDigest: z.string().optional(),
  invocation: z.object({ argumentsField: z.literal("body") }).optional(),
  kind: z.string().optional(),
  status: z.string().optional(),
  hint: z.string().optional(),
  connectionStatus: connectionStatusOutputSchema.optional(),
}).passthrough()

export const SEARCH_CAPABILITIES_OUTPUT_SCHEMA = z.object({
  matches: z.array(capabilityMatchOutputSchema),
  hint: z.string().optional(),
})

export const AGENT_MCP_INSTRUCTIONS = [
  "公司能力连接只开放两个工具：search_capabilities 和 execute_capability。",
  "能力包括使用当前成员公司身份执行的 Google Workspace 操作，以及公司管理员添加并授权给该成员的 MCP 和 Skill。",
  "白名单内的平台管理员还可发现带命名空间的管理能力，普通成员不能发现或执行这些能力。",
  "判断能力不可用前，必须先用 2 至 4 组关键词调用 search_capabilities；execute_capability 只能使用检索结果返回的准确名称。",
  "如需导入公开 GitHub 插件，先检索能力市场、导入预览、正式导入和导入结果详情；必须先预览，不要手工重建插件。",
  "导入前确认目标能力市场、选中的 Skill 或服务键，以及可用成员范围。不要为所有服务强行选择同一种认证方式。",
  "导入后读取完整详情并报告每个插件的 cloudReadiness。导入或绑定成功不代表 MCP 已可用；needs_admin_setup 和 needs_signin 必须作为下一步人工操作说明。",
  "不要编造 OAuth 客户端、凭据或本地扩展配置。公司连接由管理员后台和 FoxWork 的“公司连接”管理；需要管理员设置或成员登录时，准确转述返回的操作。",
  "search_capabilities 调用成功只证明公司能力连接已授权。下游连接失败时，不要让员工重新连接整个公司服务。",
  "外部 MCP 结果包含 argumentsSchema、schemaDigest 和 invocation.argumentsField。execute_capability.body 必须符合 argumentsSchema，并把 schemaDigest 原样传入 execute_capability.schemaDigest。",
  "即使本地 Schema 检查发现不一致，FoxWork 仍会尝试调用下游供应商。schemaGuidance 仅作提示；供应商成功时直接接受结果，失败时再按提示修正参数或重新检索。",
  "如果返回 invalid_capability_arguments，修正问题后只重试一次，不能用相同参数重复调用；如果返回 unknown_capability，必须先重新检索。",
  "当结果 kind 为 connection_status 时，准确说明 connectionStatus.connectionName 和 connectionStatus.action，并区分员工个人连接、公司管理员后台和供应商后台。",
  "连接检查使用实时状态。人工修复后在同一任务中重新检索；未发生变化时不要重复调用，也不要绕到其他工具编造替代流程。",
].join("\n")

const EXECUTE_CAPABILITY_TIMEOUT_MESSAGE = `能力调用超过 ${EXECUTE_CAPABILITY_TIMEOUT_MS / 1_000} 秒。可以重试一次；再次超时时请缩小请求范围，并说明服务响应较慢，不要让员工重新配置或重新连接。`

export type ExecuteCapabilityToolResult = {
  isError?: boolean
  content: { text: string; type: "text" }[]
}

function textContent(text: string): { text: string; type: "text" }[] {
  return [{ type: "text", text }]
}

export function externalCapabilityErrorToolResult(
  result: Exclude<ExternalCapabilityExecuteResult, { ok: true }>,
): ExecuteCapabilityToolResult {
  return {
    isError: true,
    content: textContent(JSON.stringify({
      error: result.error,
      message: result.message,
      ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}),
      ...(result.actionOwner ? { actionOwner: result.actionOwner } : {}),
      ...(result.operatorAction ? { operatorAction: result.operatorAction } : {}),
      ...(result.connectionStatus ? { connectionStatus: result.connectionStatus } : {}),
      ...(result.capability ? { capability: result.capability } : {}),
      ...(result.issues ? { issues: result.issues } : {}),
      ...(result.schemaDigest ? { schemaDigest: result.schemaDigest } : {}),
      ...(result.sameArgumentsRetryable === false ? { sameArgumentsRetryable: false } : {}),
      ...(result.retry ? { retry: result.retry } : {}),
      ...(result.schemaGuidance ? { schemaGuidance: result.schemaGuidance } : {}),
    })),
  }
}

export function capabilitySearchToolResult<T extends CapabilityMatch>(matches: T[], coverageHint?: string) {
  const hint = [
    ...(matches.length === 0 ? ["No matches. Try broader or different keywords."] : []),
    ...(coverageHint ? [coverageHint] : []),
  ].join(" ")
  const result = hint ? { matches, hint } : { matches }
  return {
    content: textContent(JSON.stringify(result, null, 2)),
    structuredContent: result,
  }
}

function unknownCapabilityText(name: string): string {
  return JSON.stringify({
    error: "unknown_capability",
    message: `没有名为“${name}”的能力，请先调用 search_capabilities 获取有效名称。`,
  })
}

function isTextContent(value: unknown): value is { type: "text"; text: string } {
  return typeof value === "object"
    && value !== null
    && "type" in value
    && value.type === "text"
    && "text" in value
    && typeof value.text === "string"
}

function externalToolContent(result: unknown): { type: "text"; text: string }[] {
  if (typeof result === "object" && result !== null && "content" in result && Array.isArray(result.content) && result.content.every(isTextContent)) {
    return result.content
  }
  return textContent(JSON.stringify(result))
}

export function externalCapabilitySuccessToolResult(
  result: Extract<ExternalCapabilityExecuteResult, { ok: true }>,
): ExecuteCapabilityToolResult {
  const content = externalToolContent(result.result)
  if (!result.schemaGuidance) return { content }
  return {
    content: [
      ...content,
      ...textContent(JSON.stringify({ schemaGuidance: result.schemaGuidance })),
    ],
  }
}

function capabilityTimeoutResult(capability: string): ExecuteCapabilityToolResult {
  return {
    isError: true,
    content: textContent(JSON.stringify({
      error: "capability_timeout",
      capability,
      message: EXECUTE_CAPABILITY_TIMEOUT_MESSAGE,
    })),
  }
}

function isTimeoutError(error: unknown): boolean {
  if (error instanceof McpError && error.code === ErrorCode.RequestTimeout) {
    return true
  }
  if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return true
  }
  return error instanceof Error && /\b(time(?:d)? out|timeout)\b/i.test(error.message)
}

export async function executeCapabilityWithBudget<T extends ExecuteCapabilityToolResult>(input: {
  capability: string
  timeoutMs?: number
  invoke: () => Promise<T>
}): Promise<T | ExecuteCapabilityToolResult> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const timeoutResult = new Promise<ExecuteCapabilityToolResult>((resolve) => {
    timeout = setTimeout(() => resolve(capabilityTimeoutResult(input.capability)), input.timeoutMs ?? EXECUTE_CAPABILITY_TIMEOUT_MS)
  })
  try {
    const invocation = input.invoke()
    void invocation.catch(() => undefined)
    return await Promise.race([invocation, timeoutResult])
  } catch (error) {
    if (isTimeoutError(error)) {
      return capabilityTimeoutResult(input.capability)
    }
    throw error
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export function createAgentMcpServer(): McpServer {
  return new McpServer({
    name: "openwork-den-api-agent",
    version: "1.0.0",
  }, {
    instructions: AGENT_MCP_INSTRUCTIONS,
  })
}

/**
 * The minimal, harness-facing MCP surface: exactly two tools, full stop.
 *
 * `/mcp` (index.ts) stays exactly as it is — every catalog operation
 * individually registered, ~129 tools today. That's unchanged and still
 * useful for scripts/admin tooling that want to call a known operation by
 * name directly.
 *
 * `/mcp/agent` is a *different* endpoint for a *different* consumer: the
 * desktop app's "OpenWork Cloud Control" connection, which is what an
 * OpenCode/Claude Code/Codex-style harness actually sees. It registers only
 * `search_capabilities` and `execute_capability`, both backed by the exact
 * same catalog and the exact same `invokeMcpOperation` execute path used by
 * the rich endpoint — no new auth, no new policy, no new execution logic.
 * A harness connected here can only discover and call capabilities through
 * these two tools; the other ~127 operations are not individually callable
 * on this endpoint.
 */
export function registerAgentMcpRoutes<T extends { Variables: Record<string, unknown> }>(app: Hono<T>) {
  app.get("/.well-known/oauth-protected-resource/mcp/agent", publicRoute, (c) =>
    c.json(protectedResourceMetadata(c.req.raw, "agent")))
  app.get("/mcp/agent/.well-known/oauth-protected-resource", publicRoute, (c) =>
    c.json(protectedResourceMetadata(c.req.raw, "agent")))

  app.all("/mcp/agent", tokenRoute, async (c) => {
    const requestIdValue = c.get("requestId")
    const requestId = typeof requestIdValue === "string" ? requestIdValue : "unknown"
    const principal = await verifyMcpRequest(
      c.req.raw.headers,
      getMcpResourceContext(c.req.raw, "agent", requestId),
    )
    if (principal instanceof Response) {
      return principal
    }

    const preflightResponse = await preflightMcpJsonRpcRequest(c.req.raw, requestId)
    if (preflightResponse) {
      return preflightResponse
    }

    const catalog = await getCatalog(app as unknown as Hono, c.env)
    // External MCP connections are scoped to the calling MEMBER (grants +
    // per-member credentials), not just the org — resolve who this token's
    // user is within the org once per request.
    const memberIdentity = await resolveMcpMemberIdentity({
      userId: principal.userId,
      organizationId: principal.organizationId,
    })
    let platformAdmin: Promise<boolean> | undefined
    const resolvePlatformAdmin = () => {
      platformAdmin ??= isPlatformAdminUserId(principal.userId)
      return platformAdmin
    }
    const organizationId = normalizeDenTypeId("organization", principal.organizationId)
    const organizationRows = await db
      .select({ metadata: OrganizationTable.metadata })
      .from(OrganizationTable)
      .where(eq(OrganizationTable.id, organizationId))
      .limit(1)
    const externalMcpConnectionsEnabled = memberFacingMcpConnectionsEnabled(organizationRows[0]?.metadata, {
      gatingEnabled: env.mcpConnectionsGatingEnabled,
    })
    const server = createAgentMcpServer()

    server.registerTool(
      SEARCH_CAPABILITIES_TOOL_NAME,
      {
        title: "搜索公司能力",
        description: [
          "按关键词搜索公司能力。该连接只开放本工具和 execute_capability，没有可直接浏览的独立工具列表，因此必须先搜索。",
          "搜索范围包括 Google Workspace、公司外部 MCP、公司 Skill，以及白名单平台管理员可用的管理能力。",
          "判断能力不可用前，请尝试 2 至 4 组关键词。",
          "原生 API 结果会返回 pathParams、queryParams、hasBody 和 bodySchema；外部 MCP 会返回 argumentsSchema、schemaDigest 和 invocation.argumentsField。",
          "Skill 结果的 method 为 SKILL，执行后返回公司保存的 SKILL.md 内容。",
        ].join(" "),
        annotations: SEARCH_CAPABILITIES_ANNOTATIONS,
        inputSchema: z.object({
          query: z.string().min(1).describe("描述所需能力的关键词，例如“创建组织”或“列出 Worker”。"),
          limit: z.number().int().min(1).max(20).optional().describe("最多返回多少条结果，默认 5 条。"),
          type: searchCapabilityTypeSchema.optional().describe("可选来源过滤。all 搜索全部来源；api 搜索 Den API；admin 搜索白名单管理能力；mcp 搜索公司 MCP；marketplace 搜索能力市场；skills 搜索公司 Skill。默认 all。"),
        }),
        outputSchema: SEARCH_CAPABILITIES_OUTPUT_SCHEMA,
      },
      async ({ query, limit, type }) => {
        const boundedLimit = limit ?? 5
        const sourceFilter = searchCapabilitySourceFilter(type)
        const marketplaceObjectTypes = type === "skills" ? skillMarketplaceObjectTypes : undefined
        const restMatches = sourceFilter.api ? searchCapabilities(catalog, query, boundedLimit) : []
        const adminMatches = sourceFilter.admin
          ? await searchAvailableAdminCapabilities(await resolvePlatformAdmin(), query, boundedLimit)
          : []
        // Merged in from each connected External MCP Connection's live
        // tools/list (capability-sources/external-mcp-client.ts) — a
        // Notion/Linear/Stripe/... connection an admin added in Den shows
        // up here exactly like any native capability, ranked together.
        let externalCoverageHint: string | undefined
        const externalMatches = sourceFilter.mcp && externalMcpConnectionsEnabled
          ? await searchExternalCapabilities({
            organizationId: principal.organizationId,
            member: memberIdentity,
            query,
            redirectUriBase: resolvePublicOrigin(c.req.raw, env.apiPublicUrl),
            limit: boundedLimit,
            reportCoverage: (coverage) => {
              externalCoverageHint = externalMcpSearchCoverageHint(coverage)
            },
          })
          : []
        const marketplaceMatches = sourceFilter.marketplace && externalMcpConnectionsEnabled
          ? await searchMarketplaceCapabilities({
            organizationId: principal.organizationId,
            member: memberIdentity,
            objectTypes: marketplaceObjectTypes,
            query,
            limit: boundedLimit,
            enabled: externalMcpConnectionsEnabled,
          })
          : []
        const skillMatches = sourceFilter.skills
          ? await searchSkillCapabilities({
            organizationId: principal.organizationId,
            member: memberIdentity,
            query,
            limit: boundedLimit,
          })
          : []
        const matches = [...restMatches, ...adminMatches, ...externalMatches, ...marketplaceMatches, ...skillMatches]
          .sort(compareCapabilityMatches)
          .slice(0, boundedLimit)
        return capabilitySearchToolResult(matches, externalCoverageHint)
      },
    )

    server.registerTool(
      EXECUTE_CAPABILITY_TOOL_NAME,
      {
        title: "调用公司能力",
        description: [
          "按 search_capabilities 返回的准确名称调用能力。",
          "path、query 和 body 必须严格依据结果中的 pathParams、queryParams 和 hasBody。",
          "外部 MCP 的 Schema 不一致会以 schemaGuidance 提示，但不会阻断下游调用。",
          "执行 skill:<id> 结果时，会返回公司保存的 SKILL.md 内容。",
          "如果名称不再有效，将返回 unknown_capability，此时必须重新调用 search_capabilities。",
        ].join(" "),
        annotations: EXECUTE_CAPABILITY_ANNOTATIONS,
        inputSchema: z.object({
          name: z.string().min(1).describe("search_capabilities 返回的准确能力名称。"),
          schemaDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional().describe("外部 MCP 结果中的 schemaDigest，用于提示 Schema 变化，不会阻断供应商调用。"),
          path: z.union([z.record(z.string(), z.unknown()), z.string()]).optional().describe("路径参数，仅在结果的 pathParams 非空时填写。"),
          query: z.union([z.record(z.string(), z.unknown()), z.string()]).optional().describe("查询参数，仅在结果的 queryParams 非空时填写。"),
          body: z.unknown().optional().describe("原生 API 使用 JSON 请求体；外部 MCP 使用符合 argumentsSchema 的参数对象。"),
        }),
      },
      async ({ name, schemaDigest, path, query, body }) => {
        return executeCapabilityWithBudget({
          capability: name,
          invoke: async (): Promise<ExecuteCapabilityToolResult> => {
            const adminResult = parseAdminCapabilityName(name)
              ? await executeAvailableAdminCapability(await resolvePlatformAdmin(), name, body)
              : null
            if (adminResult) return adminResult

            const external = parseExternalCapabilityName(name)
            if (external) {
              if (!externalMcpConnectionsEnabled) {
                return {
                  isError: true,
                  content: textContent(JSON.stringify({
                    error: "unknown_capability",
                    message: "No external MCP connection capabilities are available for this organization.",
                  })),
                }
              }
              const result = await executeExternalCapability({
                organizationId: principal.organizationId,
                member: memberIdentity,
                connectionId: external.connectionId,
                toolName: external.toolName,
                args: normalizeToolBody(body),
                schemaDigest,
                redirectUriBase: resolvePublicOrigin(c.req.raw, env.apiPublicUrl),
              })
              if (!result.ok) {
                return externalCapabilityErrorToolResult(result)
              }
              // The SDK's callTool() can return either the standard {content:[...]}
              // shape or a legacy-compatibility {toolResult} shape; normalize to
              // what McpServer's own tool callback contract requires.
              return externalCapabilitySuccessToolResult(result)
            }

            const marketplace = parseMarketplaceCapabilityName(name)
            if (marketplace) {
              const result = await executeMarketplaceCapability({
                organizationId: principal.organizationId,
                member: memberIdentity,
                pluginId: marketplace.pluginId,
                configObjectId: marketplace.configObjectId,
                body,
                enabled: externalMcpConnectionsEnabled,
              })
              if (!result.ok) {
                return {
                  isError: true,
                  content: textContent(result.error === "unknown_capability"
                    ? unknownCapabilityText(name)
                    : JSON.stringify({ error: result.error, message: result.message })),
                }
              }
              return { content: textContent(JSON.stringify(result.result, null, 2)) }
            }

            const skillId = parseSkillCapabilityName(name)
            if (skillId) {
              const result = await executeSkillCapability({
                organizationId: principal.organizationId,
                member: memberIdentity,
                skillId,
              })
              if (!result.ok) {
                return {
                  isError: true,
                  content: textContent(JSON.stringify({ error: result.error, message: result.message })),
                }
              }
              return {
                content: textContent(JSON.stringify({
                  skill: {
                    id: result.skill.id,
                    title: result.skill.title,
                    description: result.skill.description,
                    skillText: result.skill.skillText,
                    bundleHash: result.skill.bundleHash,
                    files: result.skill.files,
                    updatedAt: result.skill.updatedAt,
                  },
                }, null, 2)),
              }
            }

            const operation = catalog.find((candidate) => candidate.name === name)
            if (!operation) {
              return {
                isError: true,
                content: textContent(unknownCapabilityText(name)),
              }
            }

            return invokeMcpOperation({
              app: app as unknown as Hono,
              env: c.env,
              operation,
              principal,
              toolInput: {
                path: normalizeToolRecord(path),
                query: normalizeToolRecord(query),
                body: normalizeToolBody(body),
              },
            })
          },
        })
      },
    )

    const transport = new StreamableHTTPTransport()
    await server.connect(transport)
    const response = await transport.handleRequest(c)
    return response ?? new Response(null, { status: 204 })
  })
}
