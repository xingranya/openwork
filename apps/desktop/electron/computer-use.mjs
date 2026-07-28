// Computer-use helper integration: locating the bundled ComputerUse.app,
// permission checks (spawn --check for a fresh TCC read), running-app
// listing for @App mentions, and opening the permission-setup GUI.
// Extracted from main.mjs; consumed only by the desktop IPC registry.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, shell } from "electron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const COMPUTER_USE_HELPER_APP_NAME = "SeeWayWork Computer Use.app";
const COMPUTER_USE_HELPER_EXECUTABLE = "ComputerUse";

function computerUseHelperExecutablePath() {
  const appPath = computerUseHelperAppPath();
  const explicitBinary = process.env.OPENWORK_COMPUTER_USE_BINARY?.trim();
  const candidates = [
    explicitBinary,
    appPath ? path.join(appPath, "Contents", "MacOS", COMPUTER_USE_HELPER_EXECUTABLE) : null,
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function computerUseHelperAppPath() {
  const explicitApp = process.env.OPENWORK_COMPUTER_USE_APP?.trim();
  const candidates = [
    explicitApp,
    process.resourcesPath ? path.join(process.resourcesPath, "helpers", COMPUTER_USE_HELPER_APP_NAME) : null,
    path.resolve(__dirname, "..", "resources", "helpers", COMPUTER_USE_HELPER_APP_NAME),
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function getComputerUseMcpCommand() {
  const helperExecutable = computerUseHelperExecutablePath();
  if (helperExecutable) return [helperExecutable, "mcp"];

  if (app.isPackaged) {
    throw new Error("当前安装包缺少 SeeWayWork 电脑控制组件。请重新安装 SeeWayWork。");
  }

  if (process.env.OPENWORK_DEV_MODE === "1") {
    return ["node", path.resolve(__dirname, "../../..", "packages/handsfree/bin/openwork-handsfree-computer-use.mjs"), "mcp"];
  }
  return ["npx", "-y", "@openwork/handsfree", "mcp"];
}

// ---------------------------------------------------------------------------
// Permission checks — spawn the binary with --check, read stdout, done.
// Fresh process = fresh TCC read = always accurate. No HTTP server needed.
// ---------------------------------------------------------------------------

function resolveComputerUseExecutable() {
  // 1. Explicit env override.
  const explicit = process.env.OPENWORK_COMPUTER_USE_BINARY?.trim();
  if (explicit && existsSync(explicit)) return explicit;

  // 2. .app bundle (packaged builds + pnpm dev).
  const appPath = computerUseHelperAppPath();
  if (appPath) {
    const bin = path.join(appPath, "Contents", "MacOS", COMPUTER_USE_HELPER_EXECUTABLE);
    if (existsSync(bin)) return bin;
  }

  // 3. Dev fallback — raw Swift build output.
  if (!app.isPackaged) {
    const swiftPkg = path.resolve(__dirname, "../../..", "packages/handsfree/native/HandsFree");
    const devCandidates = [
      path.join(swiftPkg, ".build", "release", "HandsFreeComputerUse"),
      path.join(swiftPkg, ".build", "arm64-apple-macosx", "release", "HandsFreeComputerUse"),
      path.join(swiftPkg, ".build", "x86_64-apple-macosx", "release", "HandsFreeComputerUse"),
      path.join(swiftPkg, ".build", "foxwork-direct", "HandsFreeComputerUse"),
      path.join(swiftPkg, ".build", "debug", "HandsFreeComputerUse"),
      path.join(swiftPkg, ".build", "arm64-apple-macosx", "debug", "HandsFreeComputerUse"),
      path.join(swiftPkg, ".build", "x86_64-apple-macosx", "debug", "HandsFreeComputerUse"),
    ];
    for (const c of devCandidates) {
      if (existsSync(c)) return c;
    }
  }

  return null;
}

async function checkComputerUsePermissions() {
  // Spawn binary --check → read JSON from stdout → exit. Always fresh.
  const bin = resolveComputerUseExecutable();
  if (!bin) {
    return { ok: false, accessibility: false, screenRecording: false, error: "找不到 SeeWayWork 电脑控制组件，请重新安装 SeeWayWork。" };
  }
  return spawnCheckPermissions(bin);
}

function spawnCheckPermissions(bin) {
  return new Promise((resolve) => {
    let stdout = "";
    const child = spawn(bin, ["--check"], { stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("error", () => resolve({ ok: false, accessibility: false, screenRecording: false, error: "无法检查电脑控制权限。" }));
    child.on("close", () => {
      try {
        const parsed = JSON.parse(stdout.trim());
        resolve({
          ok: parsed?.ok === true,
          accessibility: parsed?.accessibility === true,
          screenRecording: parsed?.screenRecording === true,
        });
      } catch {
        resolve({ ok: false, accessibility: false, screenRecording: false, error: "电脑控制权限检查返回了无效结果。" });
      }
    });
  });
}

async function listRunningApps() {
  // Spawn binary --list-apps → read JSON from stdout → exit. Needs no TCC
  // permissions, so this works before Computer Use setup is complete.
  if (process.platform !== "darwin") return { ok: false, apps: [] };
  const bin = resolveComputerUseExecutable();
  if (!bin) return { ok: false, apps: [] };
  return new Promise((resolve) => {
    let stdout = "";
    const child = spawn(bin, ["--list-apps"], { stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("error", () => resolve({ ok: false, apps: [] }));
    child.on("close", () => {
      try {
        const parsed = JSON.parse(stdout.trim());
        const apps = Array.isArray(parsed?.apps) ? parsed.apps.filter((name) => typeof name === "string" && name.trim()) : [];
        resolve({ ok: parsed?.ok === true, apps });
      } catch {
        resolve({ ok: false, apps: [] });
      }
    });
  });
}

async function openComputerUseSetupApp() {
  // Open the GUI. Use the .app bundle if available so macOS shows it as
  // a real app with its own dock icon and permission identity.
  const appPath = computerUseHelperAppPath();
  if (appPath) {
    const result = await shell.openPath(appPath);
    if (result) console.error("[ComputerUse] shell.openPath error:", result);
    return;
  }

  // Fallback: spawn the raw binary (opens the same GUI).
  const bin = resolveComputerUseExecutable();
  if (!bin) throw new Error("找不到 SeeWayWork 电脑控制组件，请重新安装 SeeWayWork。");
  const child = spawn(bin, [], { detached: true, stdio: "ignore" });
  child.unref();
}

export {
  checkComputerUsePermissions,
  getComputerUseMcpCommand,
  listRunningApps,
  openComputerUseSetupApp,
};
