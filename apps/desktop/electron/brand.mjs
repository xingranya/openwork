import { cp, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";

export const BRAND_APP_NAME = "Brand Project OS";
export const BRAND_DEV_APP_NAME = "Brand Project OS - Dev";
export const BRAND_APP_IDENTIFIER = "com.foxwork.brandprojectos";
export const BRAND_DEV_APP_IDENTIFIER = "com.foxwork.brandprojectos.dev";
export const BRAND_PROTOCOL_SCHEME = "brandprojectos";
export const BRAND_DEV_PROTOCOL_SCHEME = "brandprojectos-dev";
export const BRAND_CONFIG_DIRECTORY = "brand-project-os";

export const LEGACY_APP_IDENTIFIER = "com.differentai.openwork";
export const LEGACY_DEV_APP_IDENTIFIER = "com.differentai.openwork.dev";
export const LEGACY_PROTOCOL_SCHEMES = Object.freeze(["openwork", "openwork-dev"]);
export const LEGACY_CONFIG_DIRECTORY = "openwork";

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

export function resolveLegacyUserDataPath(app, isDevMode) {
  const legacyIdentifier = isDevMode ? LEGACY_DEV_APP_IDENTIFIER : LEGACY_APP_IDENTIFIER;
  return path.join(app.getPath("appData"), legacyIdentifier);
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
