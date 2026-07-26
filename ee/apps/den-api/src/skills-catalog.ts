import { Buffer } from "node:buffer"
import { createHash } from "node:crypto"
import { z } from "zod"

const DEFAULT_MODELSCOPE_API_BASE_URL = "https://modelscope.cn/api"
const MAX_CATALOG_RESPONSE_BYTES = 6 * 1024 * 1024
const MAX_SKILL_FILES = 128
const MAX_SKILL_FILE_BYTES = 512 * 1024
const MAX_SKILL_TOTAL_BYTES = 4 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 12_000
const FILE_DOWNLOAD_BATCH_SIZE = 6

const modelScopeSkillSchema = z.object({
  Path: z.string().min(1).max(255),
  Name: z.string().min(1).max(255),
  DisplayName: z.string().max(255).nullish(),
  Description: z.string().max(8_192).nullish(),
  DownloadCount: z.number().int().nonnegative().nullish(),
  License: z.string().max(255).nullish(),
  Source: z.string().max(64).nullish(),
  SourceDeveloper: z.string().max(255).nullish(),
  SourceURL: z.string().max(2_048).nullish(),
  ReadMeContent: z.string().nullish(),
}).passthrough()

const modelScopeListSchema = z.object({
  Success: z.literal(true),
  Data: z.object({
    SkillList: z.array(modelScopeSkillSchema),
    TotalCount: z.number().int().nonnegative(),
  }).passthrough(),
}).passthrough()

const modelScopeDetailSchema = z.object({
  Success: z.literal(true),
  Data: modelScopeSkillSchema,
}).passthrough()

const modelScopeRepoFileSchema = z.object({
  Path: z.string().min(1).max(512),
  Type: z.enum(["blob", "tree"]),
  Size: z.number().int().nonnegative().nullish(),
  Sha256: z.string().max(128).nullish(),
}).passthrough()

const modelScopeRepoFilesSchema = z.object({
  Success: z.literal(true),
  Data: z.object({ Files: z.array(modelScopeRepoFileSchema) }).passthrough(),
}).passthrough()

const skillAuditEntrySchema = z.object({
  provider: z.string().min(1).max(255),
  slug: z.string().min(1).max(255),
  status: z.enum(["pass", "warn", "fail"]),
  summary: z.string().max(2048),
  auditedAt: z.string().max(64),
  riskLevel: z.enum(["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  categories: z.array(z.string().max(255)).optional(),
})

export type SkillCatalogItem = {
  id: string
  slug: string
  name: string
  source: string
  installs: number
  sourceType: "github" | "well-known"
  installUrl: string | null
  url: string
}

export type SkillCatalogAudit = {
  id: string
  source: string
  slug: string
  audits: Array<z.infer<typeof skillAuditEntrySchema>>
  assessment: SkillAuditAssessment
}

export type SkillCatalogDetail = {
  id: string
  source: string
  slug: string
  installs: number
  hash: string
  files: Array<{ path: string; contents: string }>
  bundleHash: string
  license: string | null
}

export type SkillAuditAssessment = {
  verdict: "pass" | "warn" | "fail"
  installable: boolean
  message: string
}

export type SkillsCatalogConfig = {
  apiBaseUrl?: string | null
  allowInsecureHttp?: boolean
}

type RequestOptions = {
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

type CatalogRequest = {
  method?: "GET" | "PUT"
  body?: unknown
}

export class SkillsCatalogError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "SkillsCatalogError"
    this.status = status
    this.code = code
  }
}

function normalizeApiBaseUrl(config: SkillsCatalogConfig) {
  const configured = config.apiBaseUrl?.trim() || DEFAULT_MODELSCOPE_API_BASE_URL
  let url: URL
  try {
    url = new URL(configured)
  } catch {
    throw new SkillsCatalogError(503, "skill_catalog_not_configured", "魔搭技能目录地址配置无效，请联系管理员。")
  }

  if (url.protocol !== "https:" && !(config.allowInsecureHttp && url.protocol === "http:")) {
    throw new SkillsCatalogError(503, "skill_catalog_insecure_url", "魔搭技能目录必须使用 HTTPS。")
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new SkillsCatalogError(503, "skill_catalog_invalid_url", "魔搭技能目录地址不能包含凭据、查询参数或片段。")
  }
  return url.toString().replace(/\/+$/u, "")
}

function catalogPortalBaseUrl(config: SkillsCatalogConfig) {
  return new URL(normalizeApiBaseUrl(config)).origin
}

function validateCatalogId(id: string) {
  const normalized = id.trim()
  const segments = normalized.split("/")
  if (
    segments.length !== 2
    || !/^@?[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(segments[0] ?? "")
    || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(segments[1] ?? "")
  ) {
    throw new SkillsCatalogError(400, "invalid_skill_catalog_id", "在线技能标识无效。")
  }
  return {
    normalized,
    path: segments[0]!,
    name: segments[1]!,
    encoded: segments.map((segment) => encodeURIComponent(segment)).join("/"),
  }
}

function normalizeFilePath(value: string) {
  const normalized = value.trim().replace(/^\.\//u, "")
  const segments = normalized.split("/")
  if (
    !normalized
    || normalized.startsWith("/")
    || normalized.includes("\\")
    || normalized.includes("\0")
    || segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new SkillsCatalogError(422, "unsafe_skill_file_path", "在线技能包含不安全的文件路径，已拒绝安装。")
  }
  return normalized
}

function upstreamErrorMessage(status: number) {
  if (status === 401 || status === 403) return "魔搭技能目录拒绝了请求，请联系管理员检查服务配置。"
  if (status === 404) return "没有找到这个在线技能。"
  if (status === 429) return "魔搭技能目录访问较频繁，请稍后再试。"
  if (status >= 500) return "魔搭技能目录暂时不可用，请稍后再试。"
  return "魔搭技能目录请求失败，请稍后再试。"
}

async function requestCatalogJson<T>(
  config: SkillsCatalogConfig,
  path: string,
  schema: z.ZodType<T>,
  request: CatalogRequest = {},
  options: RequestOptions = {},
): Promise<T> {
  const apiBaseUrl = normalizeApiBaseUrl(config)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const headers = new Headers({ Accept: "application/json" })
    if (request.body !== undefined) headers.set("Content-Type", "application/json")
    const response = await (options.fetchImpl ?? fetch)(`${apiBaseUrl}${path}`, {
      method: request.method ?? "GET",
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      redirect: "error",
      signal: controller.signal,
    })
    const raw = await response.text()
    if (Buffer.byteLength(raw, "utf8") > MAX_CATALOG_RESPONSE_BYTES) {
      throw new SkillsCatalogError(502, "skill_catalog_response_too_large", "魔搭技能目录返回的数据过大，已停止处理。")
    }
    let payload: unknown = null
    try {
      payload = raw ? JSON.parse(raw) : null
    } catch {
      throw new SkillsCatalogError(502, "invalid_skill_catalog_response", "魔搭技能目录返回了无法识别的数据。")
    }
    if (!response.ok) {
      throw new SkillsCatalogError(response.status, "skill_catalog_request_failed", upstreamErrorMessage(response.status))
    }
    const parsed = schema.safeParse(payload)
    if (!parsed.success) {
      throw new SkillsCatalogError(502, "invalid_skill_catalog_response", "魔搭技能目录返回的数据不完整。")
    }
    return parsed.data
  } catch (error) {
    if (error instanceof SkillsCatalogError) throw error
    if (error instanceof Error && error.name === "AbortError") {
      throw new SkillsCatalogError(504, "skill_catalog_timeout", "魔搭技能目录响应超时，请稍后再试。")
    }
    throw new SkillsCatalogError(502, "skill_catalog_unreachable", "无法连接魔搭技能目录，请检查公司网络。")
  } finally {
    clearTimeout(timeout)
  }
}

async function requestCatalogFile(
  config: SkillsCatalogConfig,
  encodedId: string,
  filePath: string,
  options: RequestOptions,
) {
  const encodedPath = filePath.split("/").map((segment) => encodeURIComponent(segment)).join("/")
  const url = `${catalogPortalBaseUrl(config)}/skills/${encodedId}/resolve/master/${encodedPath}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: "GET",
      headers: { Accept: "text/plain, application/json;q=0.9, */*;q=0.1" },
      redirect: "error",
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new SkillsCatalogError(response.status, "skill_file_download_failed", upstreamErrorMessage(response.status))
    }
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.byteLength > MAX_SKILL_FILE_BYTES) {
      throw new SkillsCatalogError(422, "skill_file_too_large", "在线技能包含过大的单个文件，已拒绝安装。")
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    } catch {
      throw new SkillsCatalogError(422, "skill_binary_file_unsupported", "在线技能包含暂不支持的二进制文件，已拒绝安装。")
    }
  } catch (error) {
    if (error instanceof SkillsCatalogError) throw error
    if (error instanceof Error && error.name === "AbortError") {
      throw new SkillsCatalogError(504, "skill_catalog_timeout", "下载在线技能文件超时，请稍后再试。")
    }
    throw new SkillsCatalogError(502, "skill_catalog_unreachable", "无法下载在线技能文件，请检查公司网络。")
  } finally {
    clearTimeout(timeout)
  }
}

function modelScopeSkillToCatalogItem(skill: z.infer<typeof modelScopeSkillSchema>): SkillCatalogItem {
  const id = `${skill.Path}/${skill.Name}`
  const validated = validateCatalogId(id)
  const portal = "https://modelscope.cn"
  return {
    id: validated.normalized,
    slug: validated.name,
    name: skill.DisplayName?.trim() || validated.name,
    source: skill.SourceDeveloper?.trim() || validated.path,
    installs: skill.DownloadCount ?? 0,
    sourceType: skill.Source?.trim().toLowerCase() === "github" ? "github" : "well-known",
    installUrl: normalizeExternalUrl(skill.SourceURL),
    url: `${portal}/skills/${validated.encoded}`,
  }
}

function normalizeExternalUrl(value: string | null | undefined) {
  if (!value?.trim()) return null
  try {
    const url = new URL(value.trim())
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null
  } catch {
    return null
  }
}

export function computeSkillBundleHash(files: Array<{ path: string; contents: string }>) {
  const hash = createHash("sha256")
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(file.path, "utf8")
    hash.update("\0", "utf8")
    hash.update(String(Buffer.byteLength(file.contents, "utf8")), "utf8")
    hash.update("\0", "utf8")
    hash.update(file.contents, "utf8")
    hash.update("\0", "utf8")
  }
  return hash.digest("hex")
}

export function assessSkillAudit(audits: Array<z.infer<typeof skillAuditEntrySchema>>): SkillAuditAssessment {
  if (audits.some((audit) => audit.status === "fail" || audit.riskLevel === "HIGH" || audit.riskLevel === "CRITICAL")) {
    return { verdict: "fail", installable: false, message: "本地安全检查发现高风险内容，已禁止安装。" }
  }
  if (audits.some((audit) => audit.status === "warn" || audit.riskLevel === "MEDIUM")) {
    return { verdict: "warn", installable: true, message: "本地安全检查发现需要留意的内容，请确认后再安装。" }
  }
  return { verdict: "pass", installable: true, message: "本地静态安全检查未发现已知高风险内容。" }
}

export async function listSkillsCatalog(
  config: SkillsCatalogConfig,
  input: { query?: string; view?: "all-time" | "trending" | "hot"; page?: number; perPage?: number },
  options: RequestOptions = {},
) {
  const query = input.query?.trim() ?? ""
  if (query && query.length < 2) {
    throw new SkillsCatalogError(400, "skill_catalog_query_too_short", "请至少输入两个字再搜索在线技能。")
  }

  const page = Math.max(input.page ?? 0, 0)
  const perPage = Math.min(Math.max(input.perPage ?? 50, 1), 100)
  const result = await requestCatalogJson(config, "/v1/dolphin/skills", modelScopeListSchema, {
    method: "PUT",
    body: {
      PageSize: perPage,
      PageNumber: page + 1,
      Query: query,
      Sort: "Default",
      Criterion: [],
      WithTopCollection: false,
    },
  }, options)
  const items = result.Data.SkillList.map(modelScopeSkillToCatalogItem)
  return {
    items,
    pagination: {
      page,
      perPage,
      total: result.Data.TotalCount,
      hasMore: (page + 1) * perPage < result.Data.TotalCount,
    },
    query: query || null,
    searchType: query ? "keyword" : null,
  }
}

async function listSkillRepoFiles(
  config: SkillsCatalogConfig,
  encodedId: string,
  options: RequestOptions,
) {
  const directories = [""]
  const visited = new Set<string>()
  const files: Array<z.infer<typeof modelScopeRepoFileSchema>> = []
  while (directories.length > 0) {
    const directory = directories.shift() ?? ""
    if (visited.has(directory)) continue
    visited.add(directory)
    const params = new URLSearchParams({ Revision: "master", Root: directory })
    const result = await requestCatalogJson(
      config,
      `/v1/skills/${encodedId}/repo/files?${params.toString()}`,
      modelScopeRepoFilesSchema,
      {},
      options,
    )
    for (const entry of result.Data.Files) {
      const path = normalizeFilePath(entry.Path)
      if (entry.Type === "tree") {
        directories.push(path)
        continue
      }
      files.push({ ...entry, Path: path })
      if (files.length > MAX_SKILL_FILES) {
        throw new SkillsCatalogError(422, "skill_file_count_exceeded", "在线技能包含的文件过多，已拒绝安装。")
      }
    }
  }
  return files
}

export async function getSkillsCatalogDetail(
  config: SkillsCatalogConfig,
  id: string,
  options: RequestOptions = {},
): Promise<SkillCatalogDetail> {
  const skillId = validateCatalogId(id)
  const [metadata, repoFiles] = await Promise.all([
    requestCatalogJson(config, `/v1/skills/${skillId.encoded}`, modelScopeDetailSchema, {}, options),
    listSkillRepoFiles(config, skillId.encoded, options),
  ])
  if (repoFiles.length === 0) {
    throw new SkillsCatalogError(409, "skill_snapshot_unavailable", "这个技能尚未生成可安装文件，请稍后再试。")
  }

  const advertisedTotal = repoFiles.reduce((total, file) => total + (file.Size ?? 0), 0)
  if (advertisedTotal > MAX_SKILL_TOTAL_BYTES) {
    throw new SkillsCatalogError(422, "skill_bundle_too_large", "在线技能文件总量过大，已拒绝安装。")
  }

  const files: Array<{ path: string; contents: string }> = []
  for (let index = 0; index < repoFiles.length; index += FILE_DOWNLOAD_BATCH_SIZE) {
    const batch = repoFiles.slice(index, index + FILE_DOWNLOAD_BATCH_SIZE)
    const contents = await Promise.all(batch.map((file) => requestCatalogFile(config, skillId.encoded, file.Path, options)))
    files.push(...batch.map((file, fileIndex) => {
      const content = contents[fileIndex]!
      const bytes = Buffer.from(content, "utf8")
      if (file.Size && bytes.byteLength !== file.Size) {
        throw new SkillsCatalogError(409, "skill_file_size_mismatch", "在线技能文件大小校验失败，已停止安装。")
      }
      if (file.Sha256 && /^[a-f0-9]{64}$/iu.test(file.Sha256)) {
        const actualHash = createHash("sha256").update(content, "utf8").digest("hex")
        if (actualHash !== file.Sha256.toLowerCase()) {
          throw new SkillsCatalogError(409, "skill_file_hash_mismatch", "在线技能文件哈希校验失败，已停止安装。")
        }
      }
      return { path: file.Path, contents: content }
    }))
  }
  const totalBytes = files.reduce((total, file) => total + Buffer.byteLength(file.contents, "utf8"), 0)
  if (totalBytes > MAX_SKILL_TOTAL_BYTES) {
    throw new SkillsCatalogError(422, "skill_bundle_too_large", "在线技能文件总量过大，已拒绝安装。")
  }
  if (!files.some((file) => file.path === "SKILL.md" && file.contents.trim())) {
    throw new SkillsCatalogError(422, "skill_entrypoint_missing", "在线技能缺少有效的 SKILL.md，已拒绝安装。")
  }

  const item = modelScopeSkillToCatalogItem(metadata.Data)
  if (item.id !== skillId.normalized) {
    throw new SkillsCatalogError(409, "skill_identity_mismatch", "魔搭返回的技能身份不一致，已停止安装。")
  }
  const bundleHash = computeSkillBundleHash(files)
  return {
    id: item.id,
    source: item.source,
    slug: item.slug,
    installs: item.installs,
    hash: bundleHash,
    files,
    bundleHash,
    license: metadata.Data.License?.trim() || null,
  }
}

type StaticAuditRule = {
  slug: string
  status: "warn" | "fail"
  riskLevel: "MEDIUM" | "HIGH" | "CRITICAL"
  summary: string
  categories: string[]
  patterns: RegExp[]
}

const STATIC_AUDIT_RULES: StaticAuditRule[] = [
  {
    slug: "destructive-commands",
    status: "fail",
    riskLevel: "CRITICAL",
    summary: "发现可能删除系统文件、抹除磁盘或关闭主机的命令。",
    categories: ["破坏性操作"],
    patterns: [
      /\brm\s+-(?:[^\s]*r[^\s]*f|[^\s]*f[^\s]*r)\s+(?:\/|~|\$HOME)\b/iu,
      /\b(?:mkfs(?:\.[a-z0-9]+)?|diskutil\s+erase|shutdown|reboot)\b/iu,
      /\bdd\s+if=[^\n]+\s+of=\/dev\//iu,
    ],
  },
  {
    slug: "credential-extraction",
    status: "fail",
    riskLevel: "HIGH",
    summary: "发现读取或传送本机凭据、密钥或认证配置的指令。",
    categories: ["凭据读取", "数据外传"],
    patterns: [
      /\b(?:cat|type|read|open|copy|scp|upload|send)\b[^\n]{0,160}(?:\.ssh|\.aws\/credentials|\.kube\/config|\.env\b|keychain)/iu,
      /\bsecurity\s+find-(?:generic|internet)-password\b/iu,
      /\bcurl\b[^\n]{0,200}(?:--data(?:-binary)?|-d)\s+@(?:\/|~|\$HOME)/iu,
    ],
  },
  {
    slug: "remote-code-execution",
    status: "fail",
    riskLevel: "HIGH",
    summary: "发现下载远程内容后直接交给命令解释器执行的指令。",
    categories: ["远程执行"],
    patterns: [
      /\b(?:curl|wget)\b[^\n]{0,240}(?:\||&&)\s*(?:ba|z|fi)?sh\b/iu,
      /\b(?:curl|wget)\b[^\n]{0,240}(?:\||&&)\s*(?:python|node|ruby|perl)\b/iu,
    ],
  },
  {
    slug: "network-access",
    status: "warn",
    riskLevel: "MEDIUM",
    summary: "技能包含网络访问或文件传输指令，运行前请确认目标地址和发送内容。",
    categories: ["网络访问", "数据外传"],
    patterns: [/\b(?:curl|wget|scp|rsync|nc|netcat)\b/iu, /\b(?:fetch|requests\.(?:get|post)|axios\.)\s*\(/iu],
  },
  {
    slug: "sensitive-environment",
    status: "warn",
    riskLevel: "MEDIUM",
    summary: "技能会读取环境变量或本机配置，运行前请核对其实际用途。",
    categories: ["凭据读取"],
    patterns: [/\b(?:process\.env|os\.environ|printenv|env::var)\b/iu],
  },
  {
    slug: "elevated-permissions",
    status: "warn",
    riskLevel: "MEDIUM",
    summary: "技能包含提权或扩大文件权限的指令，运行前需要人工确认。",
    categories: ["权限提升"],
    patterns: [/\bsudo\b/iu, /\bchmod\s+(?:777|a\+rwx)\b/iu],
  },
]

export function auditSkillFiles(
  detail: Pick<SkillCatalogDetail, "files" | "license">,
  auditedAt = new Date().toISOString(),
) {
  const audits: Array<z.infer<typeof skillAuditEntrySchema>> = []
  for (const rule of STATIC_AUDIT_RULES) {
    const matchedFiles = detail.files
      .filter((file) => rule.patterns.some((pattern) => pattern.test(file.contents)))
      .map((file) => file.path)
    if (matchedFiles.length === 0) continue
    audits.push({
      provider: "Den 本地静态检查",
      slug: rule.slug,
      status: rule.status,
      summary: `${rule.summary} 涉及文件：${matchedFiles.slice(0, 5).join("、")}${matchedFiles.length > 5 ? "等" : ""}`,
      auditedAt,
      riskLevel: rule.riskLevel,
      categories: rule.categories,
    })
  }
  if (!detail.license) {
    audits.push({
      provider: "魔搭元数据检查",
      slug: "license-missing",
      status: "warn",
      summary: "魔搭目录未提供许可证信息，请在公司内部使用前确认授权范围。",
      auditedAt,
      riskLevel: "MEDIUM",
      categories: ["许可证"],
    })
  }
  if (audits.length === 0) {
    audits.push({
      provider: "Den 本地静态检查",
      slug: "static-scan",
      status: "pass",
      summary: "未发现已知的高风险命令、凭据读取、数据外传或提权模式。",
      auditedAt,
      riskLevel: "NONE",
      categories: ["静态检查"],
    })
  }
  return audits
}

export async function getSkillsCatalogAudit(
  config: SkillsCatalogConfig,
  id: string,
  options: RequestOptions = {},
): Promise<SkillCatalogAudit> {
  const detail = await getSkillsCatalogDetail(config, id, options)
  const audits = auditSkillFiles(detail)
  return {
    id: detail.id,
    source: detail.source,
    slug: detail.slug,
    audits,
    assessment: assessSkillAudit(audits),
  }
}
