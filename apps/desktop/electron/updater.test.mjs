import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  preventPendingUpdaterInstall,
  registerUpdaterIpc,
  stableUpdaterManifestChannel,
  staleUpdaterStatePaths,
  targetedStableUpdaterFeed,
} from "./updater.mjs";

const fakeApp = { getPath: (key) => (key === "home" ? "/Users/test" : `/Users/test/${key}`) };

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
  it("refuses to invoke the installer before an update is downloaded", async () => {
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
      reason: "update-not-downloaded",
    });
  });
});

describe("release channel changes", () => {
  it("prevents a previously downloaded update from installing on quit", () => {
    const updater = { autoInstallOnAppQuit: true };

    preventPendingUpdaterInstall(updater);
    assert.equal(updater.autoInstallOnAppQuit, false);
  });
});
