import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, "..");
const repoRoot = resolve(desktopRoot, "../..");
const packagePath = resolve(repoRoot, "packages", "handsfree", "native", "HandsFree");
const iconPath = resolve(desktopRoot, "resources", "icons", "icon.icns");
const productName = "HandsFreeComputerUse";
const helperExecutableName = "ComputerUse";
const helperAppName = "FoxWork Computer Use.app";
const bundleIdentifier = "com.foxwork.desktop.computer-use";
const swiftModuleCachePath = join(packagePath, ".build", "foxwork-module-cache");

function swiftBuildEnvironment() {
  mkdirSync(swiftModuleCachePath, { recursive: true });
  return {
    ...process.env,
    CLANG_MODULE_CACHE_PATH: swiftModuleCachePath,
    SWIFT_MODULECACHE_PATH: swiftModuleCachePath,
  };
}

function swiftTargetTriple() {
  if (process.arch === "arm64") return "arm64-apple-macosx14.0";
  if (process.arch === "x64") return "x86_64-apple-macosx14.0";
  throw new Error(`不支持为 ${process.arch} 构建 FoxWork 电脑控制组件。`);
}

const readArg = (name) => {
  const raw = process.argv.slice(2);
  const direct = raw.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = raw.indexOf(name);
  if (index >= 0 && raw[index + 1]) return raw[index + 1];
  return null;
};

const hasFlag = (name) => process.argv.slice(2).includes(name);
const outDir = resolve(readArg("--outdir") ?? join(desktopRoot, "resources", "helpers"));
const force = hasFlag("--force") || process.env.OPENWORK_COMPUTER_USE_FORCE_BUILD === "1";
const appPath = join(outDir, helperAppName);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(`${command} ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`);
  }
  return result;
}

function buildComputerUseExecutable() {
  const prebuiltBinary = process.env.OPENWORK_COMPUTER_USE_PREBUILT_BINARY?.trim();
  if (prebuiltBinary) {
    const resolvedBinary = resolve(prebuiltBinary);
    if (!existsSync(resolvedBinary)) {
      throw new Error(`指定的电脑控制辅助程序不存在：${resolvedBinary}`);
    }
    return resolvedBinary;
  }

  const packageArgs = ["build", "--package-path", packagePath, "-c", "release", "--product", productName];
  const buildEnvironment = swiftBuildEnvironment();
  const packageBuild = spawnSync("swift", packageArgs, {
    encoding: "utf8",
    stdio: "pipe",
    env: buildEnvironment,
  });
  if (packageBuild.status === 0) {
    if (packageBuild.stdout) process.stdout.write(packageBuild.stdout);
    if (packageBuild.stderr) process.stderr.write(packageBuild.stderr);
    const binPathResult = run("swift", [
      "build",
      "--package-path",
      packagePath,
      "-c",
      "release",
      "--show-bin-path",
    ], { env: buildEnvironment });
    return join(binPathResult.stdout.trim(), productName);
  }

  const diagnostic = [packageBuild.stdout, packageBuild.stderr].filter(Boolean).join("\n");
  if (!/Invalid manifest|PackageDescription/.test(diagnostic)) {
    throw new Error(`swift ${packageArgs.join(" ")} failed${diagnostic.trim() ? `: ${diagnostic.trim()}` : ""}`);
  }

  process.stderr.write("[FoxWork 构建] SwiftPM 清单接口不可用，改用 swiftc 编译同一套电脑控制源码。\n");
  const sourceDir = join(packagePath, "Sources", "ComputerUse");
  const sourceFiles = readdirSync(sourceDir)
    .filter((name) => name.endsWith(".swift"))
    .sort()
    .map((name) => join(sourceDir, name));
  const directBuildDir = join(packagePath, ".build", "foxwork-direct");
  const directBinary = join(directBuildDir, productName);
  mkdirSync(directBuildDir, { recursive: true });
  run("swiftc", [
    "-O",
    "-whole-module-optimization",
    "-target",
    swiftTargetTriple(),
    "-module-cache-path",
    swiftModuleCachePath,
    ...sourceFiles,
    "-o",
    directBinary,
  ], { stdio: "inherit", env: buildEnvironment });
  return directBinary;
}

function signingIdentity() {
  const fromEnv = process.env.OPENWORK_COMPUTER_USE_SIGN_IDENTITY;
  if (fromEnv) return fromEnv;
  const result = spawnSync("security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" });
  if (result.status !== 0) return "-";
  const match = result.stdout.match(/"(Developer ID Application: [^"]+)"/);
  // 优先使用稳定的 Developer ID，使辅助功能和屏幕录制授权在重新构建后仍然有效。
  // 临时签名以内容哈希作为身份，每次重新构建都会导致原有授权失效。
  return match ? match[1] : "-";
}

function signHelperApp() {
  if (process.platform !== "darwin") return;
  const identity = signingIdentity();
  const args = ["--force", "--deep", "--sign", identity];
  if (identity !== "-") args.push("--options", "runtime");
  const result = spawnSync("codesign", [...args, appPath], {
    encoding: "utf8",
    stdio: "pipe",
  });
  if (identity !== "-" && (result.status !== 0 || result.error)) {
    // 钥匙串可能拒绝非交互式正式签名，此时回退为临时签名供本地测试使用。
    const fallback = spawnSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
      encoding: "utf8",
      stdio: "pipe",
    });
    if (fallback.status === 0) return;
  }
  if (result.error) {
    if (result.error.code === "ENOENT") {
      throw new Error("构建 FoxWork 电脑控制组件需要 codesign。");
    }
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`无法签名 ${appPath}：${result.stderr?.trim() ?? "未知错误"}`);
  }
}

function infoPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>zh-Hans</string>
  <key>CFBundleDisplayName</key>
  <string>FoxWork 电脑控制</string>
  <key>CFBundleExecutable</key>
  <string>${helperExecutableName}</string>
  <key>CFBundleIdentifier</key>
  <string>${bundleIdentifier}</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>FoxWork 电脑控制</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>14.0</string>
</dict>
</plist>
`;
}

if (process.platform !== "darwin") {
  process.stdout.write(JSON.stringify({ ok: true, skipped: true, reason: "computer-use-helper-is-macos-only" }, null, 2) + "\n");
  process.exit(0);
}

if (!force && existsSync(join(appPath, "Contents", "MacOS", helperExecutableName))) {
  process.stdout.write(JSON.stringify({ ok: true, skipped: true, appPath }, null, 2) + "\n");
  process.exit(0);
}

const builtExecutable = buildComputerUseExecutable();
if (!existsSync(builtExecutable)) {
  throw new Error(`Swift build succeeded, but ${builtExecutable} was not found`);
}

rmSync(appPath, { recursive: true, force: true });
mkdirSync(join(appPath, "Contents", "MacOS"), { recursive: true });
mkdirSync(join(appPath, "Contents", "Resources"), { recursive: true });
writeFileSync(join(appPath, "Contents", "Info.plist"), infoPlist(), "utf8");
writeFileSync(join(appPath, "Contents", "PkgInfo"), "APPL????", "utf8");
copyFileSync(builtExecutable, join(appPath, "Contents", "MacOS", helperExecutableName));
if (existsSync(iconPath)) {
  copyFileSync(iconPath, join(appPath, "Contents", "Resources", "AppIcon.icns"));
}
chmodSync(join(appPath, "Contents", "MacOS", helperExecutableName), 0o755);
signHelperApp();

process.stdout.write(JSON.stringify({ ok: true, appPath, executable: join(appPath, "Contents", "MacOS", helperExecutableName) }, null, 2) + "\n");
