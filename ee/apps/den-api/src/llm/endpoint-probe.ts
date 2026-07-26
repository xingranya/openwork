/**
 * Endpoint probing for custom LLM providers ("test connection").
 *
 * Given a base URL and credential, discover what the endpoint actually
 * serves: normalize common URL mistakes (trailing `/responses`, Azure host
 * twins), call the OpenAI-compatible `GET /models`, and return the model
 * ids — on Azure these are the deployment names, which is exactly what the
 * provider config needs. Pure logic is separated from I/O so it can be
 * unit-tested with an injected fetch.
 */

type JsonRecord = Record<string, unknown>

export type ProbeProtocol = "openai" | "anthropic"
export type ProbeVendor = "azure" | "openai-compatible" | "anthropic"

export type EndpointProbeResult = {
  ok: boolean
  vendor: ProbeVendor
  /** The candidate base URL that answered /models, when ok. */
  normalizedApi: string | null
  /** Every candidate URL that was attempted, in order. */
  attempted: string[]
  models: Array<{ id: string }>
  /** Human guidance when not ok. */
  hint: string | null
  /** Upstream HTTP status of the last failed attempt, when relevant. */
  status: number | null
}

const AZURE_HOST_PATTERN = /\.(openai\.azure\.com|services\.ai\.azure\.com|cognitiveservices\.azure\.com)$/i

const STRIP_SUFFIXES = [
  "/chat/completions",
  "/completions",
  "/responses",
  "/messages",
  "/models",
]

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function detectVendor(url: string, protocol: ProbeProtocol = "openai"): ProbeVendor {
  if (protocol === "anthropic") return "anthropic"
  try {
    const { hostname } = new URL(url)
    if (AZURE_HOST_PATTERN.test(hostname)) return "azure"
  } catch {
    // fall through
  }
  return "openai-compatible"
}

function normalizeBase(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    url.hash = ""
    url.search = ""
    let pathname = url.pathname.replace(/\/+$/, "")
    for (const suffix of STRIP_SUFFIXES) {
      if (pathname.toLowerCase().endsWith(suffix)) {
        pathname = pathname.slice(0, -suffix.length)
        break
      }
    }
    url.pathname = pathname
    return url.toString().replace(/\/+$/, "")
  } catch {
    return null
  }
}

function azureHostTwin(base: string): string | null {
  try {
    const url = new URL(base)
    if (/\.openai\.azure\.com$/i.test(url.hostname)) {
      url.hostname = url.hostname.replace(/\.openai\.azure\.com$/i, ".services.ai.azure.com")
      return url.toString().replace(/\/+$/, "")
    }
    if (/\.services\.ai\.azure\.com$/i.test(url.hostname)) {
      url.hostname = url.hostname.replace(/\.services\.ai\.azure\.com$/i, ".openai.azure.com")
      return url.toString().replace(/\/+$/, "")
    }
  } catch {
    // ignore
  }
  return null
}

function withAzureV1Path(base: string): string | null {
  try {
    const url = new URL(base)
    if (!AZURE_HOST_PATTERN.test(url.hostname)) return null
    if (url.pathname === "" || url.pathname === "/") {
      url.pathname = "/openai/v1"
      return url.toString().replace(/\/+$/, "")
    }
  } catch {
    // ignore
  }
  return null
}

function withApiV1Path(base: string): string | null {
  try {
    const url = new URL(base)
    if (url.pathname === "" || url.pathname === "/") {
      url.pathname = "/v1"
      return url.toString().replace(/\/+$/, "")
    }
  } catch {
    // ignore
  }
  return null
}

/**
 * Ordered, deduplicated list of base URLs to try. The user's (normalized)
 * input always comes first; Azure-specific rewrites follow — the host twin
 * (`openai.azure.com` <-> `services.ai.azure.com`) and the bare-origin
 * `/openai/v1` path, both mistakes we have watched real users make.
 */
export function buildCandidateBaseUrls(raw: string, protocol: ProbeProtocol = "openai"): string[] {
  const first = normalizeBase(raw)
  if (!first) return []
  const candidates: string[] = [first]

  if (protocol === "anthropic") {
    const apiV1 = withApiV1Path(first)
    if (apiV1) candidates.push(apiV1)
  }

  const v1 = withAzureV1Path(first)
  if (v1) candidates.push(v1)

  const twin = azureHostTwin(first)
  if (twin) {
    candidates.push(twin)
    const twinV1 = withAzureV1Path(twin)
    if (twinV1) candidates.push(twinV1)
  }

  return [...new Set(candidates)].slice(0, 6)
}

function isBlockedHostname(hostname: string, allowLoopback: boolean): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "")
  if (normalized === "metadata.google.internal") return true
  if (normalized === "169.254.169.254" || normalized.startsWith("169.254.")) return true
  if (normalized === "fd00:ec2::254") return true
  const loopback =
    normalized === "localhost" ||
    normalized === "::1" ||
    /^127\./.test(normalized)
  if (loopback) return !allowLoopback
  // Private ranges: allowed for self-hosted installs reaching internal
  // gateways; the metadata/link-local blocks above are the hard rule.
  return false
}

export function assertProbeUrlAllowed(url: string, options?: { allowLoopback?: boolean }) {
  const allowLoopback = options?.allowLoopback ?? process.env.OPENWORK_DEV_MODE === "1"
  const parsed = new URL(url)
  if (isBlockedHostname(parsed.hostname, allowLoopback)) {
    throw new EndpointProbeBlockedError(`出于安全原因，不能探测 ${parsed.hostname}。`)
  }
}

export class EndpointProbeBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EndpointProbeBlockedError"
  }
}

const MAX_RESPONSE_BYTES = 512 * 1024
const PROBE_TIMEOUT_MS = 8_000

type FetchLike = (url: string, init: RequestInit) => Promise<Response>

async function readBoundedJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new Error("模型服务返回的数据过大，无法读取模型列表。")
  }
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const AZURE_DEPLOYMENTS_API_VERSION = "2023-03-15-preview"

/**
 * On Azure, `GET /openai/v1/models` often answers with the full Azure model
 * catalog (hundreds of ids, most of them not deployed on the resource), while
 * chat/completions only accepts *deployment* names. The legacy deployments
 * endpoint lists what is actually deployed — exactly what the model picker
 * needs — so it is preferred, with /models as the fallback.
 */
async function listAzureDeployments(
  fetchImpl: FetchLike,
  base: string,
  apiKey: string,
): Promise<string[] | null> {
  let origin: string
  try {
    origin = new URL(base).origin
  } catch {
    return null
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const response = await fetchImpl(
      `${origin}/openai/deployments?api-version=${AZURE_DEPLOYMENTS_API_VERSION}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "api-key": apiKey,
        },
        signal: controller.signal,
        redirect: "error",
      },
    )
    if (!response.ok) return null
    const payload = await readBoundedJson(response)
    const ids = parseModelIds(payload)
    return ids && ids.length > 0 ? ids : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function parseModelIds(payload: unknown): string[] | null {
  if (!isRecord(payload)) return null
  const data = payload.data
  if (!Array.isArray(data)) return null
  const ids = data.flatMap((entry) => {
    if (!isRecord(entry)) return []
    const id = typeof entry.id === "string" ? entry.id.trim() : ""
    return id ? [id] : []
  })
  return [...new Set(ids)].sort()
}

type AnthropicModelPage = {
  ids: string[]
  hasMore: boolean
  lastId: string | null
}

function parseAnthropicModelPage(payload: unknown): AnthropicModelPage | null {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return null

  const ids = payload.data.flatMap((entry) => {
    if (!isRecord(entry)) return []
    const id = typeof entry.id === "string" ? entry.id.trim() : ""
    return id ? [id] : []
  })
  const hasMore = payload.has_more === true
  const lastId = typeof payload.last_id === "string" && payload.last_id.trim()
    ? payload.last_id.trim()
    : null
  return { ids: [...new Set(ids)], hasMore, lastId }
}

const MAX_ANTHROPIC_MODELS = 10000

/** 读取 Anthropic Models API 的全部分页，并兼容只返回一页的兼容网关。 */
async function listAnthropicModels(
  fetchImpl: FetchLike,
  base: string,
  apiKey: string,
): Promise<{ ids: string[]; status: number } | null> {
  const ids: string[] = []
  let cursor: string | null = null
  let status = 200

  for (let page = 0; page < 100 && ids.length < MAX_ANTHROPIC_MODELS; page += 1) {
    const url = new URL(`${base}/models`)
    url.searchParams.set("limit", "100")
    if (cursor) url.searchParams.set("after_id", cursor)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetchImpl(url.toString(), {
        method: "GET",
        headers: {
          ...(apiKey ? { "x-api-key": apiKey } : {}),
          "anthropic-version": "2023-06-01",
          Accept: "application/json",
        },
        signal: controller.signal,
        redirect: "error",
      })
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }

    status = response.status
    if (!response.ok) return { ids: [], status }
    const pageData = parseAnthropicModelPage(await readBoundedJson(response))
    if (!pageData) return null
    ids.push(...pageData.ids)
    if (!pageData.hasMore || !pageData.lastId || pageData.lastId === cursor) break
    cursor = pageData.lastId
  }

  return { ids: [...new Set(ids)].sort().slice(0, MAX_ANTHROPIC_MODELS), status }
}

function hintFor(vendor: ProbeVendor, status: number | null): string {
  if (status === 401 || status === 403) {
    return vendor === "azure"
      ? "接口拒绝了密钥，请检查 Azure 资源的密钥和地址是否属于同一资源。"
      : "接口拒绝了密钥，请检查此地址对应的访问密钥。"
  }
  if (status === 404) {
    return vendor === "azure"
      ? "没有找到模型列表接口。Azure 地址通常以 /openai/v1 结尾，请检查资源名称。"
      : vendor === "anthropic"
        ? "没有找到 Anthropic 模型列表接口，请确认地址通常以 /v1 结尾。"
        : "没有找到模型列表接口，请确认地址通常以 /v1 结尾。"
  }
  if (status !== null) {
    return `模型接口返回了 HTTP ${status}。`
  }
  return "暂时无法访问模型接口，请检查地址、网络和服务是否允许公司服务器访问。"
}

/**
 * Try each candidate base URL until one serves /models. Sends both
 * `Authorization: Bearer` and `api-key` headers — Azure accepts either,
 * OpenAI-compatible servers ignore the extra header.
 */
export async function probeEndpoint(input: {
  api: string
  apiKey: string
  protocol?: ProbeProtocol
  fetchImpl?: FetchLike
  allowLoopback?: boolean
}): Promise<EndpointProbeResult> {
  const fetchImpl: FetchLike = input.fetchImpl ?? ((url, init) => fetch(url, init))
  const protocol = input.protocol ?? "openai"
  const vendor = detectVendor(input.api, protocol)
  const candidates = buildCandidateBaseUrls(input.api, protocol)
  const attempted: string[] = []

  if (candidates.length === 0) {
    return {
      ok: false,
      vendor,
      normalizedApi: null,
      attempted,
      models: [],
      hint: "请输入有效的 http:// 或 https:// 基础地址。",
      status: null,
    }
  }

  let lastStatus: number | null = null

  for (const base of candidates) {
    attempted.push(base)
    try {
      assertProbeUrlAllowed(base, { allowLoopback: input.allowLoopback })
    } catch (error) {
      if (error instanceof EndpointProbeBlockedError) {
        return { ok: false, vendor, normalizedApi: null, attempted, models: [], hint: error.message, status: null }
      }
      throw error
    }

    try {
      if (protocol === "anthropic") {
        const anthropicResult = await listAnthropicModels(fetchImpl, base, input.apiKey)
        if (anthropicResult?.ids.length) {
          return {
            ok: true,
            vendor,
            normalizedApi: base,
            attempted,
            models: anthropicResult.ids.map((id) => ({ id })),
            hint: null,
            status: anthropicResult.status,
          }
        }
        if (anthropicResult) lastStatus = anthropicResult.status
        continue
      }

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
      let response: Response
      try {
        response = await fetchImpl(`${base}/models`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${input.apiKey}`,
            "api-key": input.apiKey,
          },
          signal: controller.signal,
          redirect: "error",
        })
      } finally {
        clearTimeout(timer)
      }

      lastStatus = response.status
      if (!response.ok) continue

      const payload = await readBoundedJson(response)
      const ids = parseModelIds(payload)
      if (!ids) continue

      const deployments =
        vendor === "azure" ? await listAzureDeployments(fetchImpl, base, input.apiKey) : null

      return {
        ok: true,
        vendor,
        normalizedApi: base,
        attempted,
        models: (deployments ?? ids).map((id) => ({ id })),
        hint: null,
        status: response.status,
      }
    } catch {
      // Network error or abort — try the next candidate.
      continue
    }
  }

  // Azure resources sometimes reject /openai/v1/models entirely while the
  // legacy deployments endpoint still answers — salvage the probe from it.
  if (vendor === "azure") {
    const origins = [...new Set(candidates.map((base) => new URL(base).origin))]
    for (const origin of origins) {
      const deployments = await listAzureDeployments(fetchImpl, `${origin}/openai/v1`, input.apiKey)
      if (deployments) {
        return {
          ok: true,
          vendor,
          normalizedApi: `${origin}/openai/v1`,
          attempted,
          models: deployments.map((id) => ({ id })),
          hint: null,
          status: 200,
        }
      }
    }
  }

  return {
    ok: false,
    vendor,
    normalizedApi: null,
    attempted,
    models: [],
    hint: hintFor(vendor, lastStatus),
    status: lastStatus,
  }
}

export type ModelVerification = {
  id: string
  /**
   * ok       — works with the default openai-compatible request shape
   * adjusted — works after switching to the OpenAI package request shape
   *            (max_completion_tokens; GPT-5/o-series on Azure)
   * failed   — neither shape produced a successful completion
   */
  status: "ok" | "adjusted" | "failed"
  /** The AI SDK package the provider config should use for this model. */
  npm: "@ai-sdk/openai-compatible" | "@ai-sdk/openai"
  message: string | null
}

const VERIFY_TIMEOUT_MS = 20_000
const MAX_VERIFY_MODELS = 8

function truncate(value: string, max = 300): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`
}

function readErrorMessage(payload: unknown): { message: string; param: string | null } {
  if (isRecord(payload) && isRecord(payload.error)) {
    const message = typeof payload.error.message === "string" ? payload.error.message : ""
    const param = typeof payload.error.param === "string" ? payload.error.param : null
    return { message, param }
  }
  return { message: "", param: null }
}

async function completionAttempt(
  fetchImpl: FetchLike,
  base: string,
  apiKey: string,
  modelId: string,
  tokenParam: "max_tokens" | "max_completion_tokens",
): Promise<{ ok: boolean; needsCompletionTokens: boolean; message: string | null }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS)
  try {
    const response = await fetchImpl(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: "Reply with the single word: ok" }],
        [tokenParam]: 16,
      }),
      signal: controller.signal,
      redirect: "error",
    })
    if (response.ok) {
      return { ok: true, needsCompletionTokens: false, message: null }
    }
    const payload = await readBoundedJson(response)
    const { message, param } = readErrorMessage(payload)
    const needsCompletionTokens =
      response.status === 400 &&
      (param === "max_tokens" || /max_completion_tokens/i.test(message))
    return {
      ok: false,
      needsCompletionTokens,
      message: truncate(message || `HTTP ${response.status}`),
    }
  } catch (error) {
    return {
      ok: false,
      needsCompletionTokens: false,
      message: truncate(error instanceof Error ? error.message : "模型请求失败。"),
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Send one tiny real completion per model to determine the request shape
 * the model accepts. GPT-5/o-series models on Azure reject `max_tokens`
 * (the openai-compatible default) and require `max_completion_tokens`
 * (the OpenAI package behavior) — detected here so the editor can pick
 * the right package automatically instead of surfacing a 400 in chat.
 */
export async function verifyModels(input: {
  api: string
  apiKey: string
  modelIds: string[]
  fetchImpl?: FetchLike
  allowLoopback?: boolean
}): Promise<ModelVerification[]> {
  const fetchImpl: FetchLike = input.fetchImpl ?? ((url, init) => fetch(url, init))
  const base = normalizeBase(input.api)
  const ids = [...new Set(input.modelIds.map((id) => id.trim()).filter(Boolean))].slice(
    0,
    MAX_VERIFY_MODELS,
  )
  if (!base || ids.length === 0) return []
  assertProbeUrlAllowed(base, { allowLoopback: input.allowLoopback })

  const results: ModelVerification[] = []
  for (const id of ids) {
    const first = await completionAttempt(fetchImpl, base, input.apiKey, id, "max_tokens")
    if (first.ok) {
      results.push({ id, status: "ok", npm: "@ai-sdk/openai-compatible", message: null })
      continue
    }
    if (first.needsCompletionTokens) {
      const second = await completionAttempt(
        fetchImpl,
        base,
        input.apiKey,
        id,
        "max_completion_tokens",
      )
      if (second.ok) {
        results.push({
          id,
          status: "adjusted",
          npm: "@ai-sdk/openai",
          message: "此模型要求使用 max_completion_tokens，已切换为兼容的 OpenAI 请求格式。",
        })
        continue
      }
      results.push({ id, status: "failed", npm: "@ai-sdk/openai", message: second.message })
      continue
    }
    results.push({ id, status: "failed", npm: "@ai-sdk/openai-compatible", message: first.message })
  }
  return results
}
