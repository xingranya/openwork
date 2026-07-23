import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  preventPendingUpdaterInstall,
  registerUpdaterIpc,
  resolveUpdaterConfiguration,
  staleUpdaterStatePaths,
  targetedStableUpdaterFeed,
} from "./updater.mjs";

const fakeApp = { getPath: (key) => (key === "home" ? "/Users/test" : `/Users/test/${key}`) };
const mainFrame = {};
const mainWebContents = { id: 7, mainFrame };
const mainWindow = { webContents: mainWebContents, isDestroyed: () => false };
const mainWindowEvent = { sender: mainWebContents, senderFrame: mainFrame };

describe("updater configuration", () => {
  it("has no implicit release source", () => {
    assert.deepEqual(resolveUpdaterConfiguration({}), {
      stable: "",
      alpha: "",
      releasePage: "",
      versionTemplate: "",
    });
  });

  it("accepts explicit safe release sources", () => {
    assert.deepEqual(resolveUpdaterConfiguration({
      OPENWORK_UPDATER_STABLE_URL: "https://updates.example.com/stable/",
      OPENWORK_UPDATER_RELEASE_PAGE_URL: "https://updates.example.com/releases",
      OPENWORK_UPDATER_VERSION_URL_TEMPLATE: "https://updates.example.com/releases/v{version}",
    }), {
      stable: "https://updates.example.com/stable",
      alpha: "",
      releasePage: "https://updates.example.com/releases",
      versionTemplate: "https://updates.example.com/releases/v{version}",
    });
  });
});

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
  it("builds a fixed release feed from a strict stable version", () => {
    assert.equal(
      targetedStableUpdaterFeed(
        "0.17.22",
        "0.17.23",
        "https://updates.example.com/releases/v{version}",
      ),
      "https://updates.example.com/releases/v0.17.23",
    );
  });

  it("requires an explicit targeted release template", () => {
    assert.throws(
      () => targetedStableUpdaterFeed("0.17.22", "0.17.23"),
      /not configured/,
    );
  });

  it("rejects arbitrary URLs and prerelease targets", () => {
    assert.throws(
      () => targetedStableUpdaterFeed("0.17.22", "https://example.test/latest.yml"),
      /stable x\.y\.z format/,
    );
    assert.throws(
      () => targetedStableUpdaterFeed("0.17.22", "0.17.23-alpha.1"),
      /stable x\.y\.z format/,
    );
  });

  it("rejects equal and older targets", () => {
    assert.throws(
      () => targetedStableUpdaterFeed("0.17.23", "0.17.23"),
      /newer than the installed version/,
    );
    assert.throws(
      () => targetedStableUpdaterFeed("0.17.23", "0.17.22"),
      /newer than the installed version/,
    );
  });

  it("fails closed when the installed version cannot be compared", () => {
    assert.throws(
      () => targetedStableUpdaterFeed("unknown", "0.17.23"),
      /could not be validated/,
    );
  });
});

describe("installAndRestart", () => {
  it("refuses to invoke the installer before an update is downloaded", async () => {
    const handlers = new Map();
    registerUpdaterIpc({
      app: { isPackaged: false },
      ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
      getMainWindow: () => mainWindow,
    });

    const install = handlers.get("openwork:updater:installAndRestart");
    assert.equal(typeof install, "function");
    assert.deepEqual(await install(mainWindowEvent), {
      ok: false,
      reason: "update-not-downloaded",
    });
  });
});

describe("disabled updater", () => {
  it("does not check a release source when none is configured", async () => {
    const handlers = new Map();
    registerUpdaterIpc({
      app: {
        isPackaged: true,
        getPath: (key) => `/Users/test/${key}`,
        getVersion: () => "0.17.36",
      },
      ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
      getMainWindow: () => mainWindow,
      environment: {},
    });

    const check = handlers.get("openwork:updater:check");
    assert.equal(typeof check, "function");
    assert.deepEqual(await check(mainWindowEvent), {
      available: false,
      reason: "Update source is not configured.",
      channel: "stable",
      feedUrl: "",
      enabled: false,
      currentVersion: "0.17.36",
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
