import { createHash, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { ApiError } from "./errors.js";
import { exists } from "./utils.js";
import { validateSkillName } from "./validators.js";
import { projectSkillsDir } from "./workspace-files.js";

const MAX_SKILL_FILES = 128;
const MAX_SKILL_FILE_BYTES = 512 * 1024;
const MAX_SKILL_TOTAL_BYTES = 4 * 1024 * 1024;

export type SkillBundleFile = {
  path: string;
  contents: string;
};

export type SkillBundleInstallInput = {
  name: string;
  sourceId: string;
  sourceHash?: string | null;
  bundleHash: string;
  files: SkillBundleFile[];
  overwrite?: boolean;
};

function normalizeRelativeFilePath(value: string) {
  const normalized = value.trim();
  const segments = normalized.split("/");
  if (
    !normalized
    || normalized.startsWith("/")
    || normalized.includes("\\")
    || normalized.includes("\0")
    || segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new ApiError(400, "unsafe_skill_file_path", "技能文件路径不安全，已停止安装");
  }
  return normalized;
}

function resolveSafeChild(baseDir: string, child: string) {
  const base = resolve(baseDir);
  const target = resolve(baseDir, child);
  if (target !== base && !target.startsWith(`${base}/`) && !target.startsWith(`${base}\\`)) {
    throw new ApiError(400, "unsafe_skill_file_path", "技能文件路径不安全，已停止安装");
  }
  return target;
}

export function computeSkillBundleHash(files: SkillBundleFile[]) {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(file.path, "utf8");
    hash.update("\0", "utf8");
    hash.update(String(Buffer.byteLength(file.contents, "utf8")), "utf8");
    hash.update("\0", "utf8");
    hash.update(file.contents, "utf8");
    hash.update("\0", "utf8");
  }
  return hash.digest("hex");
}

function validateSkillBundle(input: SkillBundleInstallInput) {
  const name = input.name.trim();
  validateSkillName(name);
  if (!input.sourceId.trim()) {
    throw new ApiError(400, "skill_source_required", "缺少在线技能来源");
  }
  if (!/^[a-f0-9]{64}$/iu.test(input.bundleHash.trim())) {
    throw new ApiError(400, "invalid_skill_bundle_hash", "技能文件校验值无效");
  }
  if (!Array.isArray(input.files) || input.files.length === 0 || input.files.length > MAX_SKILL_FILES) {
    throw new ApiError(400, "invalid_skill_file_count", "技能文件数量不符合要求");
  }

  let totalBytes = 0;
  const seen = new Set<string>();
  const files = input.files.map((file) => {
    if (!file || typeof file.contents !== "string") {
      throw new ApiError(400, "invalid_skill_file", "技能文件内容无效");
    }
    const path = normalizeRelativeFilePath(file.path);
    if (seen.has(path)) {
      throw new ApiError(400, "duplicate_skill_file_path", "技能文件路径重复，已停止安装");
    }
    seen.add(path);
    const bytes = Buffer.byteLength(file.contents, "utf8");
    if (bytes > MAX_SKILL_FILE_BYTES) {
      throw new ApiError(413, "skill_file_too_large", "技能包含过大的单个文件，已停止安装");
    }
    totalBytes += bytes;
    if (totalBytes > MAX_SKILL_TOTAL_BYTES) {
      throw new ApiError(413, "skill_bundle_too_large", "技能文件总量过大，已停止安装");
    }
    return { path, contents: file.contents };
  });

  if (!files.some((file) => file.path === "SKILL.md" && file.contents.trim())) {
    throw new ApiError(400, "skill_entrypoint_missing", "技能缺少有效的 SKILL.md");
  }
  if (computeSkillBundleHash(files) !== input.bundleHash.toLowerCase()) {
    throw new ApiError(409, "skill_bundle_hash_mismatch", "技能文件校验失败，已停止安装");
  }
  return { name, files };
}

export async function installSkillBundle(
  workspaceRoot: string,
  input: SkillBundleInstallInput,
): Promise<{
  name: string;
  path: string;
  sourceId: string;
  sourceHash: string | null;
  bundleHash: string;
  action: "added" | "updated";
  written: number;
}> {
  const validated = validateSkillBundle(input);
  const skillsDir = projectSkillsDir(workspaceRoot);
  const destination = join(skillsDir, validated.name);
  const existedBefore = await exists(destination);
  if (existedBefore && !input.overwrite) {
    throw new ApiError(409, "skill_already_installed", "当前工作区已经安装这个技能");
  }

  await mkdir(skillsDir, { recursive: true });
  const staging = join(skillsDir, `.${validated.name}-install-${randomUUID()}`);
  const backup = join(skillsDir, `.${validated.name}-backup-${randomUUID()}`);
  await mkdir(staging, { recursive: true });

  let destinationBackedUp = false;
  try {
    for (const file of validated.files) {
      const target = resolveSafeChild(staging, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.contents, "utf8");
    }

    if (existedBefore) {
      await rename(destination, backup);
      destinationBackedUp = true;
    }
    await rename(staging, destination);
    if (destinationBackedUp) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (destinationBackedUp && !(await exists(destination)) && await exists(backup)) {
      await rename(backup, destination).catch(() => undefined);
    }
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
    if (await exists(destination)) await rm(backup, { recursive: true, force: true });
  }

  return {
    name: validated.name,
    path: destination,
    sourceId: input.sourceId.trim(),
    sourceHash: input.sourceHash?.trim() || null,
    bundleHash: input.bundleHash.toLowerCase(),
    action: existedBefore ? "updated" : "added",
    written: validated.files.length,
  };
}
