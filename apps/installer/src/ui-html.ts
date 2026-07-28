import { installerConfigSourceLabel, type InstallerConfigResolution } from "./config"
import { OPENWORK_LOGO_SVG } from "./openwork-logo"
import { INSTALLER_VERSION } from "./version"

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;"
      case "<":
        return "&lt;"
      case ">":
        return "&gt;"
      case '"':
        return "&quot;"
      case "'":
        return "&#39;"
      default:
        return char
    }
  })
}

export function renderInstallerHtml(resolution: InstallerConfigResolution | null, token: string): string {
  const config = resolution?.config ?? null
  const logo = config?.logoUrl
    ? `<img class="logo" src="${escapeHtml(config.logoUrl)}" alt="${escapeHtml(config.clientName)}" />`
    : `<div class="logo">${OPENWORK_LOGO_SVG}</div>`
  const sourceLabel = resolution ? installerConfigSourceLabel(resolution.source) : ""
  const appName = config?.appName ?? "FoxWork"
  const configuredContent = config
    ? `
  ${logo}
  <div class="title">安装 ${escapeHtml(config.appName)}</div>
  <div class="client">为 ${escapeHtml(config.clientName)} 安装并连接 ${escapeHtml(config.appName)}（${escapeHtml(config.webUrl)}）。</div>
  <div class="source">配置来源：${escapeHtml(sourceLabel)}</div>
  <div class="bar" id="bar"><div id="bar-fill"></div></div>
  <div class="buttons">
    <button class="primary" id="action">安装</button>
    <button id="exit">退出</button>
  </div>
  <div class="activation" id="activation" hidden>
    <div class="activation-title">Browser didn&apos;t open?</div>
    <div class="activation-copy">Try again, or copy this one-time activation link into a browser on this computer.</div>
    <div class="link-row">
      <input id="activation-link" type="url" readonly aria-label="Activation link" />
      <button id="copy-activation" type="button">Copy link</button>
    </div>
    <button id="retry-activation" type="button">Try opening browser again</button>
    <div class="activation-expiry" id="activation-expiry"></div>
  </div>
  <div class="status" id="status"></div>`
    : `
  <div class="logo">${OPENWORK_LOGO_SVG}</div>
  <div class="title">粘贴 FoxWork 安装链接</div>
  <div class="client">请向公司管理员获取安装链接。</div>
  <form class="paste" id="paste-form">
    <input id="install-link" type="url" placeholder="https://.../install?token=..." autocomplete="off" required />
    <button class="primary" id="continue" type="submit">继续</button>
  </form>
  <div class="buttons single">
    <button id="exit">退出</button>
  </div>
  <div class="status" id="status"></div>`

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(appName)} 安装程序</title>
<style>
  :root { color-scheme: light; }
  html, body { height: 100%; margin: 0; }
  body {
    display: grid; place-items: center;
    background: #ffffff; color: #18181b;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    -webkit-user-select: none; user-select: none;
  }
  main { display: grid; gap: 6px; justify-items: center; width: 340px; text-align: center; }
  .logo { max-height: 100px; max-width: 260px; width: auto; height: auto; object-fit: contain; margin-bottom: 10px; }
  div.logo svg { max-height: 72px; width: auto; height: 72px; }
  .title { font-size: 17px; font-weight: 600; }
  .client { font-size: 14px; color: #71717a; margin-bottom: 6px; line-height: 1.35; }
  .source { font-size: 11px; color: #a1a1aa; margin-bottom: 8px; }
  .status { font-size: 12px; color: #71717a; min-height: 30px; margin-top: 12px; }
  .status.error { color: #dc2626; }
  .status.done { color: #16a34a; font-weight: 600; }
  .bar { width: 100%; height: 4px; border-radius: 2px; background: rgba(24,24,27,.12); overflow: hidden; visibility: hidden; }
  .bar > div { height: 100%; width: 0%; background: #18181b; transition: width .2s; }
  .buttons { display: flex; gap: 10px; margin-top: 6px; }
  button {
    font: inherit; font-size: 13px; padding: 7px 22px; border-radius: 7px; cursor: pointer;
    border: 1px solid rgba(24,24,27,.2); background: #ffffff; color: #18181b;
  }
  button.primary { background: #18181b; color: #ffffff; border-color: transparent; font-weight: 600; }
  button:disabled { opacity: .4; cursor: default; }
  .single { margin-top: 2px; }
  .paste { display: grid; gap: 10px; width: 100%; margin-top: 10px; }
  .link-row { display: flex; gap: 8px; width: 100%; }
  .link-row input { flex: 1; min-width: 0; }
  .paste-button { padding-left: 16px; padding-right: 16px; }
  input { box-sizing: border-box; width: 100%; border: 1px solid rgba(24,24,27,.16); border-radius: 8px; padding: 9px 10px; font: inherit; font-size: 13px; }
  .activation { display: grid; gap: 8px; width: 100%; margin-top: 10px; padding: 12px; box-sizing: border-box; border: 1px solid rgba(24,24,27,.12); border-radius: 10px; background: #f7f7f8; text-align: left; }
  .activation[hidden] { display: none; }
  .activation-title { font-size: 13px; font-weight: 600; }
  .activation-copy, .activation-expiry { color: #71717a; font-size: 11px; line-height: 1.4; }
  #activation-link { background: #ffffff; color: #52525b; font-size: 10px; }
  #copy-activation, #retry-activation { padding-left: 12px; padding-right: 12px; }
  /* Pinned to the window edge so identifying the build never shifts the primary action. */
  .version { position: fixed; bottom: 6px; left: 0; right: 0; text-align: center; font-size: 10px; color: #c8c8cc; }
</style>
</head>
<body>
<main>
${configuredContent}
</main>
<div class="version">Installer ${escapeHtml(INSTALLER_VERSION)}</div>
<script>
  const TOKEN = ${JSON.stringify(token)};
  const CONFIGURED = ${config ? "true" : "false"};
  const HAS_ACTIVATION = ${resolution?.activation ? "true" : "false"};
  const statusEl = document.getElementById("status");
  const barEl = document.getElementById("bar");
  const barFillEl = document.getElementById("bar-fill");
  const actionBtn = document.getElementById("action");
  const exitBtn = document.getElementById("exit");
  const pasteForm = document.getElementById("paste-form");
  const installLinkInput = document.getElementById("install-link");
  const pasteBtn = document.getElementById("paste-button");
  const continueBtn = document.getElementById("continue");
  const activationEl = document.getElementById("activation");
  const activationLinkInput = document.getElementById("activation-link");
  const activationExpiryEl = document.getElementById("activation-expiry");
  const copyActivationBtn = document.getElementById("copy-activation");
  const retryActivationBtn = document.getElementById("retry-activation");
  let polling = null;
  let installed = false;

  async function api(path) {
    const response = await fetch(path, { method: "POST", headers: { "x-installer-token": TOKEN } });
    if (!response.ok) throw new Error("安装程序请求失败（" + response.status + "）。");
    return response.json();
  }

  function userMessage(value, fallback) {
    const message = typeof value === "string" ? value.trim() : "";
    return /[\u3400-\u9fff]/u.test(message) ? message : fallback;
  }

  function closeWindow() {
    if (window.openworkInstallerExit) {
      // 原生窗口通过绑定函数结束事件循环。
      window.openworkInstallerExit();
      return;
    }
    api("/api/exit").catch(() => {});
    window.close();
  }

  function render(status) {
    if (!CONFIGURED) return;
    const downloading = status.step === "download" && status.totalBytes;
    barEl.style.visibility = downloading ? "visible" : "hidden";
    if (downloading) barFillEl.style.width = Math.round(100 * status.downloadedBytes / status.totalBytes) + "%";
    statusEl.classList.toggle("error", status.state === "error");
    statusEl.classList.toggle("done", status.state === "done");

    if (status.state === "running") {
      statusEl.textContent = userMessage(status.message, "正在准备安装…");
      actionBtn.disabled = true;
      return;
    }
    if (polling) { clearInterval(polling); polling = null; }
    if (status.state === "done") {
      installed = true;
      statusEl.textContent = "安装完成";
      actionBtn.textContent = "打开 FoxWork";
      actionBtn.disabled = false;
      return;
    }
    if (status.state === "error") {
      statusEl.textContent = userMessage(status.message, "安装失败，请检查网络后重试。");
      actionBtn.textContent = "重试";
      actionBtn.disabled = false;
    }
  }

  if (pasteForm) {
    if (pasteBtn) pasteBtn.addEventListener("click", async () => {
      pasteBtn.disabled = true;
      try {
        await pasteClipboardText(installLinkInput, true);
      } finally {
        pasteBtn.disabled = false;
      }
    });

    pasteForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      continueBtn.disabled = true;
      statusEl.classList.remove("error");
      statusEl.textContent = "正在检查安装链接…";
      try {
        const response = await fetch("/api/resolve-link", {
          method: "POST",
          headers: { "content-type": "application/json", "x-installer-token": TOKEN },
          body: JSON.stringify({ installLink: installLinkInput.value })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || "无法识别安装链接，请检查后重试。");
        window.location.reload();
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        statusEl.textContent = userMessage(message, "无法识别安装链接，请检查网络和链接后重试。");
        statusEl.classList.add("error");
        continueBtn.disabled = false;
      }
    });
  }

  document.addEventListener("keydown", (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    const input = editableInput();
    if (!input) return;
    const key = event.key.toLowerCase();
    if (key === "v") {
      event.preventDefault();
      void pasteClipboardText(input, false);
      return;
    }
    if (key === "c") {
      event.preventDefault();
      void copyInputSelection(input, false);
      return;
    }
    if (key === "x") {
      event.preventDefault();
      void copyInputSelection(input, true);
      return;
    }
    if (key === "a") {
      event.preventDefault();
      input.focus();
      input.select();
    }
  });

  if (actionBtn) actionBtn.addEventListener("click", async () => {
    if (installed) {
      if (HAS_ACTIVATION) {
        await openActivation();
        return;
      }
      try { await api("/api/launch"); } catch {}
      closeWindow();
      return;
    }
    actionBtn.disabled = true;
    try {
      await api("/api/install");
      polling = setInterval(async () => {
        try {
          const response = await fetch("/api/status", { headers: { "x-installer-token": TOKEN } });
          render(await response.json());
        } catch {}
      }, 400);
    } catch (error) {
      statusEl.textContent = "无法开始安装，请稍后重试。";
      statusEl.classList.add("error");
      actionBtn.disabled = false;
    }
  });

  if (copyActivationBtn) copyActivationBtn.addEventListener("click", async () => {
    copyActivationBtn.disabled = true;
    try {
      await copyFreshActivation();
    } catch (error) {
      statusEl.textContent = error.message || "Could not copy the activation link.";
      statusEl.classList.add("error");
    } finally {
      copyActivationBtn.disabled = false;
    }
  });

  if (retryActivationBtn) retryActivationBtn.addEventListener("click", openActivation);

  exitBtn.addEventListener("click", closeWindow);
</script>
</body>
</html>`
}
