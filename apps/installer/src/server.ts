import { randomBytes } from "node:crypto"

import { installerConfigSourceLabel, parseInstallLinkInput, resolveInstallLinkConfig, type InstallerConfigResolution } from "./config"
import { installStatus, launchInstalledApp, runInstall } from "./install"
import { openExternalUrl } from "./open-external-url"
import { loadSystemCaBundle, summarizeSystemCaSources } from "./system-ca"
import { renderInstallerHtml } from "./ui-html"

export type InstallerServer = {
  url: string
  token: string
  stop: () => void
}

/**
 * 仅监听回环地址的安装界面服务。写操作必须携带页面内嵌的进程级令牌，
 * 避免其他本机进程未经授权操作安装程序。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function installLinkFromPayload(value: unknown) {
  if (!isRecord(value)) {
    return ""
  }
  const installLink = value.installLink
  return typeof installLink === "string" ? installLink.trim() : ""
}

function tlsUntrustedMessage(installLink: string): string {
  const host = parseInstallLinkInput(installLink)?.host
  const certificateTarget = host ? `${host} 的证书` : "公司服务证书"
  return `已连接公司服务，但本机不信任其安全证书。这通常是公司网络检查加密流量导致的。请重试；若仍失败，请联系 IT 检查 ${certificateTarget}。`
}

export function startInstallerServer(
  initialResolution: InstallerConfigResolution | null,
  onExit: () => void,
  openBrowser: (url: string) => Promise<boolean> = openExternalUrl,
): InstallerServer {
  const token = randomBytes(16).toString("hex")
  const dryRun = process.env.OPENWORK_INSTALLER_DRY_RUN === "1"
  let resolution = initialResolution
  // 提前预热系统证书缓存，避免首次解析链接时把超时预算耗在证书导出上。
  // 同时记录各证书来源的数量，便于区分 TLS 失败和系统证书读取失败。
  void loadSystemCaBundle().then((bundle) => {
    console.log(`[openwork-installer] OS trust store: ${summarizeSystemCaSources(bundle.sources)}`)
  })

  async function refreshActivation() {
    if (!resolution) return null
    if (!resolution.installLink) return resolution.activation

    const result = await resolveInstallLinkConfig(resolution.installLink)
    if (result.status !== "resolved") return null
    resolution = {
      config: result.config,
      source: "install-link",
      activation: result.activation,
      installLink: resolution.installLink,
    }
    return resolution.activation
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (request.method === "GET" && url.pathname === "/") {
        return new Response(renderInstallerHtml(resolution, token), {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      }

      if (url.pathname.startsWith("/api/")) {
        if (request.headers.get("x-installer-token") !== token) {
          return Response.json({ error: "forbidden" }, { status: 403 })
        }
        if (request.method === "GET" && url.pathname === "/api/status") {
          return Response.json(installStatus())
        }
        if (request.method === "POST" && url.pathname === "/api/resolve-link") {
          const installLink = installLinkFromPayload(await request.json().catch(() => null))
          if (!installLink) {
            return Response.json({ error: "missing_install_link", message: "请粘贴 SeeWayWork 安装链接。" }, { status: 400 })
          }
          const result = await resolveInstallLinkConfig(installLink)
          if (result.status !== "resolved") {
            if (result.status === "not-found") {
              return Response.json({
                error: "install_link_expired",
                message: "该安装链接已过期或已被替换，请联系公司管理员从“成员”页面获取新链接。",
              }, { status: 400 })
            }
            if (result.status === "invalid-input") {
              return Response.json({
                error: "install_link_invalid",
                message: "这不是有效的公司安装链接。请在公司安装页面复制第 2 步显示的完整链接，链接应以 ?token=... 结尾。",
              }, { status: 400 })
            }
            if (result.status === "unreachable") {
              if (result.reason === "tls") {
                const bundle = await loadSystemCaBundle()
                return Response.json({
                  error: "install_link_tls_untrusted",
                  message: tlsUntrustedMessage(installLink),
                  trustSources: summarizeSystemCaSources(bundle.sources),
                }, { status: 400 })
              }
              return Response.json({
                error: "install_link_unreachable",
                message: "无法连接公司服务，请检查网络或 VPN 后重试。",
              }, { status: 400 })
            }
            return Response.json({
              error: "install_link_invalid",
              message: "无法解析安装链接。",
            }, { status: 400 })
          }
          resolution = {
            config: result.config,
            source: "install-link",
            activation: result.activation,
            installLink,
          }
          return Response.json({ ok: true, source: installerConfigSourceLabel(resolution.source) })
        }
        if (request.method === "POST" && url.pathname === "/api/install") {
          if (!resolution) {
            return Response.json({ error: "missing_config" }, { status: 409 })
          }
          void runInstall(resolution.config, { dryRun })
          return Response.json({ ok: true })
        }
        if (request.method === "POST" && url.pathname === "/api/launch") {
          const installedPath = installStatus().installedPath
          if (!installedPath) return Response.json({ error: "not_installed" }, { status: 409 })
          launchInstalledApp(installedPath)
          return Response.json({ ok: true })
        }
        if (request.method === "POST" && url.pathname === "/api/activation") {
          const activation = await refreshActivation()
          if (!activation) {
            return Response.json({
              error: "activation_unavailable",
              message: "无法创建浏览器登录链接，请重新粘贴公司安装链接。",
            }, { status: 409 })
          }
          return Response.json({
            activationUrl: activation.url,
            expiresAt: activation.expiresAt,
          })
        }
        if (request.method === "POST" && url.pathname === "/api/open-activation") {
          const activation = await refreshActivation()
          if (!activation) {
            return Response.json({
              error: "activation_unavailable",
              message: "无法创建浏览器登录链接，请重新粘贴公司安装链接。",
            }, { status: 409 })
          }
          return Response.json({
            opened: await openBrowser(activation.url),
            activationUrl: activation.url,
            expiresAt: activation.expiresAt,
          })
        }
        if (request.method === "POST" && url.pathname === "/api/exit") {
          setTimeout(onExit, 50)
          return Response.json({ ok: true })
        }
      }
      return new Response("未找到请求的内容", { status: 404 })
    },
  })

  return {
    url: `http://127.0.0.1:${server.port}/`,
    token,
    stop: () => server.stop(true),
  }
}
