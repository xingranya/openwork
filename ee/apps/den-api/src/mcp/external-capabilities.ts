import { and, eq, isNull } from "@openwork-ee/den-db/drizzle"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import {
  OPENWORK_CLOUD_MCP_CONNECTION_ACTION_KIND,
  OPENWORK_CLOUD_MCP_CONNECTION_ACTION_SOURCE,
  OPENWORK_CLOUD_MCP_CONNECTION_ACTION_VERSION,
} from "@openwork/types/den/mcp-connection-action"
import { MemberTable } from "@openwork-ee/den-db/schema"
import { normalizeDenTypeId, type DenTypeId } from "@openwork-ee/utils/typeid"
import {
  getExternalMcpConnection,
  listUsableExternalMcpConnections,
  memberCanUseExternalMcpConnection,
  type ExternalMcpConnectionRow,
} from "../capability-sources/external-mcp-connections.js"
import { callExternalMcpTool, listExternalMcpTools } from "../capability-sources/external-mcp-client-runtime.js"
import {
  EXTERNAL_MCP_TOOL_LIFECYCLE_TIMEOUT_MS,
  createExternalMcpLifecycleDeadline,
  type ExternalMcpLifecycleDeadline,
} from "../capability-sources/external-mcp-client.js"
import {
  ExternalMcpDiagnosticError,
  externalMcpDiagnosticForLog,
  safeExternalMcpEndpointForLog,
  type ExternalMcpDiagnostic,
} from "../capability-sources/external-mcp-diagnostics.js"
import { getConnectedAccount } from "../capability-sources/oauth-credentials.js"
import { db } from "../db.js"
import { listTeamsForMember } from "../orgs.js"
import { openworkOrganizationConnectionsUrl, openworkYourConnectionsUrl } from "./connection-navigation.js"
import {
  externalMcpToolSchemaDigest,
  validateExternalMcpToolArguments,
  type ExternalMcpArgumentIssue,
} from "./external-mcp-tool-arguments.js"
import { compareCapabilityMatches, tokenize } from "./search.js"
import type { CapabilityMatch } from "./search.js"

/**
 * Merges org-level External MCP Connections (capability-sources/) into the
 * same search_capabilities/execute_capability surface as the REST-derived
 * catalog (catalog.ts), without touching that catalog or the rich `/mcp`
 * endpoint at all. A connected external tool is namespaced
 * `mcp:<connectionId>:<toolName>` so execute_capability can tell it apart
 * from a REST operation name and dispatch to the real MCP client
 * (external-mcp-client.ts) instead of invokeMcpOperation.
 *
 * Everything here is scoped to the CALLING MEMBER, not just the org:
 * - Only connections the member has been granted (org-wide, direct, or via
 *   a team) are searchable/executable. Access is never implicit.
 * - For credentialMode "per_member" connections, calls run with the
 *   member's own connected account; if they haven't connected one yet,
 *   search surfaces the connection as needs_connection (so the agent can
 *   tell the human what to do) instead of silently hiding it.
 */

const EXTERNAL_CAPABILITY_PREFIX = "mcp:"
export const EXTERNAL_MCP_SEARCH_CONNECTION_LIMIT = 16
export const EXTERNAL_MCP_SEARCH_CONCURRENCY = 4
export const EXTERNAL_MCP_SEARCH_MATCH_LIMIT = 20

export function buildExternalCapabilityName(connectionId: string, toolName: string): string {
  return `${EXTERNAL_CAPABILITY_PREFIX}${connectionId}:${toolName}`
}

export function parseExternalCapabilityName(name: string): { connectionId: string; toolName: string } | null {
  if (!name.startsWith(EXTERNAL_CAPABILITY_PREFIX)) return null
  const rest = name.slice(EXTERNAL_CAPABILITY_PREFIX.length)
  const separatorIndex = rest.indexOf(":")
  if (separatorIndex <= 0) return null
  return {
    connectionId: rest.slice(0, separatorIndex),
    toolName: rest.slice(separatorIndex + 1),
  }
}

export type McpMemberIdentity = {
  orgMembershipId: DenTypeId<"member">
  teamIds: DenTypeId<"team">[]
}

/**
 * Resolves the MCP principal (userId + organizationId from the bearer
 * token) to the member identity the grant checks need. Returns null when
 * the user has no active membership — callers should treat that as
 * zero external-capability access, not an error.
 */
export async function resolveMcpMemberIdentity(input: {
  userId: string
  organizationId: string
}): Promise<McpMemberIdentity | null> {
  const organizationId = normalizeDenTypeId("organization", input.organizationId)
  const rows = await db
    .select({ id: MemberTable.id })
    .from(MemberTable)
    .where(and(
      eq(MemberTable.userId, normalizeDenTypeId("user", input.userId)),
      eq(MemberTable.organizationId, organizationId),
      isNull(MemberTable.removedAt),
    ))
    .limit(1)
  const member = rows[0]
  if (!member) return null
  const teams = await listTeamsForMember({ organizationId, memberId: member.id })
  return { orgMembershipId: member.id, teamIds: teams.map((team) => team.id) }
}

function hasSharedCredential(connection: ExternalMcpConnectionRow): boolean {
  if (connection.oauthIssuerReviewRequiredAt) return false
  if (connection.authType === "oauth") return Boolean(connection.accessToken)
  if (connection.authType === "apikey") return Boolean(connection.apiKey)
  return true
}

function redirectUriFor(redirectUriBase: string, connectionId: string): string {
  return `${redirectUriBase}/v1/mcp-connections/${encodeURIComponent(connectionId)}/connect/callback`
}

function scoreText(nameTokens: string[], summaryTokens: string[], queryTokens: string[]): number {
  let score = 0
  for (const queryToken of queryTokens) {
    if (nameTokens.includes(queryToken)) {
      score += 5
    } else if (nameTokens.some((token) => token.startsWith(queryToken) || queryToken.startsWith(token))) {
      score += 3
    }
    if (summaryTokens.includes(queryToken)) {
      score += 2
    }
  }
  return score
}

/**
 * A capability search must never turn an unbounded org connection list into
 * unbounded remote handshakes. Prefer connections whose names match the
 * query, keep source order as the deterministic tiebreaker, and enforce one
 * hard fanout ceiling before any provider network request is started.
 */
export function selectExternalMcpSearchConnections<T extends { name: string }>(
  connections: readonly T[],
  queryTokens: string[],
  limit = EXTERNAL_MCP_SEARCH_CONNECTION_LIMIT,
): T[] {
  return connections
    .map((connection, index) => ({
      connection,
      index,
      score: scoreText(tokenize(connection.name), tokenize(connection.name), queryTokens),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, Math.max(0, Math.min(limit, EXTERNAL_MCP_SEARCH_CONNECTION_LIMIT)))
    .map(({ connection }) => connection)
}

export type ExternalCapabilityMatch = CapabilityMatch & {
  /** Exact MCP arguments schema returned by the provider's live tools/list. */
  argumentsSchema?: unknown
  /** Stable digest used to detect a schema change between search and execute. */
  schemaDigest?: string
  /** Tells the generic execute facade where MCP arguments must be supplied. */
  invocation?: { argumentsField: "body" }
  /** Distinguishes a connection-health result from a callable capability. */
  kind?: "connection_status"
  /** Set for connection-level status rows: the tool exists but needs a human/admin fix before real tools can be listed. */
  status?: "needs_connection" | "error"
  hint?: string
  connectionStatus?: ExternalConnectionStatus
}

export type ExternalConnectionStatus = {
  version: typeof OPENWORK_CLOUD_MCP_CONNECTION_ACTION_VERSION
  kind: typeof OPENWORK_CLOUD_MCP_CONNECTION_ACTION_KIND
  source: typeof OPENWORK_CLOUD_MCP_CONNECTION_ACTION_SOURCE
  layer: "mcp_connection" | "downstream_provider"
  connectionId: string
  connectionName: string
  authType: "oauth" | "apikey" | "none"
  credentialMode: "shared" | "per_member"
  state: "needs_connection" | "reauth_required" | "provider_error"
  errorCode: "not_connected" | "invalid_refresh_token" | "invalid_grant" | "unauthorized" | "provider_error"
  message: string
  actor: ExternalMcpDiagnostic["actionOwner"]
  action: {
    type: "connect" | "reconnect" | "update_credentials" | "inspect_connection" | "fix_provider" | "fix_network" | "contact_openwork"
    label: string
    surface: "openwork_your_connections" | "openwork_organization_connections" | "provider_admin_console" | "network_infrastructure" | "openwork_support"
    retry: "search_capabilities"
    url?: string
  }
}

const ERROR_MESSAGE_LIMIT = 300
const LIVE_PROBE_HINT = "这是实时检查结果，不是缓存；如果没有处理连接问题，重复检索仍会得到相同错误。"
const INVALID_REFRESH_TOKEN_PATTERN = /\binvalid[ _-]?refresh[ _-]?token\b/i
const INVALID_GRANT_PATTERN = /\binvalid[ _-]?grant\b/i
const UNAUTHORIZED_PATTERN = /\b(?:unauthori[sz]ed|invalid[ _-]?token|token (?:is )?expired|expired (?:access )?token)\b/i
const PROVIDER_ADMIN_ACTION_PATTERN = /\b(?:app (?:is )?not installed|admin(?:istrator)? (?:consent|approval)|approval required)\b/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function cappedErrorMessage(message: string): string {
  return message.length > ERROR_MESSAGE_LIMIT ? `${message.slice(0, ERROR_MESSAGE_LIMIT)}...` : message
}

function parsedErrorMessage(value: unknown): string | null {
  if (!isRecord(value)) return null
  const nestedError = value.error
  if (isRecord(nestedError) && typeof nestedError.message === "string") {
    return typeof nestedError.code === "number"
      ? `${nestedError.message} (JSON-RPC ${nestedError.code})`
      : nestedError.message
  }
  if (typeof value.message === "string") return value.message
  if (typeof nestedError === "string") return nestedError
  return null
}

function errorCauseChain(error: unknown): unknown[] {
  const chain: unknown[] = []
  let current: unknown = error
  for (let depth = 0; depth < 6; depth += 1) {
    chain.push(current)
    if (!isRecord(current) || !("cause" in current) || current.cause === undefined) break
    current = current.cause
  }
  return chain
}

export function upstreamErrorMessage(error: unknown): string {
  const chain = errorCauseChain(error)
  const diagnosticError = chain.find((current) => current instanceof ExternalMcpDiagnosticError)
  if (diagnosticError instanceof ExternalMcpDiagnosticError) return diagnosticError.diagnostic.message
  for (const current of [...chain].reverse()) {
    const message = current instanceof Error ? current.message : String(current)
    const jsonStart = message.indexOf("{")
    if (jsonStart >= 0) {
      try {
        const parsed: unknown = JSON.parse(message.slice(jsonStart))
        const parsedMessage = parsedErrorMessage(parsed)
        if (parsedMessage) return parsedMessage
      } catch {
        // Try the next cause when the SDK wrapper contains partial or invalid JSON.
      }
    }
    if (message.trim()) return cappedErrorMessage(message)
  }
  return "MCP 供应商返回了未知错误。"
}

export function externalMcpAuthErrorCode(
  error: unknown,
  message = upstreamErrorMessage(error),
): ExternalConnectionStatus["errorCode"] | null {
  const diagnosticError = errorCauseChain(error)
    .find((current) => current instanceof ExternalMcpDiagnosticError)
  if (diagnosticError instanceof ExternalMcpDiagnosticError) {
    if (diagnosticError.diagnostic.code === "MCP_OAUTH_INVALID_GRANT") return "invalid_grant"
    if (
      diagnosticError.diagnostic.phase === "AUTH_TOKEN_ACQUISITION"
      || diagnosticError.diagnostic.phase === "AUTH_RESOURCE_VALIDATION"
      || diagnosticError.diagnostic.phase === "CONTINUITY_REFRESH"
    ) return "unauthorized"
    // 已有结构化诊断时以其阶段和错误码为准，不能再从供应商自由文本中
    // 猜测鉴权状态，否则普通 JSON-RPC 错误可能被误判成需要重新登录。
    return null
  }
  if (INVALID_REFRESH_TOKEN_PATTERN.test(message)) return "invalid_refresh_token"
  if (INVALID_GRANT_PATTERN.test(message)) return "invalid_grant"
  if (
    errorCauseChain(error).some((current) => (
      current instanceof UnauthorizedError
      || (current instanceof StreamableHTTPError && (current.code === 401 || current.code === 403))
    ))
    || UNAUTHORIZED_PATTERN.test(message)
  ) return "unauthorized"
  return null
}

export function isExternalMcpAuthError(error: unknown): boolean {
  return externalMcpAuthErrorCode(error) !== null
}

export function externalConnectionErrorHint(
  connectionName: string,
  error: unknown,
  message = upstreamErrorMessage(error),
  credentialMode: ExternalMcpConnectionRow["credentialMode"] = "shared",
): string {
  if (error instanceof ExternalMcpDiagnosticError) {
    return `${error.diagnostic.message} 请由提示中的负责人检查对应环节。${error.diagnostic.operatorAction} 诊断编号：${error.diagnostic.referenceId}。${LIVE_PROBE_HINT}`
  }
  if (externalMcpAuthErrorCode(error, message)) {
    const destination = credentialMode === "per_member"
      ? "SeeWayWork 的“我的连接”"
      : "公司管理后台的“MCP 连接”"
    return `“${connectionName}”保存的凭据无效或已过期。请在${destination}重新连接，然后再次检索。公司服务本身仍保持连接。${LIVE_PROBE_HINT}`
  }
  if (PROVIDER_ADMIN_ACTION_PATTERN.test(message)) {
    return `“${connectionName}”的供应商服务器拒绝了请求：${message}。请由供应商管理员在对应后台处理后再次检索。公司服务本身仍保持连接。${LIVE_PROBE_HINT}`
  }
  return `“${connectionName}”的下游供应商返回错误：${message}。请让公司管理员在管理后台检查该连接，然后再次检索。公司服务本身仍保持连接。${LIVE_PROBE_HINT}`
}

function diagnosticConnectionAction(input: {
  connection: Pick<ExternalMcpConnectionRow, "authType">
  state: ExternalConnectionStatus["state"]
  diagnostic: ExternalMcpDiagnostic
}): Pick<ExternalConnectionStatus, "actor" | "action"> {
  const actor = input.diagnostic.actionOwner
  let type: ExternalConnectionStatus["action"]["type"]
  let surface: ExternalConnectionStatus["action"]["surface"]
  if (actor === "openwork") {
    type = "contact_openwork"
    surface = "openwork_support"
  } else if (actor === "network_admin") {
    type = "fix_network"
    surface = "network_infrastructure"
  } else if (actor === "provider_admin") {
    type = "fix_provider"
    surface = "provider_admin_console"
  } else if (actor === "member") {
    type = input.state === "needs_connection" ? "connect" : "reconnect"
    surface = "openwork_your_connections"
  } else {
    type = input.state === "reauth_required"
      ? input.connection.authType === "apikey" ? "update_credentials" : "reconnect"
      : "inspect_connection"
    surface = "openwork_organization_connections"
  }
  return {
    actor,
    action: {
      type,
      surface,
      label: input.diagnostic.operatorAction,
      retry: "search_capabilities",
    },
  }
}

function actionNavigationUrl(input: {
  connectionId: string
  surface: ExternalConnectionStatus["action"]["surface"]
}) {
  if (input.surface === "openwork_your_connections") return openworkYourConnectionsUrl(input.connectionId)
  if (input.surface === "openwork_organization_connections") return openworkOrganizationConnectionsUrl()
  return undefined
}

function addConnectionActionUrl(input: {
  action: ExternalConnectionStatus["action"]
  connectionId: string
}): ExternalConnectionStatus["action"] {
  const url = actionNavigationUrl({ connectionId: input.connectionId, surface: input.action.surface })
  return url ? { ...input.action, url } : input.action
}

function relayableProviderConnectUrl(connectUrl: string | undefined, connectionUrl: string): string | undefined {
  if (!connectUrl) return undefined
  try {
    const candidate = new URL(connectUrl)
    const connection = new URL(connectionUrl)
    if (candidate.host !== connection.host) return undefined
    return candidate.protocol === "http:" || candidate.protocol === "https:" ? candidate.toString() : undefined
  } catch {
    return undefined
  }
}

function providerAuthorizationDiagnosticForConnection(input: {
  diagnostic: ExternalMcpDiagnostic
  connectionUrl: string
}): ExternalMcpDiagnostic {
  if (!input.diagnostic.connectUrl) return input.diagnostic
  const connectUrl = relayableProviderConnectUrl(input.diagnostic.connectUrl, input.connectionUrl)
  if (!connectUrl) {
    const diagnostic = { ...input.diagnostic }
    delete diagnostic.connectUrl
    return diagnostic
  }
  return connectUrl === input.diagnostic.connectUrl
    ? input.diagnostic
    : { ...input.diagnostic, connectUrl }
}

function providerAuthorizationConnectionStatus(input: {
  connection: Pick<ExternalMcpConnectionRow, "id" | "name" | "authType" | "credentialMode">
  diagnostic: ExternalMcpDiagnostic
  message: string
}): ExternalConnectionStatus {
  const status = buildExternalConnectionStatus({
    connection: input.connection,
    state: "needs_connection",
    errorCode: "not_connected",
    message: input.message,
    diagnostic: input.diagnostic,
    actionOwner: "member",
    layer: "downstream_provider",
  })
  return {
    ...status,
    actor: "member",
    action: {
      type: "connect",
      label: "连接你的供应商账号",
      surface: "openwork_your_connections",
      retry: "search_capabilities",
      ...(input.diagnostic.connectUrl ? { url: input.diagnostic.connectUrl } : {}),
    },
  }
}

export function buildExternalConnectionStatus(input: {
  connection: Pick<ExternalMcpConnectionRow, "id" | "name" | "authType" | "credentialMode">
  state: ExternalConnectionStatus["state"]
  errorCode: ExternalConnectionStatus["errorCode"]
  message: string
  diagnostic?: ExternalMcpDiagnostic
  actionOwner?: "member" | "organization_admin"
  layer?: ExternalConnectionStatus["layer"]
}): ExternalConnectionStatus {
  const connectionName = input.connection.name
  const actionContract = {
    version: OPENWORK_CLOUD_MCP_CONNECTION_ACTION_VERSION,
    kind: OPENWORK_CLOUD_MCP_CONNECTION_ACTION_KIND,
    source: OPENWORK_CLOUD_MCP_CONNECTION_ACTION_SOURCE,
  } as const
  // Once the failure is classified as reauthentication, credential ownership
  // is the source of truth for who can repair it. A generic HTTP 400 during a
  // refresh may classify the raw diagnostic as provider_admin, but routing a
  // per-member expired token to a provider console contradicts the
  // reauth_required state and prevents the client from offering reconnect.
  const diagnosticAction = input.diagnostic && input.state !== "reauth_required"
    ? diagnosticConnectionAction({ connection: input.connection, state: input.state, diagnostic: input.diagnostic })
    : null
  if (input.state === "provider_error") {
    const providerAdminAction = PROVIDER_ADMIN_ACTION_PATTERN.test(input.message)
    return {
      ...actionContract,
      layer: input.layer ?? (input.diagnostic ? "mcp_connection" : "downstream_provider"),
      connectionId: input.connection.id,
      connectionName,
      authType: input.connection.authType,
      credentialMode: input.connection.credentialMode,
      state: input.state,
      errorCode: input.errorCode,
      message: input.message,
      actor: diagnosticAction?.actor ?? (providerAdminAction ? "provider_admin" : "organization_admin"),
      action: diagnosticAction
        ? addConnectionActionUrl({ action: diagnosticAction.action, connectionId: input.connection.id })
        : addConnectionActionUrl({
          connectionId: input.connection.id,
          action: {
            type: providerAdminAction ? "fix_provider" : "inspect_connection",
            label: providerAdminAction
              ? `前往供应商后台处理 ${connectionName}`
              : `检查 ${connectionName} 连接`,
            surface: providerAdminAction ? "provider_admin_console" : "openwork_organization_connections",
            retry: "search_capabilities",
          },
        }),
    }
  }

  const actor = input.actionOwner
    ?? (input.connection.credentialMode === "per_member" ? "member" : "organization_admin")
  const surface = actor === "member"
    ? "openwork_your_connections"
    : "openwork_organization_connections"
  const actionType = input.state === "needs_connection"
    ? "connect"
    : input.connection.authType === "oauth"
      ? "reconnect"
      : input.connection.authType === "apikey"
        ? "update_credentials"
        : "inspect_connection"
  const actionVerb = actionType === "connect"
    ? "连接"
    : actionType === "reconnect"
      ? "重新连接"
      : actionType === "update_credentials"
        ? "更新凭据"
        : "检查"
  return {
    ...actionContract,
    layer: input.layer ?? (input.diagnostic ? "mcp_connection" : "downstream_provider"),
    connectionId: input.connection.id,
    connectionName,
    authType: input.connection.authType,
    credentialMode: input.connection.credentialMode,
    state: input.state,
    errorCode: input.errorCode,
    message: input.message,
    actor: diagnosticAction?.actor ?? actor,
    action: diagnosticAction
      ? addConnectionActionUrl({ action: diagnosticAction.action, connectionId: input.connection.id })
      : addConnectionActionUrl({
        connectionId: input.connection.id,
        action: {
          type: actionType,
          label: `${actionVerb}“${connectionName}”`,
          surface,
          retry: "search_capabilities",
        },
      }),
  }
}

function statusMatch(input: {
  connection: ExternalMcpConnectionRow
  score: number
  summary: string
  status: ExternalCapabilityMatch["status"]
  hint: string
  connectionStatus: ExternalConnectionStatus
}): ExternalCapabilityMatch {
  return {
    name: buildExternalCapabilityName(input.connection.id, "*"),
    method: "MCP",
    path: input.connection.url,
    score: input.score,
    summary: input.summary,
    pathParams: [],
    queryParams: [],
    hasBody: false,
    kind: "connection_status",
    status: input.status,
    hint: input.hint,
    connectionStatus: input.connectionStatus,
  }
}

export function mergeBoundedExternalCapabilityMatches(
  retained: ExternalCapabilityMatch[],
  candidates: readonly ExternalCapabilityMatch[],
  limit: number,
): ExternalCapabilityMatch[] {
  const boundedLimit = Number.isFinite(limit)
    ? Math.max(0, Math.min(Math.floor(limit), EXTERNAL_MCP_SEARCH_MATCH_LIMIT))
    : 0
  if (boundedLimit === 0) {
    retained.splice(0)
    return retained
  }
  for (const candidate of candidates) {
    retained.push(candidate)
    retained.sort(compareCapabilityMatches)
    if (retained.length > boundedLimit) retained.splice(boundedLimit)
  }
  return retained
}

export async function collectBoundedExternalMcpSearchMatches<T>(input: {
  connections: readonly T[]
  deadline: ExternalMcpLifecycleDeadline
  limit: number
  concurrency?: number
  probe: (connection: T, deadline: ExternalMcpLifecycleDeadline) => Promise<ExternalCapabilityMatch[]>
}): Promise<ExternalCapabilityMatch[]> {
  const retained: ExternalCapabilityMatch[] = []
  const boundedLimit = Number.isFinite(input.limit)
    ? Math.max(0, Math.min(Math.floor(input.limit), EXTERNAL_MCP_SEARCH_MATCH_LIMIT))
    : 0
  if (boundedLimit === 0 || input.connections.length === 0) return retained

  const concurrency = Math.max(1, Math.min(
    Math.floor(input.concurrency ?? EXTERNAL_MCP_SEARCH_CONCURRENCY),
    EXTERNAL_MCP_SEARCH_CONCURRENCY,
    input.connections.length,
  ))
  let nextIndex = 0
  let acceptingResults = true
  const worker = async () => {
    while (Date.now() < input.deadline.expiresAt) {
      const index = nextIndex
      nextIndex += 1
      if (index >= input.connections.length) return
      const candidates = await input.probe(input.connections[index]!, input.deadline)
      if (acceptingResults) mergeBoundedExternalCapabilityMatches(retained, candidates, boundedLimit)
    }
  }
  const workers = Promise.all(Array.from({ length: concurrency }, () => worker()))
  const remaining = Math.max(0, input.deadline.expiresAt - Date.now())
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined
  const deadlineReached = new Promise<void>((resolve) => {
    deadlineTimer = setTimeout(resolve, remaining)
  })
  try {
    await Promise.race([workers, deadlineReached])
  } finally {
    acceptingResults = false
    if (deadlineTimer) clearTimeout(deadlineTimer)
    // Active MCP requests receive the same absolute deadline and abort their
    // fetch at this point. Keep a rejection observer on the worker pool for
    // the smaller class of non-fetch operations that cannot be cancelled.
    void workers.catch(() => undefined)
  }
  return retained
}

export type ExternalMcpSearchCoverage = {
  eligibleConnections: number
  probedConnections: number
  truncated: boolean
}

export function externalMcpSearchCoverageHint(coverage: ExternalMcpSearchCoverage): string | undefined {
  if (!coverage.truncated) return undefined
  return `本次只检查了 ${coverage.eligibleConnections} 个可用连接中的 ${coverage.probedConnections} 个，结果可能不完整。请加入连接名称缩小范围后再次检索。`
}

async function probeExternalMcpConnection(input: {
  connection: ExternalMcpConnectionRow
  member: McpMemberIdentity
  queryTokens: string[]
  redirectUriBase: string
  limit: number
  deadline: ExternalMcpLifecycleDeadline
}): Promise<ExternalCapabilityMatch[]> {
  const matches: ExternalCapabilityMatch[] = []
  const add = (match: ExternalCapabilityMatch) => {
    mergeBoundedExternalCapabilityMatches(matches, [match], input.limit)
  }
  const connection = input.connection
  if (connection.oauthIssuerReviewRequiredAt) {
    const nameTokens = tokenize(connection.name)
    const score = scoreText(nameTokens, nameTokens, input.queryTokens)
    if (score > 0) {
      const message = `“${connection.name}”的 OAuth 发行方发生变化，需要公司管理员确认后才能继续使用。`
      add(statusMatch({
        connection,
        score,
        summary: `【${connection.name}】OAuth 供应商设置已变化，需要管理员确认。`,
        status: "error",
        hint: `请让公司管理员在后台打开“MCP 连接”，确认“${connection.name}”当前的 OAuth 发行方；如页面提示，请重新连接。`,
        connectionStatus: buildExternalConnectionStatus({
          connection,
          state: "reauth_required",
          errorCode: "unauthorized",
          message,
          actionOwner: "organization_admin",
        }),
      }))
    }
    return matches
  }
  if (connection.credentialMode === "per_member") {
    const account = await getConnectedAccount({
      organizationId: connection.organizationId,
      orgMembershipId: input.member.orgMembershipId,
      providerId: connection.id,
    })
    if (!account?.accessToken) {
      // Granted but not yet connected: surface the connection itself (not
      // its tools — we can't list them without the member's credential) so
      // the agent can tell the human exactly what to do.
      const nameTokens = tokenize(connection.name)
      const score = scoreText(nameTokens, nameTokens, input.queryTokens)
      if (score > 0) {
        const message = `你还没有连接“${connection.name}”账号。`
        add(statusMatch({
          connection,
          score,
          summary: `【${connection.name}】已向你开放，但尚未连接个人账号。`,
          status: "needs_connection",
          hint: `请在 SeeWayWork 的“我的连接”中连接“${connection.name}”，完成后再次检索。`,
          connectionStatus: buildExternalConnectionStatus({ connection, state: "needs_connection", errorCode: "not_connected", message }),
        }))
      }
      return matches
    }
  } else if (!hasSharedCredential(connection)) {
    const nameTokens = tokenize(connection.name)
    const score = scoreText(nameTokens, nameTokens, input.queryTokens)
    if (score > 0) {
      const message = `“${connection.name}”尚未完成公司连接。`
      add(statusMatch({
        connection,
        score,
        summary: `【${connection.name}】已加入公司能力目录，但管理员尚未完成连接。`,
        status: "needs_connection",
        hint: `请让公司管理员在后台的“MCP 连接”中完成“${connection.name}”配置，然后再次检索。`,
        connectionStatus: buildExternalConnectionStatus({ connection, state: "needs_connection", errorCode: "not_connected", message }),
      }))
    }
    return matches
  }

  const member = connection.credentialMode === "per_member"
    ? { orgMembershipId: input.member.orgMembershipId }
    : undefined
  let tools: Awaited<ReturnType<typeof listExternalMcpTools>>
  try {
    tools = await listExternalMcpTools(
      connection,
      redirectUriFor(input.redirectUriBase, connection.id),
      member,
      undefined,
      input.deadline,
    )
  } catch (error) {
    const message = upstreamErrorMessage(error)
    const diagnostic = error instanceof ExternalMcpDiagnosticError ? error.diagnostic : undefined
    const nameTokens = tokenize(connection.name)
    const score = scoreText(nameTokens, nameTokens, input.queryTokens)
    if (score > 0) {
      if (diagnostic) {
        console.error("external_mcp_capability_search_probe_failed", {
          connectionId: connection.id,
          organizationId: connection.organizationId,
          connectionEndpoint: safeExternalMcpEndpointForLog(connection.url),
          ...externalMcpDiagnosticForLog(error, diagnostic.referenceId, "MCP_TOOL_DISCOVERY"),
        })
      }
      const authErrorCode = externalMcpAuthErrorCode(error, message)
      const state = authErrorCode ? "reauth_required" : "provider_error"
      add(statusMatch({
        connection,
        score,
        summary: `【${connection.name}】连接已配置，但检查时返回错误（${message}）。`,
        status: "error",
        hint: externalConnectionErrorHint(connection.name, error, message, connection.credentialMode),
        connectionStatus: buildExternalConnectionStatus({
          connection,
          state,
          errorCode: authErrorCode ?? "provider_error",
          message,
          diagnostic,
        }),
      }))
    }
    return matches
  }

  for (const tool of tools) {
    const summary = tool.description ?? tool.title ?? tool.name
    const nameTokens = tokenize(`${connection.name} ${tool.name}`)
    const summaryTokens = tokenize(summary)
    const score = scoreText(nameTokens, summaryTokens, input.queryTokens)
    if (score <= 0) continue
    add({
      name: buildExternalCapabilityName(connection.id, tool.name),
      method: "MCP",
      path: connection.url,
      score,
      summary: `[${connection.name}] ${summary}`,
      pathParams: [],
      queryParams: [],
      hasBody: true,
      argumentsSchema: tool.inputSchema,
      schemaDigest: externalMcpToolSchemaDigest(tool.inputSchema),
      invocation: { argumentsField: "body" },
    })
  }
  return matches
}

/**
 * Live-lists tools for a bounded set of external MCP connections the calling
 * member has been granted. All probes share one absolute deadline and run in
 * a small worker pool; one unreachable server cannot serialize the latency of
 * every other provider or let matches grow beyond the requested top-K.
 */
export async function searchExternalCapabilities(input: {
  organizationId: string
  member: McpMemberIdentity | null
  query: string
  redirectUriBase: string
  limit?: number
  reportCoverage?: (coverage: ExternalMcpSearchCoverage) => void
}): Promise<ExternalCapabilityMatch[]> {
  if (!input.member) return []
  const queryTokens = tokenize(input.query)
  if (queryTokens.length === 0) return []
  const requestedLimit = input.limit ?? 5
  if (!Number.isFinite(requestedLimit) || requestedLimit <= 0) return []
  const limit = Math.min(Math.max(1, Math.trunc(requestedLimit)), EXTERNAL_MCP_SEARCH_MATCH_LIMIT)
  const deadline = createExternalMcpLifecycleDeadline()
  const connections = await listUsableExternalMcpConnections({
    organizationId: normalizeDenTypeId("organization", input.organizationId),
    orgMembershipId: input.member.orgMembershipId,
    teamIds: input.member.teamIds,
  })
  const selectedConnections = selectExternalMcpSearchConnections(connections, queryTokens)
  input.reportCoverage?.({
    eligibleConnections: connections.length,
    probedConnections: selectedConnections.length,
    truncated: selectedConnections.length < connections.length,
  })
  return await collectBoundedExternalMcpSearchMatches({
    connections: selectedConnections,
    deadline,
    limit,
    probe: (connection, sharedDeadline) => probeExternalMcpConnection({
      connection,
      member: input.member!,
      queryTokens,
      redirectUriBase: input.redirectUriBase,
      limit,
      deadline: sharedDeadline,
    }),
  })
}

export type ExternalMcpSchemaWarning =
  | {
      code: "arguments_schema_mismatch"
      message: string
      issues: ExternalMcpArgumentIssue[]
      suggestedAction: string
    }
  | {
      code: "arguments_schema_unavailable"
      message: string
      suggestedAction: string
    }
  | {
      code: "capability_schema_changed"
      message: string
      searchedSchemaDigest: string
      currentSchemaDigest: string
      suggestedAction: string
    }

export type ExternalMcpSchemaGuidance = {
  advisory: true
  providerCallAttempted: true
  message: string
  warnings: ExternalMcpSchemaWarning[]
}

export type ExternalCapabilityExecuteResult =
  | {
      ok: true
      result: Awaited<ReturnType<typeof callExternalMcpTool>>
      schemaGuidance?: ExternalMcpSchemaGuidance
    }
  | {
      ok: false
      error:
        | "unknown_capability"
        | "forbidden"
        | "connection_not_connected"
        | "needs_connection"
        | "connection_failed"
        | "provider_error"
        | "invalid_capability_arguments"
      message: string
      referenceId?: string
      retryable?: boolean
      providerError?: ExternalMcpProviderError
      connectionStatus?: ExternalConnectionStatus
      capability?: string
      issues?: ExternalMcpArgumentIssue[]
      schemaDigest?: string
      sameArgumentsRetryable?: false
      retry?: {
        action: "correct_arguments" | "search_capabilities"
        searchRequired: boolean
      }
      schemaGuidance?: ExternalMcpSchemaGuidance
    }

export type ExternalMcpProviderError = {
  jsonRpcCode?: number
  message?: string
  data?: string
}

function providerErrorFromDiagnostic(diagnostic: ExternalMcpDiagnostic): ExternalMcpProviderError | undefined {
  if (
    diagnostic.jsonRpcCode === undefined
    && !diagnostic.providerErrorMessage
    && !diagnostic.providerErrorData
  ) return undefined
  return {
    ...(diagnostic.jsonRpcCode === undefined ? {} : { jsonRpcCode: diagnostic.jsonRpcCode }),
    ...(diagnostic.providerErrorMessage ? { message: diagnostic.providerErrorMessage } : {}),
    ...(diagnostic.providerErrorData ? { data: diagnostic.providerErrorData } : {}),
  }
}

function diagnosticAgentMessage(diagnostic: ExternalMcpDiagnostic): string {
  return `${diagnostic.message} ${diagnostic.operatorAction} 诊断编号：${diagnostic.referenceId}。`
}

function diagnosticAgentFields(diagnostic: ExternalMcpDiagnostic) {
  const providerError = providerErrorFromDiagnostic(diagnostic)
  return {
    referenceId: diagnostic.referenceId,
    retryable: diagnostic.retryable,
    ...(providerError ? { providerError } : {}),
  }
}

function invalidCapabilityArguments(input: {
  capability: string
  schemaDigest?: string
  issues?: ExternalMcpArgumentIssue[]
  diagnostic?: ExternalMcpDiagnostic
  schemaGuidance?: ExternalMcpSchemaGuidance
}): Exclude<ExternalCapabilityExecuteResult, { ok: true }> {
  return {
    ok: false,
    error: "invalid_capability_arguments",
    capability: input.capability,
    message: input.diagnostic
      ? `远程 MCP 拒绝了当前参数。请按最新 argumentsSchema 修正。诊断编号：${input.diagnostic.referenceId}。`
      : "当前参数不符合远程 MCP 工具声明的 argumentsSchema。",
    issues: input.issues ?? [{
      path: "/",
      keyword: "schema_validation",
      message: "远程 MCP 拒绝了这些参数，请按最新 argumentsSchema 修正。",
    }],
    ...(input.schemaDigest ? { schemaDigest: input.schemaDigest } : {}),
    sameArgumentsRetryable: false,
    retry: { action: "correct_arguments", searchRequired: false },
    ...(input.schemaGuidance ? { schemaGuidance: input.schemaGuidance } : {}),
    ...(input.diagnostic ? diagnosticAgentFields(input.diagnostic) : {}),
  }
}

function advisorySchemaGuidance(
  warnings: ExternalMcpSchemaWarning[],
): ExternalMcpSchemaGuidance | undefined {
  if (warnings.length === 0) return undefined
  return {
    advisory: true,
    providerCallAttempted: true,
    message: "SeeWayWork 已将调用转发给供应商。本地 Schema 检查只作提示，最终以供应商返回结果为准。",
    warnings,
  }
}

/**
 * Executes a namespaced external capability, scoped to the calling
 * principal's org AND member: the member must hold a grant (org-wide,
 * direct, or team), and for per-member connections must have connected
 * their own account — the call then runs as them.
 */
export async function executeExternalCapability(input: {
  organizationId: string
  member: McpMemberIdentity | null
  connectionId: string
  toolName: string
  args: unknown
  schemaDigest?: string
  redirectUriBase: string
}): Promise<ExternalCapabilityExecuteResult> {
  if (!input.member) {
    return { ok: false, error: "forbidden", message: "当前登录令牌没有有效的公司成员身份。" }
  }

  let connection: Awaited<ReturnType<typeof getExternalMcpConnection>>
  let connectionId: DenTypeId<"externalMcpConnection">
  try {
    connectionId = normalizeDenTypeId("externalMcpConnection", input.connectionId)
    connection = await getExternalMcpConnection({
      organizationId: normalizeDenTypeId("organization", input.organizationId),
      connectionId,
    })
  } catch {
    // A malformed connectionId (e.g. hand-typed by an agent) isn't a server
    // error — it's the same "no such capability" outcome as a valid-shaped
    // but nonexistent id, so surface the same clean error either way.
    connection = null
    connectionId = input.connectionId as DenTypeId<"externalMcpConnection">
  }
  if (!connection) {
    return { ok: false, error: "unknown_capability", message: `公司中不存在 MCP 连接“${input.connectionId}”。` }
  }

  const canUse = await memberCanUseExternalMcpConnection({
    connectionId,
    orgMembershipId: input.member.orgMembershipId,
    teamIds: input.member.teamIds,
  })
  if (!canUse) {
    return { ok: false, error: "forbidden", message: `你的账号尚未获准使用“${connection.name}”。` }
  }

  if (connection.oauthIssuerReviewRequiredAt) {
    const message = `“${connection.name}”的 OAuth 发行方发生变化，需要公司管理员确认后才能继续使用。`
    return {
      ok: false,
      error: "needs_connection",
      message,
      connectionStatus: buildExternalConnectionStatus({
        connection,
        state: "reauth_required",
        errorCode: "unauthorized",
        message,
        actionOwner: "organization_admin",
      }),
    }
  }

  if (input.toolName === "*") {
    const message = `“${connection.name}”当前只返回连接状态，不能直接调用。请先按检索提示修复连接，再重新检索真实工具。`
    return {
      ok: false,
      error: "needs_connection",
      message,
      connectionStatus: buildExternalConnectionStatus({ connection, state: "needs_connection", errorCode: "not_connected", message }),
    }
  }

  let member: { orgMembershipId: DenTypeId<"member"> } | undefined
  if (connection.credentialMode === "per_member") {
    const account = await getConnectedAccount({
      organizationId: connection.organizationId,
      orgMembershipId: input.member.orgMembershipId,
      providerId: connection.id,
    })
    if (!account?.accessToken) {
      return {
        ok: false,
        error: "needs_connection",
        message: `你还没有连接“${connection.name}”账号。请在 SeeWayWork 的“我的连接”中完成连接。`,
        connectionStatus: buildExternalConnectionStatus({
          connection,
          state: "needs_connection",
          errorCode: "not_connected",
          message: `你还没有连接“${connection.name}”账号。`,
        }),
      }
    }
    member = { orgMembershipId: input.member.orgMembershipId }
  } else if (!hasSharedCredential(connection)) {
    const message = `“${connection.name}”尚未完成公司连接。`
    return {
      ok: false,
      error: "connection_not_connected",
      message,
      connectionStatus: buildExternalConnectionStatus({ connection, state: "needs_connection", errorCode: "not_connected", message }),
    }
  }

  let currentSchemaDigest: string | undefined
  let schemaGuidance: ExternalMcpSchemaGuidance | undefined
  const deadline = createExternalMcpLifecycleDeadline(EXTERNAL_MCP_TOOL_LIFECYCLE_TIMEOUT_MS)
  try {
    const redirectUri = redirectUriFor(input.redirectUriBase, connection.id)
    const tools = await listExternalMcpTools(connection, redirectUri, member, undefined, deadline)
    const tool = tools.find((candidate) => candidate.name === input.toolName)
    if (!tool) {
      return {
        ok: false,
        error: "unknown_capability",
        capability: buildExternalCapabilityName(connection.id, input.toolName),
        message: `“${connection.name}”当前没有名为“${input.toolName}”的工具，请重新调用 search_capabilities。`,
        sameArgumentsRetryable: false,
        retry: { action: "search_capabilities", searchRequired: true },
      }
    }

    const schemaDigest = externalMcpToolSchemaDigest(tool.inputSchema)
    currentSchemaDigest = schemaDigest
    const schemaWarnings: ExternalMcpSchemaWarning[] = []
    if (input.schemaDigest && input.schemaDigest !== schemaDigest) {
      schemaWarnings.push({
        code: "capability_schema_changed",
        message: "供应商在检索后返回了不同的能力 Schema，但 SeeWayWork 仍已转发本次调用。",
        searchedSchemaDigest: input.schemaDigest,
        currentSchemaDigest: schemaDigest,
        suggestedAction: "如果供应商调用失败，请重新调用 search_capabilities，并按最新 argumentsSchema 重试；如果调用成功，无需只因本提示再次执行。",
      })
    }

    // MCP tool arguments are always an object at the protocol boundary. Start
    // the provider call before advisory validation so a provider with an
    // inaccurate or unsupported advertised schema still gets the request.
    const forwardedArguments = isRecord(input.args) ? input.args : {}
    const providerCall = callExternalMcpTool({
      connection,
      redirectUri,
      toolName: input.toolName,
      args: forwardedArguments,
      member,
      lifecycleDeadline: deadline,
    })

    const validation = validateExternalMcpToolArguments(tool.inputSchema, input.args)
    if (!validation.ok && validation.error === "invalid_arguments") {
      schemaWarnings.push({
        code: "arguments_schema_mismatch",
        message: "参数不符合供应商声明的 argumentsSchema，但供应商可能仍会接受，因此 SeeWayWork 已继续转发。",
        issues: validation.issues,
        suggestedAction: "如果供应商调用失败，请修正列出的问题后使用新参数重试；如果调用成功，无需只因本提示再次执行。",
      })
    } else if (!validation.ok) {
      schemaWarnings.push({
        code: "arguments_schema_unavailable",
        message: validation.message,
        suggestedAction: "以供应商返回结果为准。如果调用失败，可能需要由供应商管理员修复其声明的 inputSchema。",
      })
    }

    schemaGuidance = advisorySchemaGuidance(schemaWarnings)
    const result = await providerCall
    return {
      ok: true,
      result,
      ...(schemaGuidance ? { schemaGuidance } : {}),
    }
  } catch (error) {
    const message = upstreamErrorMessage(error)
    const authErrorCode = externalMcpAuthErrorCode(error, message)
    if (error instanceof ExternalMcpDiagnosticError) {
      const diagnostic = error.diagnostic.code === "MCP_PROVIDER_AUTH_REQUIRED"
        ? providerAuthorizationDiagnosticForConnection({ diagnostic: error.diagnostic, connectionUrl: connection.url })
        : error.diagnostic
      const log = externalMcpDiagnosticForLog(error, error.diagnostic.referenceId, "MCP_TOOL_EXECUTION")
      console.error("external_mcp_capability_execute_failed", {
        connectionId: connection.id,
        organizationId: connection.organizationId,
        connectionEndpoint: safeExternalMcpEndpointForLog(connection.url),
        ...log,
        diagnostic,
      })
      if (diagnostic.code === "MCP_INVALID_PARAMS" || diagnostic.code === "MCP_PROVIDER_INVALID_PARAMS") {
        return invalidCapabilityArguments({
          capability: buildExternalCapabilityName(connection.id, input.toolName),
          schemaDigest: currentSchemaDigest ?? input.schemaDigest,
          diagnostic,
          schemaGuidance,
        })
      }
      if (diagnostic.code === "MCP_PROVIDER_AUTH_REQUIRED") {
        const resultMessage = `${diagnostic.message} ${diagnostic.operatorAction} 诊断编号：${diagnostic.referenceId}。`
        return {
          ok: false,
          error: "needs_connection",
          message: resultMessage,
          ...diagnosticAgentFields(diagnostic),
          connectionStatus: providerAuthorizationConnectionStatus({
            connection,
            diagnostic,
            message: resultMessage,
          }),
          ...(schemaGuidance ? { schemaGuidance } : {}),
        }
      }
      return {
        ok: false,
        error: diagnostic.phase === "PROVIDER_EXECUTION" || diagnostic.phase === "PROVIDER_AUTHORIZATION"
          ? "provider_error"
          : "connection_failed",
        message: diagnosticAgentMessage(diagnostic),
        ...diagnosticAgentFields(diagnostic),
        ...(schemaGuidance ? { schemaGuidance } : {}),
        ...(authErrorCode
          ? {
              connectionStatus: buildExternalConnectionStatus({
                connection,
                state: "reauth_required",
                errorCode: authErrorCode,
                message,
                diagnostic,
              }),
            }
          : {}),
      }
    }
    if (authErrorCode) {
      return {
        ok: false,
        error: "connection_failed",
        message,
        ...(schemaGuidance ? { schemaGuidance } : {}),
        connectionStatus: buildExternalConnectionStatus({
          connection,
          state: "reauth_required",
          errorCode: authErrorCode,
          message,
        }),
      }
    }
    throw error
  }
}
