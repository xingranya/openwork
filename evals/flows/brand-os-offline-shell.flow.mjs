import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  BRAND_APP_IDENTIFIER,
  BRAND_APP_NAME,
  BRAND_CONFIG_DIRECTORY,
  BRAND_PROTOCOL_SCHEME,
} from "../../apps/desktop/electron/brand.mjs";
import { isTrustedMainWindowIpcSender } from "../../apps/desktop/electron/ipc-security.mjs";
import { createNavigationPolicy } from "../../apps/desktop/electron/navigation-security.mjs";
import { resolveUpdaterConfiguration } from "../../apps/desktop/electron/updater.mjs";
import { resolveDefaultDenBaseUrl } from "../../apps/desktop/electron/workspace-store.mjs";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const FLOW_ID = "brand-os-offline-shell";
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DEFAULT_APP_BUNDLE = path.join(
  REPO_ROOT,
  "apps/desktop/dist-electron/mac-arm64/Brand Project OS.app",
);
const vo = await loadVoiceoverParagraphs(FLOW_ID);

function record(ctx, condition, assertion, actual = "") {
  ctx.recordEvidence({
    type: "assertion",
    status: condition ? "passed" : "failed",
    assertion,
    actual,
  });
  ctx.assert(condition, `${assertion}${actual ? `（实际：${actual}）` : ""}`);
}

function appBundlePath(ctx) {
  return ctx.env.BRAND_OS_EVAL_APP_BUNDLE?.trim() || DEFAULT_APP_BUNDLE;
}

async function ensureEnglish(ctx) {
  const current = await ctx.eval("window.localStorage.getItem('openwork.language')");
  if (current === "en") return;
  await ctx.eval(`(() => {
    window.localStorage.setItem("openwork.language", "en");
    window.location.reload();
    return true;
  })()`);
  await ctx.waitFor("Boolean(window.__openworkControl)", {
    timeoutMs: 30_000,
    label: "英文界面重载完成",
  });
}

async function openSettingsTab(ctx, tab, label) {
  await ctx.control("route.settings.general");
  await ctx.waitFor("location.hash.endsWith('/settings/general')", {
    timeoutMs: 30_000,
    label: "设置首页",
  });
  if (tab === "general") return;

  await ctx.clickText(label);
  await ctx.waitFor(`location.hash.endsWith(${JSON.stringify(`/settings/${tab}`)})`, {
    timeoutMs: 30_000,
    label: `${label} 设置页`,
  });
}

function readPlist(appBundle) {
  const plistPath = path.join(appBundle, "Contents/Info.plist");
  const result = spawnSync(
    "/usr/bin/plutil",
    ["-convert", "json", "-o", "-", plistPath],
    { encoding: "utf8", timeout: 30_000 },
  );
  if (result.status !== 0) {
    throw new Error(`读取 Info.plist 失败：${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

function runNodeTest(relativePath) {
  return spawnSync(process.execPath, ["--test", relativePath], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 120_000,
  });
}

function runManagedModelsTest() {
  return spawnSync(
    "pnpm",
    ["--dir", "apps/server", "exec", "bun", "test", "src/embedded-models-config.test.ts"],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000 },
  );
}

export default {
  id: FLOW_ID,
  title: "公司定制桌面壳默认离线，外连与系统权限均需显式放行",
  kind: "internal",
  steps: [
    {
      name: "未配置公司服务也能进入本地入口",
      run: async (ctx) => {
        await ctx.prove("首次启动不被云登录拦截", {
          voiceover: vo[0],
          action: async () => {
            await ensureEnglish(ctx);
            await ctx.control("route.session");
            await ctx.waitFor("location.hash === '#/welcome'", {
              timeoutMs: 45_000,
              label: "本地首次使用页",
            });
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              route: location.hash,
              denBaseUrl: localStorage.getItem("openwork.den.baseUrl") ?? "",
              serverUrlOverride: localStorage.getItem("openwork.server.urlOverride") ?? "",
              hasSigninGate: document.body.innerText.includes("Sign in to continue"),
              brokenImages: Array.from(document.images)
                .filter((image) => image.complete && image.naturalWidth === 0)
                .map((image) => image.currentSrc || image.src),
            }))()`);
            const serverHost = state.serverUrlOverride
              ? new URL(state.serverUrlOverride).hostname.toLowerCase()
              : "";
            const localServer = !serverHost || ["localhost", "127.0.0.1", "::1", "[::1]"].includes(serverHost);
            record(ctx, state.route === "#/welcome", "无工作区时进入本地首次使用页", state.route);
            record(ctx, state.denBaseUrl === "", "未写入云服务默认地址", state.denBaseUrl || "空");
            record(ctx, localServer, "业务服务地址为空或仅指向安装包内嵌本机服务", state.serverUrlOverride || "空");
            record(ctx, !state.hasSigninGate, "本地入口没有强制登录门");
            record(ctx, state.brokenImages.length === 0, "本地首次使用页没有加载失败的图片", JSON.stringify(state.brokenImages));
            ctx.output("启动状态", JSON.stringify(state, null, 2));
          },
          screenshot: {
            name: "local-first-entry",
            requireText: ["Welcome to Brand Project OS", "Get started", "Pick a folder"],
            rejectText: ["Sign in to continue"],
          },
        });
      },
    },
    {
      name: "遥测默认关闭",
      run: async (ctx) => {
        await ctx.prove("隐私开关与实际网络记录都保持关闭", {
          voiceover: vo[1],
          action: async () => {
            await openSettingsTab(ctx, "preferences", "Preferences");
            await ctx.waitForText("Share anonymous usage data");
          },
          assert: async () => {
            const state = await ctx.eval(`(() => {
              const toggle = document.querySelector('[role="switch"][aria-label="Share anonymous usage data"]');
              const resources = performance.getEntriesByType("resource").map((entry) => entry.name);
              return {
                ariaChecked: toggle?.getAttribute("aria-checked") ?? null,
                preference: localStorage.getItem("openwork.preferences"),
                posthogRequests: resources.filter((url) => /posthog/i.test(url)),
              };
            })()`);
            record(ctx, state.ariaChecked === "false", "匿名使用数据开关默认关闭", String(state.ariaChecked));
            record(ctx, state.posthogRequests.length === 0, "浏览器资源记录中没有 PostHog 请求", JSON.stringify(state.posthogRequests));
            ctx.output("隐私与网络状态", JSON.stringify(state, null, 2));
          },
          screenshot: {
            name: "telemetry-off",
            requireText: ["Preferences", "Privacy", "Share anonymous usage data"],
          },
        });
      },
    },
    {
      name: "公司服务地址没有内置默认值",
      run: async (ctx) => {
        await ctx.prove("Cloud 是可选配置，不会在后台探测上游服务", {
          voiceover: vo[2],
          action: async () => {
            await openSettingsTab(ctx, "general", "Settings");
            await ctx.waitForText("Cloud");
          },
          assert: async () => {
            const state = await ctx.eval(`(() => {
              const resources = performance.getEntriesByType("resource").map((entry) => entry.name);
              return {
                denBaseUrl: localStorage.getItem("openwork.den.baseUrl") ?? "",
                denApiBaseUrl: localStorage.getItem("openwork.den.apiBaseUrl") ?? "",
                upstreamRequests: resources.filter((url) =>
                  url.toLowerCase().includes("openworklabs.com") || url.toLowerCase().includes("/api/den")
                ),
              };
            })()`);
            record(ctx, resolveDefaultDenBaseUrl({}) === "", "桌面端未设置 Den 默认地址");
            record(ctx, state.denBaseUrl === "" && state.denApiBaseUrl === "", "当前配置没有公司服务地址");
            record(ctx, state.upstreamRequests.length === 0, "运行期间没有上游 Cloud 探测", JSON.stringify(state.upstreamRequests));
            ctx.output("公司服务配置", JSON.stringify(state, null, 2));
          },
          screenshot: {
            name: "cloud-opt-in",
            requireText: ["Settings", "Cloud", "AI Providers", "Updates"],
          },
        });
      },
    },
    {
      name: "模型目录必须显式配置",
      run: async (ctx) => {
        await ctx.prove("没有管理员模型目录时，OpenCode 关闭远程目录抓取", {
          voiceover: vo[3],
          action: async () => {
            await ctx.control("route.settings.providers");
            await ctx.waitFor("location.hash.endsWith('/settings/ai')", {
              timeoutMs: 30_000,
              label: "AI Providers 设置页",
            });
            await ctx.waitForText("AI Providers");
          },
          assert: async () => {
            const test = runManagedModelsTest();
            const output = `${test.stdout || ""}${test.stderr || ""}`.trim();
            record(ctx, test.status === 0, "模型目录封闭默认值测试通过", output.slice(-500));
            ctx.output("模型目录测试", output);
          },
          screenshot: {
            name: "managed-models-explicit",
            requireText: ["AI Providers", "Connect provider"],
          },
        });
      },
    },
    {
      name: "更新源和自动更新默认关闭",
      run: async (ctx) => {
        await ctx.prove("原型不会查询上游版本或静默下载更新", {
          voiceover: vo[4],
          action: async () => {
            await openSettingsTab(ctx, "updates", "Updates");
            await ctx.waitForText("Current version");
          },
          assert: async () => {
            const configuration = resolveUpdaterConfiguration({});
            const channel = await ctx.eval(
              "window.__OPENWORK_ELECTRON__?.updater?.getChannel?.()",
              { awaitPromise: true },
            );
            const switches = await ctx.eval(`(() => ({
              checkAutomatically: document.querySelector('[role="switch"][aria-label="Check automatically"]')?.getAttribute("aria-checked") ?? null,
              downloadAutomatically: document.querySelector('[role="switch"][aria-label="Download automatically"]')?.getAttribute("aria-checked") ?? null,
            }))()`);
            record(ctx, Object.values(configuration).every((value) => value === ""), "构建没有隐式更新源", JSON.stringify(configuration));
            record(ctx, channel?.enabled === false && !channel?.feedUrl, "实际应用更新通道处于禁用状态", JSON.stringify(channel));
            record(ctx, switches.checkAutomatically === "false", "后台检查默认关闭", String(switches.checkAutomatically));
            record(ctx, switches.downloadAutomatically === "false", "自动下载默认关闭", String(switches.downloadAutomatically));
            ctx.output("更新状态", JSON.stringify({ configuration, channel, switches }, null, 2));
          },
          screenshot: {
            name: "updates-disabled",
            requireText: ["Updates", "Current version", "Check automatically", "Download automatically"],
          },
        });
      },
    },
    {
      name: "单一安装包使用公司身份",
      run: async (ctx) => {
        await ctx.prove("当前构建的名称、Bundle ID、深链和数据目录一致", {
          voiceover: vo[5],
          action: async () => {
            await openSettingsTab(ctx, "shell", "Customization");
            await ctx.waitForText("Change application name");
          },
          assert: async () => {
            const appBundle = appBundlePath(ctx);
            const plist = readPlist(appBundle);
            const appName = await ctx.eval("document.querySelector('#shell-app-name')?.value ?? ''");
            const protocol = plist.CFBundleURLTypes?.[0]?.CFBundleURLSchemes?.[0] ?? "";
            record(ctx, appName === BRAND_APP_NAME, "界面名称使用当前公司工作名", appName);
            record(ctx, plist.CFBundleIdentifier === BRAND_APP_IDENTIFIER, "Bundle ID 使用公司命名空间", plist.CFBundleIdentifier);
            record(ctx, protocol === BRAND_PROTOCOL_SCHEME, "深链协议使用公司命名空间", protocol);
            record(ctx, BRAND_CONFIG_DIRECTORY === "brand-project-os", "数据目录使用独立公司命名空间", BRAND_CONFIG_DIRECTORY);
            ctx.output("应用身份", JSON.stringify({
              appBundle,
              appName,
              bundleIdentifier: plist.CFBundleIdentifier,
              protocol,
              configDirectory: BRAND_CONFIG_DIRECTORY,
            }, null, 2));
          },
          screenshot: {
            name: "company-identity",
            requireText: ["Customization", "Branding", "Change application name", "Brand Project OS"],
          },
        });
      },
    },
    {
      name: "导航、IPC 和文件访问按允许列表工作",
      run: async (ctx) => {
        await ctx.prove("未登记的外部目标和非主窗口 IPC 都会被拒绝", {
          voiceover: vo[6],
          action: async () => {
            await ctx.control("route.settings.authorized_folders");
            await ctx.waitFor("location.hash.endsWith('/settings/permissions')", {
              timeoutMs: 30_000,
              label: "Permissions 设置页",
            });
            await ctx.waitForText("Authorized folders");
          },
          assert: async () => {
            const policy = createNavigationPolicy({});
            const mainFrame = {};
            const webContents = { id: 7, mainFrame };
            const getMainWindow = () => ({ webContents, isDestroyed: () => false });
            const localAllowed = policy.allowsNetworkUrl("http://127.0.0.1:4096/health");
            const remoteBlocked = !policy.allowsNetworkUrl("https://unconfigured.example.com/api");
            const externalBlocked = !policy.allowsExternalUrl("https://unconfigured.example.com/help");
            const trustedIpc = isTrustedMainWindowIpcSender({ sender: webContents, senderFrame: mainFrame }, getMainWindow);
            const untrustedIpcBlocked = !isTrustedMainWindowIpcSender({ sender: { id: 99 }, senderFrame: {} }, getMainWindow);
            record(ctx, localAllowed, "本机运行时地址允许访问");
            record(ctx, remoteBlocked, "未登记网络地址被拒绝");
            record(ctx, externalBlocked, "未登记外部导航被拒绝");
            record(ctx, trustedIpc && untrustedIpcBlocked, "IPC 只接受主窗口主 Frame");
            ctx.output("安全策略", JSON.stringify({
              localAllowed,
              remoteBlocked,
              externalBlocked,
              trustedIpc,
              untrustedIpcBlocked,
            }, null, 2));
          },
          screenshot: {
            name: "permission-boundaries",
            requireText: ["Permissions", "Authorized folders", "Add folder"],
          },
        });
      },
    },
    {
      name: "实际应用包通过离线扫描",
      run: async (ctx) => {
        await ctx.prove("打包产物没有遥测 Key，保留的旧地址也不会成为默认连接", {
          voiceover: vo[7],
          action: async () => {
            await openSettingsTab(ctx, "general", "Settings");
            await ctx.waitForText("Settings");
          },
          assert: async () => {
            const appBundle = appBundlePath(ctx);
            const appAsar = path.join(appBundle, "Contents/Resources/app.asar");
            const [bundleStat, asar] = await Promise.all([stat(appBundle), readFile(appAsar)]);
            const asarText = asar.toString("latin1");
            const posthogKeys = asarText.match(/phc_[A-Za-z0-9_-]+/g) ?? [];
            const legacyWebAddressPresent = asarText.includes("https://app.openworklabs.com");
            const legacyApiAddressPresent = asarText.includes("https://api.openworklabs.com");
            const containsHongriData = asar.includes(Buffer.from("鸿日")) || asar.includes(Buffer.from("鸿喜达"));
            const packagingTest = runNodeTest("apps/desktop/electron/packaging-security.test.mjs");
            const testOutput = `${packagingTest.stdout || ""}${packagingTest.stderr || ""}`.trim();
            const policy = createNavigationPolicy({});

            record(ctx, bundleStat.isDirectory() && asar.length > 0, "实际 macOS 应用包和 app.asar 存在", `${asar.length} bytes`);
            record(ctx, posthogKeys.length === 0, "实际 app.asar 不含 PostHog 项目 Key", JSON.stringify(posthogKeys));
            record(ctx, resolveDefaultDenBaseUrl({}) === "", "旧地址字符串不构成 Den 默认地址");
            record(
              ctx,
              !policy.allowsNetworkUrl("https://app.openworklabs.com") && !policy.allowsNetworkUrl("https://api.openworklabs.com"),
              "未显式配置时旧上游地址被网络策略拒绝",
            );
            record(ctx, !containsHongriData, "应用包尚未包含鸿日真实资料");
            record(ctx, packagingTest.status === 0, "桌面打包安全测试通过", testOutput.slice(-500));
            ctx.output("实际应用包扫描", JSON.stringify({
              appBundle,
              appAsarBytes: asar.length,
              posthogKeys,
              legacyAddressStrings: {
                web: legacyWebAddressPresent,
                api: legacyApiAddressPresent,
                purpose: "仅用于识别并隔离旧配置；默认地址为空，网络策略不放行",
              },
              containsHongriData,
            }, null, 2));
            ctx.output("打包安全测试", testOutput);
          },
          screenshot: {
            name: "offline-package-pass",
            requireText: ["Settings", "Cloud", "Updates", "Recovery"],
          },
        });
      },
    },
  ],
};
