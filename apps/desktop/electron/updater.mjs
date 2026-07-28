import { readFile, mkdir, writeFile, rm, chmod } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveFoxWorkBrandConfig } from "./foxwork-brand.mjs";

const ELECTRON_UPDATER_CHANNEL_FILENAME = "electron-updater-channel.v1.json";

// 开发模式下，app.getVersion() 返回的是 Electron 框架版本（例如“35.7.5”），
// 而不是 SeeWayWork 版本；因此从 package.json 读取，保证界面显示正确版本。
const __updater_dirname = path.dirname(fileURLToPath(import.meta.url));
let _cachedAppVersion = null;
function resolveAppVersion(app) {
  if (_cachedAppVersion) return _cachedAppVersion;
  const electronVersion = app.getVersion();
  // 正式安装包的版本由 electron-builder 写入，app.getVersion() 可直接使用。
  if (app.isPackaged) {
    _cachedAppVersion = electronVersion;
    return electronVersion;
  }
  // 开发模式从 package.json 读取应用版本。
  try {
    const pkgPath = path.resolve(__updater_dirname, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    _cachedAppVersion = pkg.version || electronVersion;
  } catch {
    _cachedAppVersion = electronVersion;
  }
  return _cachedAppVersion;
}
const FOXWORK_BRAND_CONFIG = resolveFoxWorkBrandConfig();
const ELECTRON_UPDATER_FEEDS = Object.freeze({
  stable: FOXWORK_BRAND_CONFIG.updateBaseUrl,
  alpha: FOXWORK_BRAND_CONFIG.alphaUpdateBaseUrl,
});

function normalizeElectronUpdaterChannel(value) {
  if (value === "alpha" && process.platform === "darwin") return "alpha";
  return "stable";
}

function electronUpdaterChannelPath(app) {
  return path.join(app.getPath("userData"), ELECTRON_UPDATER_CHANNEL_FILENAME);
}

async function readElectronUpdaterChannel(app) {
  try {
    const raw = await readFile(electronUpdaterChannelPath(app), "utf8");
    const parsed = JSON.parse(raw);
    return normalizeElectronUpdaterChannel(parsed?.channel);
  } catch {
    return "stable";
  }
}

async function writeElectronUpdaterChannel(app, channel) {
  const normalized = normalizeElectronUpdaterChannel(channel);
  const outputPath = electronUpdaterChannelPath(app);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify({ channel: normalized, writtenAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
  return normalized;
}

function electronUpdaterFeedUrl(channel) {
  return ELECTRON_UPDATER_FEEDS[normalizeElectronUpdaterChannel(channel)];
}

function normalizeStableTargetVersion(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/^v/i, "");
  return /^\d+\.\d+\.\d+$/.test(normalized) ? normalized : null;
}

function parseComparableVersion(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/^v/i, "");
  if (!normalized) return null;

  const [versionCore] = normalized.split("+", 1);
  if (!versionCore) return null;

  const [releasePart, prereleasePart = ""] = versionCore.split("-", 2);
  const release = releasePart.split(".").map((segment) => Number(segment));
  if (!release.length || release.some((segment) => !Number.isInteger(segment) || segment < 0)) {
    return null;
  }

  const prerelease = prereleasePart
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);

  return { release, prerelease };
}

function comparePrereleaseIdentifiers(left, right) {
  if (!left.length && !right.length) return 0;
  if (!left.length) return 1;
  if (!right.length) return -1;

  const count = Math.max(left.length, right.length);
  for (let index = 0; index < count; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;

    const leftNumeric = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumeric = /^\d+$/.test(rightPart) ? Number(rightPart) : null;

    if (leftNumeric !== null && rightNumeric !== null) {
      if (leftNumeric !== rightNumeric) return leftNumeric < rightNumeric ? -1 : 1;
      continue;
    }

    if (leftNumeric !== null) return -1;
    if (rightNumeric !== null) return 1;

    const comparison = leftPart.localeCompare(rightPart);
    if (comparison !== 0) return comparison < 0 ? -1 : 1;
  }

  return 0;
}

function compareVersions(left, right) {
  const parsedLeft = parseComparableVersion(left);
  const parsedRight = parseComparableVersion(right);
  if (!parsedLeft || !parsedRight) return null;

  const count = Math.max(parsedLeft.release.length, parsedRight.release.length);
  for (let index = 0; index < count; index += 1) {
    const leftPart = parsedLeft.release[index] ?? 0;
    const rightPart = parsedRight.release[index] ?? 0;
    if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1;
  }

  return comparePrereleaseIdentifiers(parsedLeft.prerelease, parsedRight.prerelease);
}

function isVersionNewer(candidate, current) {
  const comparison = compareVersions(candidate, current);
  return comparison === null ? candidate !== current : comparison > 0;
}

/** 根据稳定版号生成可直接读取清单的更新目录。 */
export function targetedStableUpdaterFeed(currentVersion, targetVersion, baseUrl = ELECTRON_UPDATER_FEEDS.stable) {
  if (!baseUrl) {
    throw new Error("SeeWayWork 公司更新源尚未配置。");
  }
  const normalizedTarget = normalizeStableTargetVersion(targetVersion);
  if (!normalizedTarget) {
    throw new Error("目标更新版本必须使用 x.y.z 格式。");
  }
  const comparison = compareVersions(normalizedTarget, currentVersion);
  if (comparison === null) {
    throw new Error("无法校验当前安装版本，已停止定向更新。");
  }
  if (comparison <= 0) {
    throw new Error("目标更新版本必须高于当前安装版本。");
  }
  const normalizedBaseUrl = String(baseUrl).replace(/\/+$/, "");
  const cnbStableSuffix = "/releases/download/seewaywork-stable";
  const cnbLatestSuffix = "/releases/latest/download";
  if (normalizedBaseUrl.endsWith(cnbStableSuffix)) {
    return `${normalizedBaseUrl.slice(0, -cnbStableSuffix.length)}/releases/download/seewaywork-v${normalizedTarget}`;
  }
  // 兼容曾由内部构建注入的旧 CNB 地址，避免旧私有构建失去受控回滚能力。
  if (normalizedBaseUrl.endsWith(cnbLatestSuffix)) {
    return `${normalizedBaseUrl.slice(0, -cnbLatestSuffix.length)}/releases/download/seewaywork-v${normalizedTarget}`;
  }
  return `${normalizedBaseUrl}/v${normalizedTarget}`;
}

/** 为不同桌面平台选择不会互相覆盖的稳定版更新清单。 */
export function stableUpdaterManifestChannel(platform = process.platform, arch = process.arch) {
  if (platform !== "darwin") return "latest";
  return arch === "arm64" ? "latest-arm64" : "latest-x64";
}

function updaterChannelState(app, channel, targetVersion = null) {
  const normalized = normalizeElectronUpdaterChannel(channel);
  const currentVersion = resolveAppVersion(app);
  const feedUrl = targetVersion
    ? (ELECTRON_UPDATER_FEEDS.stable
      ? targetedStableUpdaterFeed(currentVersion, targetVersion, ELECTRON_UPDATER_FEEDS.stable)
      : null)
    : electronUpdaterFeedUrl(normalized);
  return {
    channel: normalized,
    feedUrl,
    currentVersion,
  };
}

async function applyElectronUpdaterFeed(app, updater, targetVersion = null) {
  const channel = await readElectronUpdaterChannel(app);
  if (targetVersion && channel !== "stable") {
    throw new Error("只有稳定版渠道支持指定更新版本。");
  }
  const state = updaterChannelState(app, channel, targetVersion);
  if (!state.feedUrl) {
    throw new Error("SeeWayWork 公司更新源尚未配置。");
  }
  updater.channel = state.channel === "stable" ? stableUpdaterManifestChannel() : "alpha";
  updater.allowPrerelease = state.channel === "alpha";
  // 从预览版切回稳定版在语义版本上可能是降级；仍需展示稳定版，允许员工主动回退。
  updater.allowDowngrade = state.channel === "stable" && !targetVersion;
  if (updater?.setFeedURL) {
    updater.setFeedURL({ provider: "generic", url: state.feedUrl });
  }
  return state;
}

function runDefaults(args) {
  return new Promise((resolve) => {
    execFile("/usr/bin/defaults", args, (error) => {
      // 此设置失败时回退到 Squirrel 默认的移动安装方式，不能因此阻断更新。
      if (error) console.warn("[updater] defaults write failed", error?.message ?? error);
      resolve(undefined);
    });
  });
}

// macOS 的 Squirrel `ShipIt` 替换 .app 时，会从这个 NSUserDefaults 域读取选项。
const SHIP_IT_DEFAULTS_DOMAIN = `${FOXWORK_BRAND_CONFIG.appIdentifier}.ShipIt`;

// Squirrel.Mac 默认通过临时目录移动整个应用包。重复安装时，暂存包可能丢失，
// 导致复制失败、重试中止并静默启动旧应用。启用 DirectContentsWrite 可改为原位
// 写入文件内容，避免该 ENOENT 中止；正式安装仍由下方独立归档替换器完成。
async function enableSquirrelDirectContentsWrite() {
  if (process.platform !== "darwin") return;
  await runDefaults(["write", SHIP_IT_DEFAULTS_DOMAIN, "SquirrelMacEnableDirectContentsWrite", "-bool", "YES"]);
}

// ShipIt 缓存卡住后会持续中止后续安装；该路径导出给测试使用。
export function staleUpdaterStatePaths(app) {
  if (process.platform !== "darwin") return [];
  const home = app.getPath("home");
  return [path.join(home, "Library", "Caches", SHIP_IT_DEFAULTS_DOMAIN)];
}

/** 解析已安装 macOS 应用包的根目录，拒绝非标准安装路径。 */
export function resolveMacApplicationBundlePath(executablePath = process.execPath) {
  const normalized = path.resolve(String(executablePath ?? ""));
  const marker = `${path.sep}Contents${path.sep}MacOS${path.sep}`;
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex <= 0) return null;
  const appPath = normalized.slice(0, markerIndex);
  return appPath.endsWith(".app") ? appPath : null;
}

/** 生成在主进程退出后交换 macOS 应用包的独立脚本。 */
export function buildMacArchiveInstallerScript() {
  return `#!/bin/sh
set -eu

app_pid="$1"
archive_path="$2"
target_app="$3"
expected_name="$4"
status_path="$5"
stage_dir=""
backup_path="\${target_app}.previous"

write_status() {
  printf '%s\\n' "$1" > "$status_path"
}

cleanup() {
  if [ -n "$stage_dir" ]; then
    /bin/rm -rf "$stage_dir"
  fi
}

fail() {
  write_status "failed:$1"
  cleanup
  exit 1
}

while /bin/kill -0 "$app_pid" 2>/dev/null; do
  /bin/sleep 1
done

stage_dir="$(/usr/bin/mktemp -d "\${TMPDIR:-/tmp}/seewaywork-update.XXXXXX")" || fail "无法创建临时安装目录"
/usr/bin/ditto -x -k "$archive_path" "$stage_dir" || fail "无法解压更新包"
candidate="$(/usr/bin/find "$stage_dir" -maxdepth 2 -type d -name '*.app' -print -quit)"
[ -n "$candidate" ] || fail "更新包中没有应用程序"
[ "$(/usr/bin/basename "$candidate")" = "$expected_name" ] || fail "更新包应用名称不匹配"

write_status "installing"
/bin/rm -rf "$backup_path"
if [ -e "$target_app" ]; then
  /bin/mv "$target_app" "$backup_path" || fail "无法备份当前应用程序"
fi

if ! /bin/mv "$candidate" "$target_app"; then
  if [ -e "$backup_path" ]; then
    /bin/mv "$backup_path" "$target_app" || true
  fi
  fail "无法写入新应用程序"
fi

/bin/rm -rf "$backup_path"
write_status "installed"
/usr/bin/open "$target_app" || exit 0
cleanup
`;
}

async function scheduleMacArchiveInstaller({ app, archivePath }) {
  const applicationPath = resolveMacApplicationBundlePath();
  if (!applicationPath) {
    throw new Error("当前应用不在标准 macOS 安装目录中，请下载完整安装包后重新安装。");
  }
  if (path.extname(String(archivePath ?? "")).toLowerCase() !== ".zip") {
    throw new Error("已下载的 macOS 更新包不可用，请重新下载更新。");
  }

  const helperDirectory = path.join(app.getPath("userData"), "updater-install");
  const helperPath = path.join(helperDirectory, "install-macos-update.sh");
  const statusPath = path.join(helperDirectory, "last-install-status.txt");
  await mkdir(helperDirectory, { recursive: true });
  await writeFile(helperPath, buildMacArchiveInstallerScript(), "utf8");
  await chmod(helperPath, 0o700);
  await writeFile(statusPath, "scheduled\n", "utf8");

  const child = spawn(
    "/bin/sh",
    [helperPath, String(process.pid), String(archivePath), applicationPath, path.basename(applicationPath), statusPath],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
  app.quit();
}

// 清除上次失败而未完成的更新状态，让下一次更新从干净状态开始。否则卡住的
// `ShipIt` 状态会持续中止后续安装。
async function cleanStaleUpdaterState(app) {
  for (const target of staleUpdaterStatePaths(app)) {
    try {
      await rm(target, { recursive: true, force: true });
    } catch (error) {
      console.warn("[updater] failed to clean stale state", target, error?.message ?? error);
    }
  }
}

// electron-updater 只在正式安装包中启用；开发构建不探测不存在的发布通道。
export function preventPendingUpdaterInstall(updater) {
  if (updater) updater.autoInstallOnAppQuit = false;
}

export function registerUpdaterIpc({
  app,
  ipcMain,
  getMainWindow,
  loadAutoUpdater = () => import("electron-updater"),
  prepareMacInstall = enableSquirrelDirectContentsWrite,
  launchMacArchiveInstaller = scheduleMacArchiveInstaller,
}) {
  let autoUpdaterInstance = null;
  let autoUpdaterLoaded = false;
  let checkedUpdateVersion = null;
  let checkedUpdateTargetVersion = null;
  let updateDownloaded = false;
  let downloadedUpdatePath = null;

  function rememberDownloadedUpdatePath(candidate) {
    if (typeof candidate !== "string" || !candidate.trim()) return;
    downloadedUpdatePath = candidate;
  }

  function resolvedDownloadedUpdatePath(updater) {
    return downloadedUpdatePath || updater?.downloadedUpdateHelper?.file || null;
  }

  function sendToRenderer(channel, data) {
    try {
      const win = typeof getMainWindow === "function" ? getMainWindow() : null;
      if (win?.webContents && !win.isDestroyed()) {
        win.webContents.send(channel, data);
      }
    } catch {
      // 主窗口可能已关闭，忽略通知发送失败。
    }
  }

  async function ensureAutoUpdater() {
    if (!app.isPackaged) return null;
    if (!ELECTRON_UPDATER_FEEDS.stable && !ELECTRON_UPDATER_FEEDS.alpha) return null;
    if (autoUpdaterLoaded) return autoUpdaterInstance;
    autoUpdaterLoaded = true;
    try {
      const mod = await loadAutoUpdater();
      autoUpdaterInstance = mod.autoUpdater ?? mod.default?.autoUpdater ?? null;
      if (autoUpdaterInstance) {
        autoUpdaterInstance.autoDownload = false;
        // 仅在员工明确点击“安装并重新启动”后才安装，避免退出应用时
        // 静默替换运行中的程序，也避免留下难以判断的半完成状态。
        autoUpdaterInstance.autoInstallOnAppQuit = false;
        // 差分下载会用旧安装包和 blockmap 重建 ZIP，在 macOS 上容易触发 Squirrel
        // 的复制失败。始终下载完整包，预览版同样以完整包替换。
        autoUpdaterInstance.disableDifferentialDownload = true;
        // 让 Squirrel.Mac 原位写入内容，避免移动整个应用包。
        await prepareMacInstall();
        autoUpdaterInstance.on("error", (err) => {
          updateDownloaded = false;
          console.warn("[updater] error", err);
        });
        autoUpdaterInstance.on("update-downloaded", (event) => {
          updateDownloaded = true;
          // electron-updater 会在事件中提供已经完成 SHA-512 校验的缓存文件。
          // 记录该路径，避免依赖其内部对象在主进程重启后仍然保持同一形态。
          rememberDownloadedUpdatePath(event?.downloadedFile);
        });
        // 将下载进度发送给渲染进程，界面可显示实时字节进度而不是停在 0。
        autoUpdaterInstance.on("download-progress", (info) => {
          sendToRenderer("openwork:updater:download-progress", {
            bytesPerSecond: info.bytesPerSecond ?? 0,
            percent: info.percent ?? 0,
            transferred: info.transferred ?? 0,
            total: info.total ?? 0,
            delta: info.delta ?? 0,
          });
        });
        await applyElectronUpdaterFeed(app, autoUpdaterInstance);
      }
    } catch (error) {
      console.warn("[updater] electron-updater not available", error);
      autoUpdaterInstance = null;
    }
    return autoUpdaterInstance;
  }

  async function refreshAvailableUpdate(updater) {
    const result = await updater.checkForUpdates();
    const info = result?.updateInfo ?? null;
    const currentVersion = resolveAppVersion(app);
    if (checkedUpdateTargetVersion && compareVersions(info?.version ?? "", checkedUpdateTargetVersion) !== 0) {
      throw new Error(`更新清单返回的版本与指定版本 ${checkedUpdateTargetVersion} 不一致。`);
    }
    const available = Boolean(info?.version && isVersionNewer(info.version, currentVersion));
    checkedUpdateVersion = available ? info.version : null;
    if (!available) updateDownloaded = false;
    return { available, info };
  }

  async function ensureDownloadedUpdate(updater) {
    // macOS 的归档替换需要实际 ZIP 路径。若内存标记已恢复、但路径未恢复，
    // 再调用一次下载接口会复用并校验 electron-updater 缓存，而不会重复传输。
    if (updateDownloaded && (process.platform !== "darwin" || resolvedDownloadedUpdatePath(updater))) {
      return true;
    }

    // 更新缓存会保留在磁盘，但主进程重启后内存标记会丢失。重新检查和下载会
    // 复用 electron-updater 的缓存，而不是把已下载的完整安装包误判为不可安装。
    const { available } = await refreshAvailableUpdate(updater);
    if (!available) return false;

    await cleanStaleUpdaterState(app);
    updater.autoInstallOnAppQuit = false;
    const downloadedPaths = await updater.downloadUpdate();
    if (Array.isArray(downloadedPaths)) {
      const archivePath = downloadedPaths.find((candidate) =>
        typeof candidate === "string" && path.extname(candidate).toLowerCase() === ".zip",
      );
      rememberDownloadedUpdatePath(archivePath);
    }
    updateDownloaded = true;
    return true;
  }

  ipcMain.handle("openwork:updater:getChannel", async () => {
    const channel = await readElectronUpdaterChannel(app);
    return updaterChannelState(app, channel);
  });

  ipcMain.handle("openwork:updater:setChannel", async (_event, rawChannel) => {
    const channel = await writeElectronUpdaterChannel(app, rawChannel);
    checkedUpdateVersion = null;
    checkedUpdateTargetVersion = null;
    updateDownloaded = false;
    downloadedUpdatePath = null;
    const updater = await ensureAutoUpdater();
    if (updater) {
      // 切换通道会使已下载更新失效，并阻止预览版在公司策略切回稳定版后退出时安装。
      preventPendingUpdaterInstall(updater);
      return applyElectronUpdaterFeed(app, updater);
    }
    return updaterChannelState(app, channel);
  });

  ipcMain.handle("openwork:updater:check", async (_event, rawChannel, rawTargetVersion) => {
    if (rawChannel !== undefined) {
      await writeElectronUpdaterChannel(app, rawChannel);
    }
    const updater = await ensureAutoUpdater();
    try {
      const targetVersion = rawTargetVersion === undefined
        ? null
        : normalizeStableTargetVersion(rawTargetVersion);
      if (rawTargetVersion !== undefined && !targetVersion) {
        throw new Error("目标更新版本必须使用 x.y.z 格式。");
      }
      checkedUpdateTargetVersion = targetVersion;
      const channelState = updater
        ? await applyElectronUpdaterFeed(app, updater, targetVersion)
        : updaterChannelState(app, await readElectronUpdaterChannel(app), targetVersion);
      if (!updater) return { available: false, reason: "unavailable", ...channelState };

      const { available, info } = await refreshAvailableUpdate(updater);
      const currentVersion = resolveAppVersion(app);
      checkedUpdateTargetVersion = available ? targetVersion : null;
      return {
        available,
        currentVersion,
        latestVersion: targetVersion ?? checkedUpdateVersion ?? null,
        releaseDate: info?.releaseDate ?? null,
        releaseNotes: info?.releaseNotes ?? null,
        ...channelState,
      };
    } catch (error) {
      checkedUpdateVersion = null;
      checkedUpdateTargetVersion = null;
      updateDownloaded = false;
      downloadedUpdatePath = null;
      return {
        available: false,
        reason: String(error?.message ?? error),
        ...updaterChannelState(app, await readElectronUpdaterChannel(app)),
      };
    }
  });

  ipcMain.handle("openwork:updater:download", async () => {
    const updater = await ensureAutoUpdater();
    if (!updater) return { ok: false, reason: "unavailable" };
    try {
      await applyElectronUpdaterFeed(app, updater, checkedUpdateTargetVersion);
      if (!await ensureDownloadedUpdate(updater)) {
        return { ok: false, reason: "当前没有可用更新。" };
      }
      return { ok: true };
    } catch (error) {
      updateDownloaded = false;
      return { ok: false, reason: String(error?.message ?? error) };
    }
  });

  ipcMain.handle("openwork:updater:installAndRestart", async () => {
    const updater = await ensureAutoUpdater();
    if (!updater) return { ok: false, reason: "unavailable" };
    try {
      await applyElectronUpdaterFeed(app, updater, checkedUpdateTargetVersion);
      if (!await ensureDownloadedUpdate(updater)) {
        return { ok: false, reason: "当前没有可安装更新。" };
      }
      // 交换前再次设置原位写入选项；清理旧状态时可能一并清除了 ShipIt 配置。
      await prepareMacInstall();
      updater.autoInstallOnAppQuit = false;
      if (process.platform === "darwin") {
        const archivePath = resolvedDownloadedUpdatePath(updater);
        await launchMacArchiveInstaller({ app, archivePath });
        return { ok: true };
      }
      updater.quitAndInstall(false, true);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: String(error?.message ?? error) };
    }
  });

  return { ensureAutoUpdater };
}
