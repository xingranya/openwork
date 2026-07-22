import { cp, mkdir, readdir, stat } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";

export const BRAND_CONFIG_DIRECTORY = "brand-project-os";
export const LEGACY_CONFIG_DIRECTORY = "openwork";
export const BRAND_DATA_DIRECTORY = ".brand-project-os";
export const LEGACY_DATA_DIRECTORY = ".openwork";

type PathOptions = {
  environment?: NodeJS.ProcessEnv;
  currentPlatform?: NodeJS.Platform;
  homeDirectory?: string;
};

function userConfigRoot(options: PathOptions = {}): string {
  const environment = options.environment ?? process.env;
  const currentPlatform = options.currentPlatform ?? platform();
  const homeDirectory = options.homeDirectory ?? homedir();
  const xdgConfigHome = environment.XDG_CONFIG_HOME?.trim();
  if (xdgConfigHome) return resolve(xdgConfigHome);
  if (currentPlatform === "win32") {
    return resolve(environment.APPDATA?.trim() || join(homeDirectory, "AppData", "Roaming"));
  }
  return join(homeDirectory, ".config");
}

export function resolveBrandConfigDirectory(options: PathOptions = {}): string {
  return join(userConfigRoot(options), BRAND_CONFIG_DIRECTORY);
}

export function resolveLegacyConfigDirectory(options: PathOptions = {}): string {
  return join(userConfigRoot(options), LEGACY_CONFIG_DIRECTORY);
}

export function resolveBrandDataDirectory(options: PathOptions = {}): string {
  return join(options.homeDirectory ?? homedir(), BRAND_DATA_DIRECTORY);
}

export function resolveLegacyDataDirectory(options: PathOptions = {}): string {
  return join(options.homeDirectory ?? homedir(), LEGACY_DATA_DIRECTORY);
}

async function pathType(targetPath: string): Promise<"directory" | "file" | null> {
  try {
    return (await stat(targetPath)).isDirectory() ? "directory" : "file";
  } catch {
    return null;
  }
}

async function copyMissingEntries(sourcePath: string, destinationPath: string): Promise<number> {
  const sourceType = await pathType(sourcePath);
  if (!sourceType) return 0;
  const destinationType = await pathType(destinationPath);
  if (!destinationType) {
    await mkdir(dirname(destinationPath), { recursive: true });
    await cp(sourcePath, destinationPath, { recursive: sourceType === "directory" });
    return 1;
  }
  if (sourceType !== "directory" || destinationType !== "directory") return 0;

  let copied = 0;
  for (const entry of await readdir(sourcePath)) {
    copied += await copyMissingEntries(join(sourcePath, entry), join(destinationPath, entry));
  }
  return copied;
}

/** 只复制新目录中不存在的数据；不会覆盖或删除旧目录。 */
export async function migrateLegacyDirectory(sourcePath: string, destinationPath: string): Promise<number> {
  if (resolve(sourcePath) === resolve(destinationPath)) return 0;
  return copyMissingEntries(sourcePath, destinationPath);
}
