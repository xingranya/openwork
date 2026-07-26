import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "bun:test"

const screenPath = fileURLToPath(
  new URL("../app/(den)/dashboard/_components/mcp-connections-screen.tsx", import.meta.url),
)

describe("pre-registered MCP OAuth bootstrap UI contract", () => {
  test("links to deployment redirect guidance before the connection is created", () => {
    const screen = readFileSync(screenPath, "utf8")

    expect(screen).toContain("客户端 ID（暂时选填）")
    expect(screen).toContain("改用预注册 OAuth 应用")
    expect(screen).toContain("OAuth 配置说明")
    expect(screen).toContain("runtimeConfig.foxworkMcpDocsUrl")
    expect(screen).toContain("先在服务商后台登记此 Den 实例的回调地址，再在这里填写凭据。")
    expect(screen).not.toContain("keepOpenForRedirect")
    expect(screen).not.toContain("Finish OAuth setup")
    expect(screen).not.toContain("Create and show redirect URL")
    expect(screen).not.toContain('aria-label="Copy callback URL"')
    expect(screen).not.toContain('aria-label="Copy client metadata URL"')
    expect(screen).not.toContain("oauthClientRequired && !oauthClientId.trim()")
  })

  test("discovers requirements automatically after the server URL settles", () => {
    const screen = readFileSync(screenPath, "utf8")

    expect(screen).toContain("MCP_REQUIREMENTS_DISCOVERY_DELAY_MS = 500")
    expect(screen).toContain("正在检查...")
    expect(screen).toContain("discoveryRequestId.current !== requestId")
    expect(screen).toContain("window.setTimeout")
    expect(screen).toContain("window.clearTimeout")
    expect(screen).toContain("重试")
    expect(screen).not.toContain("Discover requirements")
    expect(screen).not.toContain("Detected automatically")
    expect(screen).not.toContain("Administrator action required")
    expect(screen).not.toContain("Tools require authentication")
  })
})
