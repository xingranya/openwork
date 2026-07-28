import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  buildMacArchiveInstallerScript,
  preventPendingUpdaterInstall,
  registerUpdaterIpc,
  resolveMacApplicationBundlePath,
  stableUpdaterManifestChannel,
  staleUpdaterStatePaths,
  targetedStableUpdaterFeed,
} from "./updater.mjs";

const fakeApp = { getPath: (key) => (key === "home" ? "/Users/test" : `/Users/test/${key}`) };
const execFileAsync = promisify(execFile);

describe("staleUpdaterStatePaths", () => {
  it("targets the ShipIt cache on macOS", { skip: process.platform !== "darwin" }, () => {
    assert.deepEqual(staleUpdaterStatePaths(fakeApp), [
      "/Users/test/Library/Caches/com.foxwork.desktop.ShipIt",
    ]);
  });

  it("is a no-op off macOS", { skip: process.platform === "darwin" }, () => {
    assert.deepEqual(staleUpdaterStatePaths(fakeApp), []);
  });
});

describe("targetedStableUpdaterFeed", () => {
  it("builds a fixed company release feed from a strict stable version", () => {
    assert.equal(
      targetedStableUpdaterFeed("0.17.22", "0.17.23", "https://updates.example.test/foxwork"),
      "https://updates.example.test/foxwork/v0.17.23",
    );
  });

  it("把 CNB 固定稳定通道转换为指定版本入口", () => {
    assert.equal(
      targetedStableUpdaterFeed(
        "0.18.4",
        "0.18.5",
        "https://cnb.cool/xingranya/foxwork/-/releases/download/seewaywork-stable",
      ),
      "https://cnb.cool/xingranya/foxwork/-/releases/download/seewaywork-v0.18.5",
    );
  });

  it("rejects arbitrary URLs and prerelease targets", () => {
    assert.throws(
      () => targetedStableUpdaterFeed("0.17.22", "https://example.test/latest.yml", "https://updates.example.test/foxwork"),
      /x\.y\.z 格式/,
    );
    assert.throws(
      () => targetedStableUpdaterFeed("0.17.22", "0.17.23-alpha.1", "https://updates.example.test/foxwork"),
      /x\.y\.z 格式/,
    );
  });

  it("rejects equal and older targets", () => {
    assert.throws(
      () => targetedStableUpdaterFeed("0.17.23", "0.17.23", "https://updates.example.test/foxwork"),
      /高于当前安装版本/,
    );
    assert.throws(
      () => targetedStableUpdaterFeed("0.17.23", "0.17.22", "https://updates.example.test/foxwork"),
      /高于当前安装版本/,
    );
  });

  it("fails closed when the installed version cannot be compared", () => {
    assert.throws(
      () => targetedStableUpdaterFeed("unknown", "0.17.23", "https://updates.example.test/foxwork"),
      /无法校验当前安装版本/,
    );
  });

  it("拒绝在没有公司更新源时构造更新地址", () => {
    assert.throws(
      () => targetedStableUpdaterFeed("0.17.22", "0.17.23", ""),
      /公司更新源尚未配置/,
    );
  });
});

describe("macOS 更新安装脚本", () => {
  it("只接受标准应用包可执行文件路径", () => {
    assert.equal(
      resolveMacApplicationBundlePath("/Applications/SeeWayWork.app/Contents/MacOS/SeeWayWork"),
      "/Applications/SeeWayWork.app",
    );
    assert.equal(resolveMacApplicationBundlePath("/tmp/SeeWayWork"), null);
  });

  it("在主进程退出后校验压缩包并可回退地替换应用", () => {
    const script = buildMacArchiveInstallerScript();
    for (const contract of [
      "/usr/bin/ditto -x -k",
      "/bin/mv \"$target_app\" \"$backup_path\"",
      "/bin/mv \"$candidate\" \"$target_app\"",
      "/usr/bin/open \"$target_app\"",
      "更新包应用名称不匹配",
    ]) {
      assert.ok(script.includes(contract), `更新安装脚本缺少：${contract}`);
    }
  });

  it("可以在真实临时目录中替换 macOS 应用包", { skip: process.platform !== "darwin" }, async () => {
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), "seewaywork-updater-test-"));
    const targetApp = path.join(fixtureRoot, "Applications", "SeeWayWork.app");
    const archiveRoot = path.join(fixtureRoot, "archive");
    const archiveApp = path.join(archiveRoot, "SeeWayWork.app");
    const archivePath = path.join(fixtureRoot, "update.zip");
    const helperPath = path.join(fixtureRoot, "install-update.sh");
    const statusPath = path.join(fixtureRoot, "status.txt");
    try {
      await mkdir(targetApp, { recursive: true });
      await writeFile(path.join(targetApp, "version.txt"), "old", "utf8");
      await mkdir(archiveApp, { recursive: true });
      await writeFile(path.join(archiveApp, "version.txt"), "new", "utf8");
      await execFileAsync("/usr/bin/ditto", ["-c", "-k", "--keepParent", archiveApp, archivePath]);
      await writeFile(helperPath, buildMacArchiveInstallerScript(), "utf8");
      await chmod(helperPath, 0o700);

      const sleeper = spawn("/bin/sleep", ["1"], { stdio: "ignore" });
      await new Promise((resolve, reject) => {
        const helper = spawn(
          "/bin/sh",
          [helperPath, String(sleeper.pid), archivePath, targetApp, "SeeWayWork.app", statusPath],
          { stdio: "ignore" },
        );
        helper.once("error", reject);
        helper.once("exit", (code) => code === 0 ? resolve(undefined) : reject(new Error(`安装脚本退出码：${code}`)));
      });

      assert.equal(await readFile(path.join(targetApp, "version.txt"), "utf8"), "new");
      assert.equal(await readFile(statusPath, "utf8"), "installed\n");
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });
});

describe("stableUpdaterManifestChannel", () => {
  it("为 macOS 两种架构选择独立清单", () => {
    assert.equal(stableUpdaterManifestChannel("darwin", "arm64"), "latest-arm64");
    assert.equal(stableUpdaterManifestChannel("darwin", "x64"), "latest-x64");
  });

  it("Windows 使用标准稳定版清单", () => {
    assert.equal(stableUpdaterManifestChannel("win32", "x64"), "latest");
  });
});

describe("installAndRestart", () => {
  it("在非正式安装包中拒绝安装更新", async () => {
    const handlers = new Map();
    registerUpdaterIpc({
      app: { isPackaged: false },
      ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
      getMainWindow: () => null,
    });

    const install = handlers.get("openwork:updater:installAndRestart");
    assert.equal(typeof install, "function");
    assert.deepEqual(await install(), {
      ok: false,
      reason: "unavailable",
    });
  });

  it("主进程丢失下载标记后会重新准备缓存并继续安装", async () => {
    const handlers = new Map();
    let checked = 0;
    let downloaded = 0;
    let installed = null;
    const updater = {
      autoInstallOnAppQuit: true,
      setFeedURL() {},
      async checkForUpdates() {
        checked += 1;
        return { updateInfo: { version: "0.18.17" } };
      },
      async downloadUpdate() {
        downloaded += 1;
        return ["/tmp/SeeWayWork-mac-arm64-0.18.17.zip"];
      },
      quitAndInstall(...args) {
        installed = args;
      },
      on() {},
    };
    /** @type {{ archivePath?: string } | null} */
    let macInstallerInput = null;
    registerUpdaterIpc({
      app: {
        isPackaged: true,
        getVersion: () => "0.18.16",
        getPath: (key) => (key === "home" ? "/Users/test" : `/Users/test/${key}`),
      },
      ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
      getMainWindow: () => null,
      loadAutoUpdater: async () => /** @type {any} */ ({ autoUpdater: updater }),
      prepareMacInstall: async () => {},
      launchMacArchiveInstaller: async (input) => {
        macInstallerInput = input;
      },
    });

    const install = handlers.get("openwork:updater:installAndRestart");
    assert.deepEqual(await install(), { ok: true });
    assert.equal(checked, 1);
    assert.equal(downloaded, 1);
    if (process.platform === "darwin") {
      assert.equal(installed, null);
      assert.equal(macInstallerInput?.archivePath, "/tmp/SeeWayWork-mac-arm64-0.18.17.zip");
    } else {
      assert.deepEqual(installed, [false, true]);
    }
    assert.equal(updater.autoInstallOnAppQuit, false);
  });
});

describe("release channel changes", () => {
  it("prevents a previously downloaded update from installing on quit", () => {
    const updater = { autoInstallOnAppQuit: true };

    preventPendingUpdaterInstall(updater);
    assert.equal(updater.autoInstallOnAppQuit, false);
  });
});
