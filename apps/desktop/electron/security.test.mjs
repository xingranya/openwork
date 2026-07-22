import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isTrustedMainWindowIpcSender, registerTrustedIpcHandler, resolveOwnHandler } from "./ipc-security.mjs";
import { createNavigationPolicy, installMainWindowNetworkAllowlist } from "./navigation-security.mjs";
import { shouldAllowMainWindowPermission } from "./media-permissions.mjs";

describe("IPC sender allowlist", () => {
  it("accepts only the main window main frame", async () => {
    const mainFrame = {};
    const webContents = { id: 7, mainFrame };
    const getMainWindow = () => ({ webContents, isDestroyed: () => false });
    assert.equal(isTrustedMainWindowIpcSender({ sender: webContents, senderFrame: mainFrame }, getMainWindow), true);
    assert.equal(isTrustedMainWindowIpcSender({ sender: webContents }, getMainWindow), false);
    assert.equal(isTrustedMainWindowIpcSender({ sender: { id: 8 }, senderFrame: mainFrame }, getMainWindow), false);
    assert.equal(isTrustedMainWindowIpcSender({ sender: webContents, senderFrame: {} }, getMainWindow), false);

    const handlers = new Map();
    registerTrustedIpcHandler({ handle: (channel, handler) => handlers.set(channel, handler) }, "test:channel", getMainWindow, (_event, value) => value);
    const handler = handlers.get("test:channel");
    assert.equal(await handler({ sender: webContents, senderFrame: mainFrame }, "ok"), "ok");
    assert.throws(() => handler({ sender: { id: 99 } }, "blocked"), /拒绝来自非主窗口/);
  });

  it("resolves only own command handlers", () => {
    const handlers = { allowed: () => "ok" };
    assert.equal(resolveOwnHandler(handlers, "allowed")(), "ok");
    assert.equal(resolveOwnHandler(handlers, "__proto__"), null);
    assert.equal(resolveOwnHandler(handlers, "toString"), null);
    assert.equal(resolveOwnHandler(handlers, null), null);
  });
});

describe("navigation and network allowlist", () => {
  it("defaults to local-only and admits explicit origins", () => {
    const policy = createNavigationPolicy({
      OPENWORK_DEN_BASE_URL: "https://den.internal.example/path",
      OPENWORK_EXTERNAL_URL_ALLOWLIST: "https://docs.internal.example/page",
    });
    assert.equal(policy.allowsNetworkUrl("http://127.0.0.1:48000/health"), true);
    assert.equal(policy.allowsNetworkUrl("file:///Applications/Brand%20Project%20OS/index.html"), true);
    assert.equal(policy.allowsNetworkUrl("https://den.internal.example/api"), true);
    assert.equal(policy.allowsExternalUrl("https://docs.internal.example/help"), true);
    assert.equal(policy.allowsExternalUrl("https://den.internal.example/api"), false);
    assert.equal(policy.allowsNetworkUrl("https://unconfigured.example.com"), false);
    assert.equal(policy.allowsExternalUrl("javascript:alert(1)"), false);
    assert.equal(policy.allowsExternalUrl("file:///tmp/private"), false);
  });

  it("allows only the registered main document and replaces runtime origins", () => {
    const policy = createNavigationPolicy({});
    policy.allowMainDocument("file:///Applications/Brand%20Project%20OS/index.html");
    policy.replaceRuntimeNetworkUrls(["https://api.internal.example/v1"]);
    assert.equal(policy.allowsMainWindowNavigation("file:///Applications/Brand%20Project%20OS/index.html#/today"), true);
    assert.equal(policy.allowsMainWindowNavigation("file:///Users/test/private.txt"), false);
    assert.equal(policy.allowsMainWindowNavigation("data:text/html,blocked"), false);
    assert.equal(policy.allowsNetworkUrl("https://api.internal.example/v1/state"), true);

    policy.replaceRuntimeNetworkUrls(["https://api2.internal.example/v1"]);
    assert.equal(policy.allowsNetworkUrl("https://api.internal.example/v1/state"), false);
    assert.equal(policy.allowsNetworkUrl("https://api2.internal.example/v1/state"), true);
  });

  it("filters the default renderer session", () => {
    const listeners = [];
    const policy = createNavigationPolicy({});
    installMainWindowNetworkAllowlist(
      { webRequest: { onBeforeRequest: (nextListener) => { listeners.push(nextListener); } } },
      policy,
    );
    const listener = listeners[0];
    if (!listener) throw new Error("未安装默认会话网络过滤器");
    const decisions = [];
    listener({ webContentsId: 12, url: "https://blocked.example.com" }, (decision) => decisions.push(decision));
    listener({ webContentsId: 12, url: "http://localhost:48000/health" }, (decision) => decisions.push(decision));
    listener({ webContentsId: 99, url: "https://browser-tab.example.com" }, (decision) => decisions.push(decision));
    assert.deepEqual(decisions, [{ cancel: true }, { cancel: false }, { cancel: true }]);
  });
});

describe("renderer permission allowlist", () => {
  const mainFrame = { id: 1 };
  const mainWindow = { webContents: mainFrame };

  it("allows local microphone audio only", () => {
    assert.equal(shouldAllowMainWindowPermission({
      webContents: mainFrame,
      permission: "media",
      origin: "file://",
      details: { mediaTypes: ["audio"] },
      mainWindow,
    }), true);
    assert.equal(shouldAllowMainWindowPermission({
      webContents: mainFrame,
      permission: "media",
      origin: "file://",
      details: { mediaTypes: ["audio", "video"] },
      mainWindow,
    }), false);
  });

  it("denies unrelated permissions, remote origins, and other windows", () => {
    assert.equal(shouldAllowMainWindowPermission({
      webContents: mainFrame,
      permission: "geolocation",
      origin: "file://",
      details: {},
      mainWindow,
    }), false);
    assert.equal(shouldAllowMainWindowPermission({
      webContents: mainFrame,
      permission: "media",
      origin: "https://remote.example.com",
      details: { mediaTypes: ["audio"] },
      mainWindow,
    }), false);
    assert.equal(shouldAllowMainWindowPermission({
      webContents: { id: 2 },
      permission: "media",
      origin: "file://",
      details: { mediaTypes: ["audio"] },
      mainWindow,
    }), false);
  });
});
