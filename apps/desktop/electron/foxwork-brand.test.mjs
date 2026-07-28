import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  FOXWORK_APP_IDENTIFIER,
  FOXWORK_APP_NAME,
  FOXWORK_PROTOCOL_SCHEME,
  FOXWORK_RELEASE_PAGE_URL,
  FOXWORK_UPDATE_BASE_URL,
  isFoxWorkProtocolUrl,
  isLegacyFoxWorkProtocolUrl,
  resolveFoxWorkBrandConfig,
} from "./foxwork-brand.mjs";

const browserPanelSource = readFileSync(new URL("./browser-panel.mjs", import.meta.url), "utf8");
const connectLinkSource = readFileSync(new URL("./connect-link.mjs", import.meta.url), "utf8");
const mainProcessSource = readFileSync(new URL("./main.mjs", import.meta.url), "utf8");
const debugViewSource = readFileSync(new URL("../../app/src/react-app/domains/settings/pages/debug-view.tsx", import.meta.url), "utf8");
const runtimeSource = readFileSync(new URL("./runtime.mjs", import.meta.url), "utf8");
const uiControlServerSource = readFileSync(new URL("./ui-control-server.mjs", import.meta.url), "utf8");
const appIndexCssSource = readFileSync(new URL("../../app/src/app/index.css", import.meta.url), "utf8");
const appIndexHtmlSource = readFileSync(new URL("../../app/index.html", import.meta.url), "utf8");
const overlayHtmlSource = readFileSync(new URL("../../app/overlay.html", import.meta.url), "utf8");
const builderConfigSource = readFileSync(new URL("../electron-builder.yml", import.meta.url), "utf8");
const afterSignSource = readFileSync(new URL("../scripts/electron-after-sign.cjs", import.meta.url), "utf8");
const electronBuildSource = readFileSync(new URL("../scripts/electron-build.mjs", import.meta.url), "utf8");
const computerUseSource = readFileSync(new URL("./computer-use.mjs", import.meta.url), "utf8");
const computerUseBuildSource = readFileSync(new URL("../scripts/prepare-computer-use-helper.mjs", import.meta.url), "utf8");
const computerUsePermissionSource = readFileSync(
  new URL("../../../packages/handsfree/native/HandsFree/Sources/ComputerUse/PermissionSetupApp.swift", import.meta.url),
  "utf8",
);
const desktopPackage = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const releaseWorkflowSource = readFileSync(
  new URL("../../../.github/workflows/foxwork-release.yml", import.meta.url),
  "utf8",
);
const cnbWorkflowSource = readFileSync(new URL("../../../.cnb.yml", import.meta.url), "utf8");
const microSandboxDockerfileSource = readFileSync(
  new URL("../../../packaging/docker/Dockerfile.microsandbox", import.meta.url),
  "utf8",
);
const rendererBrandSource = readFileSync(
  new URL("../../app/src/app/lib/foxwork-brand.ts", import.meta.url),
  "utf8",
);

test("默认发行身份固定为 SeeWayWork，且不带上游服务回退", () => {
  const config = resolveFoxWorkBrandConfig({});
  assert.equal(FOXWORK_APP_NAME, "SeeWayWork");
  assert.equal(FOXWORK_APP_IDENTIFIER, "com.foxwork.desktop");
  assert.equal(FOXWORK_PROTOCOL_SCHEME, "foxwork");
  assert.equal(config.appName, "SeeWayWork");
  assert.equal(config.docsUrl, null);
  assert.equal(config.updateBaseUrl, FOXWORK_UPDATE_BASE_URL);
  assert.equal(config.releasePageUrl, FOXWORK_RELEASE_PAGE_URL);
  assert.equal(config.denBaseUrl, null);
});

test("公司配置可以显式提供 Den、文档和更新地址", () => {
  const config = resolveFoxWorkBrandConfig({
    FOXWORK_DEN_BASE_URL: "http://den.example.test/",
    FOXWORK_DOCS_URL: "https://docs.example.test/guide",
    FOXWORK_UPDATE_BASE_URL: "https://updates.example.test/foxwork/",
    FOXWORK_ALPHA_UPDATE_BASE_URL: "https://updates.example.test/foxwork-alpha/",
    FOXWORK_RELEASE_PAGE_URL: "https://downloads.example.test/foxwork",
  });
  assert.equal(config.denBaseUrl, "http://den.example.test");
  assert.equal(config.docsUrl, "https://docs.example.test/guide");
  assert.equal(config.updateBaseUrl, "https://updates.example.test/foxwork");
  assert.equal(config.alphaUpdateBaseUrl, "https://updates.example.test/foxwork-alpha");
  assert.equal(config.releasePageUrl, "https://downloads.example.test/foxwork");
});

test("新协议和旧协议的兼容范围明确", () => {
  assert.equal(isFoxWorkProtocolUrl("foxwork://connect"), true);
  assert.equal(isFoxWorkProtocolUrl("foxwork-dev://connect"), true);
  assert.equal(isFoxWorkProtocolUrl("openwork://connect"), false);
  assert.equal(isLegacyFoxWorkProtocolUrl("openwork://connect"), true);
  assert.equal(isLegacyFoxWorkProtocolUrl("foxwork://connect"), false);
});

test("桌面原生等待页和浏览器菜单只显示中文文案", () => {
  assert.match(mainProcessSource, /正在关闭 SeeWayWork 服务/);
  assert.match(mainProcessSource, /正在安全退出本地工作区和后台服务/);
  assert.doesNotMatch(mainProcessSource, /Stopping OpenWork services|Closing local workers/);

  for (const label of ["复制网址", "在浏览器中打开", "关闭标签页", "关闭全部标签页"]) {
    assert.match(browserPanelSource, new RegExp(label));
  }
  assert.doesNotMatch(browserPanelSource, /Copy URL|Open in Browser|Close (?:All )?Tabs?/);
});

test("主窗口和浮层模板固定使用 SeeWayWork 中文身份", () => {
  for (const source of [appIndexHtmlSource, overlayHtmlSource]) {
    assert.match(source, /<html lang="zh-CN">/);
    assert.doesNotMatch(source, /<title>OpenWork/);
  }
  assert.match(appIndexHtmlSource, /<title>SeeWayWork<\/title>/);
  assert.match(overlayHtmlSource, /<title>SeeWayWork 浮层<\/title>/);
});

test("macOS 系统权限提示和发行元数据使用 SeeWayWork 中文身份", () => {
  assert.equal(desktopPackage.description, "SeeWayWork 公司桌面客户端");
  assert.equal(desktopPackage.author?.name, "Fox");
  assert.match(builderConfigSource, /copyright: "版权所有 © 2026 Fox"/);
  assert.match(builderConfigSource, /NSCameraUsageDescription: SeeWayWork 仅在你主动使用摄像头相关功能时访问摄像头。/);
  assert.match(builderConfigSource, /NSBluetoothAlwaysUsageDescription: SeeWayWork 仅在你主动使用蓝牙相关功能时访问蓝牙。/);
  assert.match(builderConfigSource, /NSBluetoothPeripheralUsageDescription: SeeWayWork 仅在你主动使用蓝牙相关功能时访问蓝牙。/);
  assert.match(builderConfigSource, /productName: SeeWayWork/);
  assert.match(builderConfigSource, /artifactName: SeeWayWork-\$\{os\}-\$\{arch\}-\$\{version\}\.\$\{ext\}/);
  assert.doesNotMatch(builderConfigSource, /productName: (?:FoxWork|OpenWork)/);
  assert.doesNotMatch(builderConfigSource, /This app needs access|Copyright .*OpenWork/);
});

test("发行包只携带 SeeWayWork 中文说明和运行插件", () => {
  assert.match(builderConfigSource, /from: \.\.\/\.\.\/packages\/foxwork-docs/);
  assert.match(builderConfigSource, /to: foxwork-docs/);
  assert.doesNotMatch(builderConfigSource, /from: \.\.\/\.\.\/packages\/docs/);
  assert.match(builderConfigSource, /!\*\.test\.js/);
  for (const excludedPath of [
    "!electron/**/*.test.*",
    "!electron/**/*.spec.*",
    "!server/**/*.test.*",
    "!server/**/*.spec.*",
    "!node_modules/**/test/**",
    "!node_modules/**/tests/**",
    "!node_modules/**/*.test.*",
    "!node_modules/**/*.spec.*",
  ]) {
    assert.ok(builderConfigSource.includes(`- "${excludedPath}"`));
  }
});

test("桌面发行构建先生成渲染进程需要的共享产物", () => {
  const typesBuildIndex = electronBuildSource.indexOf('["--filter", "@openwork/types", "build"]');
  const installConfigBuildIndex = electronBuildSource.indexOf('["--filter", "@openwork/install-config", "build"]');
  const appBuildIndex = electronBuildSource.indexOf('["--filter", "@openwork/app", "build"]');

  assert.notEqual(typesBuildIndex, -1);
  assert.notEqual(installConfigBuildIndex, -1);
  assert.notEqual(appBuildIndex, -1);
  assert.ok(typesBuildIndex < appBuildIndex);
  assert.ok(installConfigBuildIndex < appBuildIndex);
});

test("内置服务使用的共享类型必须随正式安装包提供", () => {
  assert.equal(desktopPackage.dependencies?.["@openwork/types"], "workspace:*");
  assert.equal(desktopPackage.devDependencies?.["@openwork/types"], undefined);
});

test("正式发行自动同步安装包和更新清单到 CNB", () => {
  assert.equal(FOXWORK_RELEASE_PAGE_URL, "https://cnb.cool/xingranya/foxwork/-/releases");
  assert.equal(
    FOXWORK_UPDATE_BASE_URL,
    "https://cnb.cool/xingranya/foxwork/-/releases/download/seewaywork-stable",
  );
  assert.match(rendererBrandSource, /CNB_STABLE_UPDATE_BASE_URL/);
  assert.match(builderConfigSource, /provider: generic/);
  assert.match(builderConfigSource, /cnb\.cool\/xingranya\/foxwork\/-\/releases\/download\/seewaywork-stable/);
  assert.match(mainProcessSource, /latest-arm64-mac\.yml/);
  assert.match(mainProcessSource, /latest-x64-mac\.yml/);
  assert.match(debugViewSource, /稳定版使用公司稳定更新通道/);
  assert.doesNotMatch(debugViewSource, /releases\/latest\/download/);

  for (const contract of [
    "builder_args: --mac dmg zip --arm64",
    "builder_args: --mac dmg zip --x64",
    "latest-arm64-mac.yml",
    "latest-x64-mac.yml",
    "latest.yml",
    "apps/desktop/dist-electron/*.blockmap",
    "FOXWORK_UPDATE_BASE_URL: https://cnb.cool/xingranya/foxwork/-/releases/download/seewaywork-stable",
    "VITE_FOXWORK_UPDATE_BASE_URL: https://cnb.cool/xingranya/foxwork/-/releases/download/seewaywork-stable",
    "PLUGIN_ATTACHMENTS: ./release/*",
    "seewaywork-stable",
    "\"hasRelease\":true",
    "验证 CNB 稳定更新清单",
    "DMG 临时磁盘未能正常卸载，清理后重试",
    "hdiutil detach",
    "验证桌面更新安装契约",
    "验证 Windows 完整安装与卸载",
    "Get-SeewayWorkUninstallEntry",
    "InstallLocation",
    "UninstallString",
  ]) {
    assert.ok(releaseWorkflowSource.includes(contract), `缺少发行契约：${contract}`);
  }
  assert.match(
    releaseWorkflowSource,
    /HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\\*/,
  );
  assert.doesNotMatch(
    releaseWorkflowSource,
    /Join-Path \$env:LOCALAPPDATA "Programs\/SeeWayWork"/,
  );
  assert.doesNotMatch(
    releaseWorkflowSource,
    /cache: pnpm/,
    "发布构建不能在产物上传后因依赖缓存收尾阻塞发布",
  );
  assert.match(releaseWorkflowSource, /prerelease: false/);
  assert.match(releaseWorkflowSource, /release_commit=\$\(git rev-parse "\$\{GITHUB_SHA\}\^\{commit\}"\)/);
  assert.doesNotMatch(releaseWorkflowSource, /git rev-parse "refs\/tags\/\$RELEASE_TAG\^\{commit\}"/);
  assert.match(cnbWorkflowSource, /preRelease: false/);
});

test("CNB 仅从 SeeWayWork 正式标签发布三套多架构运行镜像且不导出 Registry 缓存", () => {
  assert.match(cnbWorkflowSource, /\^seewaywork-\(v\[0-9\]/);
  assert.match(cnbWorkflowSource, /seewaywork-stable/);
  assert.match(cnbWorkflowSource, /稳定更新通道只承载桌面更新清单和安装包，不重复构建服务镜像。/);
  assert.match(cnbWorkflowSource, /VERSION="\$\{CNB_BRANCH#seewaywork-v\}"/);
  assert.match(cnbWorkflowSource, /构建并推送 Den API、Den Web 和远程 Worker/);
  assert.match(cnbWorkflowSource, /packaging\/docker\/Dockerfile\.microsandbox/);
  assert.match(cnbWorkflowSource, /den-worker-\$VERSION/);
  assert.doesNotMatch(cnbWorkflowSource, /--cache-(?:from|to)/);
});

test("远程 Worker 在原生构建机交叉产出目标架构二进制", () => {
  assert.match(microSandboxDockerfileSource, /FROM --platform=\$BUILDPLATFORM node:22-bookworm-slim/);
  assert.match(microSandboxDockerfileSource, /ARG TARGETARCH/);
  assert.match(microSandboxDockerfileSource, /amd64\) target="bun-linux-x64"/);
  assert.match(microSandboxDockerfileSource, /arm64\) target="bun-linux-arm64"/);
  assert.match(microSandboxDockerfileSource, /ARG RUNTIME_ASSERTS=1/);
  assert.match(cnbWorkflowSource, /--build-arg RUNTIME_ASSERTS=0/);
});

test("桌面运行时不从上游地址安装引擎且关键错误保持中文", () => {
  assert.doesNotMatch(runtimeSource, /https:\/\/opencode\.ai\/install/);
  assert.match(runtimeSource, /AI 运行引擎随 SeeWayWork 安装包提供/);
  assert.match(runtimeSource, /SeeWayWork 本机服务启动后未返回访问地址/);
  assert.doesNotMatch(runtimeSource, /OpenWork server did not|Failed to locate opencode/);

  for (const label of [
    "无法连接公司服务器",
    "此连接链接已过期",
    "公司服务器返回的数据无效",
  ]) {
    assert.match(connectLinkSource, new RegExp(label));
  }
  assert.doesNotMatch(connectLinkSource, /The organization server|Connection link expired/);
  assert.match(uiControlServerSource, /SeeWayWork 控制界面尚未就绪/);
  assert.doesNotMatch(uiControlServerSource, /OpenWork control surface|Unauthorized|Not found/);
});

test("macOS 目录测试包在资源改写后重新签名并严格校验", () => {
  assert.match(afterSignSource, /function signMacAppForLocalLaunch\(appPath\)/);
  assert.match(afterSignSource, /\["--force", "--deep", "--sign", "-", appPath\]/);
  assert.match(afterSignSource, /\["--verify", "--deep", "--strict", "--verbose=2", appPath\]/);
  assert.match(afterSignSource, /if \(process\.env\.MACOS_NOTARIZE !== "true"\) \{\s*signMacAppForLocalLaunch\(appPath\);/);
});

test("电脑控制辅助应用使用 SeeWayWork 中文身份并保留工具链兼容回退", () => {
  for (const source of [computerUseSource, computerUseBuildSource, computerUsePermissionSource, builderConfigSource]) {
    assert.doesNotMatch(source, /OpenWork Computer Use/);
  }
  assert.match(computerUseBuildSource, /SeeWayWork Computer Use\.app/);
  assert.match(computerUseBuildSource, /com\.foxwork\.desktop\.computer-use/);
  assert.match(computerUseBuildSource, /OPENWORK_COMPUTER_USE_PREBUILT_BINARY/);
  assert.match(computerUseBuildSource, /指定的电脑控制辅助程序不存在/);
  assert.match(computerUseBuildSource, /Invalid manifest\|PackageDescription/);
  assert.match(computerUseBuildSource, /run\("swiftc", \[\s*"-O",\s*"-whole-module-optimization"/);
  assert.match(computerUseBuildSource, /CLANG_MODULE_CACHE_PATH: swiftModuleCachePath/);
  assert.match(computerUseBuildSource, /SWIFT_MODULECACHE_PATH: swiftModuleCachePath/);
  assert.match(computerUseBuildSource, /arm64-apple-macosx14\.0/);
  assert.match(computerUseBuildSource, /x86_64-apple-macosx14\.0/);
  assert.match(computerUseBuildSource, /"-target",\s*swiftTargetTriple\(\)/);
  assert.match(computerUseBuildSource, /"-module-cache-path",\s*swiftModuleCachePath/);
  for (const label of [
    "电脑控制权限",
    "辅助功能",
    "授权辅助功能",
    "屏幕录制",
    "申请屏幕录制权限",
    "打开“隐私与安全性”",
    "完成，返回 SeeWayWork",
    "已授权",
    "待授权",
  ]) {
    assert.match(computerUsePermissionSource, new RegExp(label));
  }
  assert.doesNotMatch(
    computerUsePermissionSource,
    /"(?:Computer Use Setup|Grant Accessibility|Screen Recording(?:\\n| )list|Open Privacy & Security|Granted|Needed)"/,
  );
});

test("macOS 主窗口始终启用原生阴影", () => {
  assert.match(
    mainProcessSource,
    /if \(process\.platform === "darwin"\) \{[\s\S]*?Object\.assign\(windowAppearanceOptions, \{[\s\S]*?hasShadow: true,/,
  );
  assert.match(
    mainProcessSource,
    /mainWindow = new BrowserWindow\([\s\S]*?if \(process\.platform === "darwin"\) \{\s*mainWindow\.setHasShadow\(true\);\s*\}/,
  );
  assert.match(mainProcessSource, /roundedCorners: true,/);
  assert.match(mainProcessSource, /setVibrancy\(macosVibrancyForCurrentTheme\(\)\);[\s\S]*?setHasShadow\(true\);/);
});

test("macOS 内容边界提供可见的窗口层次", () => {
  assert.match(
    appIndexCssSource,
    /html\.openwork-electron\.openwork-platform-mac #root\s*\{[\s\S]*?border-radius: 14px;[\s\S]*?box-shadow:/,
  );
  assert.match(appIndexCssSource, /0 12px 28px rgba\(15, 23, 42, 0\.14\)/);
  assert.match(appIndexCssSource, /html\.openwork-electron\.openwork-platform-mac\[data-theme="dark"\] #root/);
});
