import { cp, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";

export const BRAND_APP_NAME = "FoxWork";
export const BRAND_DEV_APP_NAME = "FoxWork 开发版";
export const BRAND_APP_IDENTIFIER = "com.foxwork.desktop";
export const BRAND_DEV_APP_IDENTIFIER = "com.foxwork.desktop.dev";
export const BRAND_PROTOCOL_SCHEME = "foxwork";
export const BRAND_DEV_PROTOCOL_SCHEME = "foxwork-dev";
export const BRAND_CONFIG_DIRECTORY = "foxwork";

export const LEGACY_APP_IDENTIFIERS = Object.freeze([
  "com.foxwork.brandprojectos",
  "com.differentai.openwork",
]);
export const LEGACY_DEV_APP_IDENTIFIERS = Object.freeze([
  "com.foxwork.brandprojectos.dev",
  "com.differentai.openwork.dev",
]);
export const LEGACY_PROTOCOL_SCHEMES = Object.freeze([
  "brandprojectos",
  "brandprojectos-dev",
  "openwork",
  "openwork-dev",
]);
export const LEGACY_CONFIG_DIRECTORIES = Object.freeze(["brand-project-os", "openwork"]);
export const LEGACY_CONFIG_DIRECTORY = LEGACY_CONFIG_DIRECTORIES[0];

const ACCEPTED_PROTOCOL_SCHEMES = new Set([
  BRAND_PROTOCOL_SCHEME,
  BRAND_DEV_PROTOCOL_SCHEME,
  ...LEGACY_PROTOCOL_SCHEMES,
]);

export function isAcceptedDesktopDeepLink(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return false;
  try {
    const scheme = new URL(rawUrl.trim()).protocol.replace(/:$/, "").toLowerCase();
    return ACCEPTED_PROTOCOL_SCHEMES.has(scheme);
  } catch {
    return false;
  }
}

export function resolveLegacyUserDataPaths(app, isDevMode) {
  const legacyIdentifiers = isDevMode ? LEGACY_DEV_APP_IDENTIFIERS : LEGACY_APP_IDENTIFIERS;
  return legacyIdentifiers.map((identifier) => path.join(app.getPath("appData"), identifier));
}

async function pathType(targetPath) {
  try {
    const details = await stat(targetPath);
    return details.isDirectory() ? "directory" : "file";
  } catch {
    return null;
  }
}

async function copyMissingEntries(sourcePath, destinationPath) {
  const sourceType = await pathType(sourcePath);
  if (!sourceType) return 0;

  const destinationType = await pathType(destinationPath);
  if (!destinationType) {
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await cp(sourcePath, destinationPath, { recursive: sourceType === "directory" });
    return 1;
  }

  if (sourceType !== "directory" || destinationType !== "directory") return 0;

  let copied = 0;
  for (const entry of await readdir(sourcePath)) {
    copied += await copyMissingEntries(
      path.join(sourcePath, entry),
      path.join(destinationPath, entry),
    );
  }
  return copied;
}

/**
 * 将旧 OpenWork 数据复制到新目录。旧目录始终只读，新目录中已有文件优先。
 */
export async function migrateLegacyUserDataDirectory({ sourcePath, destinationPath }) {
  if (!sourcePath || !destinationPath || path.resolve(sourcePath) === path.resolve(destinationPath)) {
    return { migrated: false, copiedEntries: 0 };
  }

  const copiedEntries = await copyMissingEntries(sourcePath, destinationPath);
  return { migrated: copiedEntries > 0, copiedEntries };
}
