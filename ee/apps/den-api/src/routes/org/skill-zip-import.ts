import { createHash } from "node:crypto"
import { Buffer } from "node:buffer"
import { unzipSync } from "fflate"
import { hasSkillFrontmatterName, parseSkillMarkdown } from "@openwork-ee/utils"

const MAX_ARCHIVE_BYTES = 12 * 1024 * 1024
const MAX_ARCHIVE_FILES = 256
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 8 * 1024 * 1024
const MAX_SKILL_FILES = 128
const MAX_SKILL_FILE_BYTES = 512 * 1024
const MAX_SKILL_TOTAL_BYTES = 4 * 1024 * 1024
const ZIP_EOCD_SIGNATURE = 0x06054b50
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50

export type SkillBundleFile = {
  path: string
  contents: string
}

export type ParsedSkillZipItem = {
  bundleHash: string
  description: string | null
  files: SkillBundleFile[]
  folder: string
  skillText: string
  slug: string
  title: string
  totalBytes: number
}

export type SkillZipFailure = {
  code: string
  folder: string
  reason: string
}

export type ParsedSkillZipArchive = {
  failures: SkillZipFailure[]
  skills: ParsedSkillZipItem[]
}

export class SkillZipArchiveError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = "SkillZipArchiveError"
  }
}

function findEndOfCentralDirectory(buffer: Buffer) {
  const minimumOffset = Math.max(0, buffer.byteLength - 65_557)
  for (let offset = buffer.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) return offset
  }
  throw new SkillZipArchiveError("invalid_zip", "压缩包结构无效，未找到 ZIP 目录。")
}

function inspectCentralDirectory(input: Uint8Array) {
  if (input.byteLength === 0) {
    throw new SkillZipArchiveError("empty_zip", "请选择包含技能目录的 ZIP 文件。")
  }
  if (input.byteLength > MAX_ARCHIVE_BYTES) {
    throw new SkillZipArchiveError("archive_too_large", "ZIP 文件不能超过 12 MB。")
  }

  const buffer = Buffer.from(input)
  const eocd = findEndOfCentralDirectory(buffer)
  const diskNumber = buffer.readUInt16LE(eocd + 4)
  const directoryDisk = buffer.readUInt16LE(eocd + 6)
  const entryCount = buffer.readUInt16LE(eocd + 10)
  const centralSize = buffer.readUInt32LE(eocd + 12)
  const centralOffset = buffer.readUInt32LE(eocd + 16)
  if (diskNumber !== 0 || directoryDisk !== 0) {
    throw new SkillZipArchiveError("multi_disk_zip", "不支持分卷 ZIP 文件。")
  }
  if (entryCount === 0 || entryCount > MAX_ARCHIVE_FILES) {
    throw new SkillZipArchiveError("invalid_file_count", `ZIP 内文件数量必须在 1 到 ${MAX_ARCHIVE_FILES} 个之间。`)
  }
  if (centralOffset === 0xffffffff || centralSize === 0xffffffff || centralOffset + centralSize > eocd) {
    throw new SkillZipArchiveError("unsupported_zip64", "暂不支持 ZIP64 或目录损坏的压缩包。")
  }

  let cursor = centralOffset
  let totalBytes = 0
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > eocd || buffer.readUInt32LE(cursor) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw new SkillZipArchiveError("invalid_zip", "ZIP 文件目录损坏。")
    }
    const flags = buffer.readUInt16LE(cursor + 8)
    const compression = buffer.readUInt16LE(cursor + 10)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const uncompressedSize = buffer.readUInt32LE(cursor + 24)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const externalAttributes = buffer.readUInt32LE(cursor + 38)
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new SkillZipArchiveError("unsupported_zip64", "暂不支持 ZIP64 压缩包。")
    }
    if ((flags & 0x1) !== 0) {
      throw new SkillZipArchiveError("encrypted_zip", "不支持加密 ZIP，请先解密后再上传。")
    }
    if (compression !== 0 && compression !== 8) {
      throw new SkillZipArchiveError("unsupported_compression", "ZIP 使用了不支持的压缩方式。")
    }
    const unixMode = externalAttributes >>> 16
    if ((unixMode & 0o170000) === 0o120000) {
      throw new SkillZipArchiveError("symlink_not_allowed", "ZIP 中不能包含符号链接。")
    }
    totalBytes += uncompressedSize
    if (totalBytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
      throw new SkillZipArchiveError("archive_expands_too_large", "ZIP 解压后的文件总量超过 8 MB。")
    }
    if (uncompressedSize > MAX_SKILL_FILE_BYTES) {
      throw new SkillZipArchiveError("skill_file_too_large", "ZIP 中存在超过 512 KB 的单个文件。")
    }
    cursor += 46 + nameLength + extraLength + commentLength
  }
  if (cursor !== centralOffset + centralSize) {
    throw new SkillZipArchiveError("invalid_zip", "ZIP 文件目录长度不一致。")
  }
}

function normalizeArchivePath(value: string) {
  const normalized = value.normalize("NFC")
  const segments = normalized.split("/")
  if (
    !normalized
    || normalized.length > 512
    || normalized.startsWith("/")
    || /^[a-z]:/iu.test(normalized)
    || normalized.includes("\\")
    || normalized.includes("\0")
    || segments.some((segment) => !segment || segment === "." || segment === ".." || segment.length > 128)
  ) {
    throw new SkillZipArchiveError("unsafe_path", "ZIP 中存在路径穿越或不安全的文件路径。")
  }
  return normalized
}

function normalizeSkillRelativePath(value: string) {
  const normalized = value.normalize("NFC")
  const segments = normalized.split("/")
  if (
    !normalized
    || normalized.length > 384
    || normalized.startsWith("/")
    || /^[a-z]:/iu.test(normalized)
    || normalized.includes("\\")
    || normalized.includes("\0")
    || segments.some((segment) => !segment || segment === "." || segment === ".." || segment.length > 128)
  ) {
    throw new SkillZipArchiveError("unsafe_path", "技能文件中存在路径穿越或不安全的文件路径。")
  }
  return normalized
}

function isIgnoredMacMetadata(path: string) {
  return path === ".DS_Store" || path.endsWith("/.DS_Store") || path.startsWith("__MACOSX/")
}

function decodeTextFile(path: string, bytes: Uint8Array) {
  if (bytes.includes(0)) {
    throw new SkillZipArchiveError("binary_file_not_supported", `技能文件 ${path} 包含不支持的二进制文件。`)
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    throw new SkillZipArchiveError("invalid_text_encoding", `技能文件 ${path} 不是有效的 UTF-8 文本。`)
  }
}

function compareSkillFilePath(left: SkillBundleFile, right: SkillBundleFile) {
  if (left.path === "SKILL.md") return right.path === "SKILL.md" ? 0 : -1
  if (right.path === "SKILL.md") return 1
  return left.path.localeCompare(right.path)
}

export function computeCompanySkillBundleHash(files: SkillBundleFile[]) {
  const hash = createHash("sha256")
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update(file.path, "utf8")
    hash.update("\0", "utf8")
    hash.update(String(Buffer.byteLength(file.contents, "utf8")), "utf8")
    hash.update("\0", "utf8")
    hash.update(file.contents, "utf8")
    hash.update("\0", "utf8")
  }
  return hash.digest("hex")
}

function validateSkillFolder(folder: string, files: SkillBundleFile[]): ParsedSkillZipItem | SkillZipFailure {
  if (files.length > MAX_SKILL_FILES) {
    return { folder, code: "skill_file_count_exceeded", reason: `文件数量超过 ${MAX_SKILL_FILES} 个。` }
  }
  const totalBytes = files.reduce((total, file) => total + Buffer.byteLength(file.contents, "utf8"), 0)
  if (totalBytes > MAX_SKILL_TOTAL_BYTES) {
    return { folder, code: "skill_bundle_too_large", reason: "单个技能的文件总量超过 4 MB。" }
  }
  const entrypoint = files.find((file) => file.path === "SKILL.md")
  if (!entrypoint) {
    return { folder, code: "skill_entrypoint_missing", reason: "缺少 SKILL.md。" }
  }
  if (!hasSkillFrontmatterName(entrypoint.contents)) {
    return { folder, code: "skill_frontmatter_invalid", reason: "SKILL.md 必须以包含 name 的 frontmatter 开头。" }
  }

  const parsed = parseSkillMarkdown(entrypoint.contents)
  const slug = parsed.name.trim()
  if (!/^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/u.test(slug)) {
    return { folder, code: "skill_name_invalid", reason: "技能 name 只能使用小写字母、数字、短横线或下划线，长度不超过 64。" }
  }
  return {
    bundleHash: computeCompanySkillBundleHash(files),
    description: parsed.description.trim() || null,
    files,
    folder,
    skillText: entrypoint.contents,
    slug,
    title: slug,
    totalBytes,
  }
}

export function validateCompanySkillBundleFiles(folder: string, inputFiles: SkillBundleFile[]) {
  if (!Array.isArray(inputFiles) || inputFiles.length === 0) {
    throw new SkillZipArchiveError("skill_files_missing", "技能至少需要一个 SKILL.md 文件。")
  }
  const seen = new Set<string>()
  const files = inputFiles.map((file) => {
    const path = normalizeSkillRelativePath(file.path)
    if (seen.has(path)) {
      throw new SkillZipArchiveError("duplicate_file_path", `技能中存在重复文件：${path}`)
    }
    seen.add(path)
    if (typeof file.contents !== "string" || file.contents.includes("\0")) {
      throw new SkillZipArchiveError("binary_file_not_supported", `技能文件 ${path} 包含不支持的二进制内容。`)
    }
    const bytes = Buffer.byteLength(file.contents, "utf8")
    if (bytes > MAX_SKILL_FILE_BYTES) {
      throw new SkillZipArchiveError("skill_file_too_large", `技能文件 ${path} 超过 512 KB。`)
    }
    return { path, contents: file.contents }
  }).sort(compareSkillFilePath)
  const result = validateSkillFolder(folder, files)
  if ("reason" in result) {
    throw new SkillZipArchiveError(result.code, result.reason)
  }
  return result
}

export function parseSkillZipArchive(input: Uint8Array): ParsedSkillZipArchive {
  inspectCentralDirectory(input)

  let extracted: Record<string, Uint8Array>
  try {
    extracted = unzipSync(input)
  } catch (error) {
    throw new SkillZipArchiveError(
      "invalid_zip",
      error instanceof Error ? `ZIP 解压失败：${error.message}` : "ZIP 解压失败。",
    )
  }

  const filesByFolder = new Map<string, SkillBundleFile[]>()
  for (const [rawPath, bytes] of Object.entries(extracted)) {
    if (rawPath.endsWith("/") || isIgnoredMacMetadata(rawPath)) continue
    const path = normalizeArchivePath(rawPath)
    const [folder, ...relativeSegments] = path.split("/")
    if (!folder || relativeSegments.length === 0 || folder.startsWith(".")) {
      throw new SkillZipArchiveError("invalid_root_layout", "ZIP 根目录只能包含一级技能文件夹，每个文件夹代表一个技能。")
    }
    const relativePath = relativeSegments.join("/")
    const files = filesByFolder.get(folder) ?? []
    if (files.some((file) => file.path === relativePath)) {
      throw new SkillZipArchiveError("duplicate_file_path", `ZIP 中存在重复文件：${path}`)
    }
    files.push({ path: relativePath, contents: decodeTextFile(path, bytes) })
    filesByFolder.set(folder, files)
  }

  const skills: ParsedSkillZipItem[] = []
  const failures: SkillZipFailure[] = []
  const seenSlugs = new Set<string>()
  for (const folder of [...filesByFolder.keys()].sort((left, right) => left.localeCompare(right))) {
    const files = [...(filesByFolder.get(folder) ?? [])].sort(compareSkillFilePath)
    const result = validateSkillFolder(folder, files)
    if ("reason" in result) {
      failures.push(result)
      continue
    }
    if (seenSlugs.has(result.slug)) {
      failures.push({ folder, code: "duplicate_skill_name", reason: `技能 name 与压缩包内其他技能重复：${result.slug}` })
      continue
    }
    seenSlugs.add(result.slug)
    skills.push(result)
  }

  if (skills.length === 0 && failures.length === 0) {
    throw new SkillZipArchiveError("empty_zip", "ZIP 中没有可识别的技能文件。")
  }
  return { failures, skills }
}
