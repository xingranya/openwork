import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "bun:test"

const screenPath = fileURLToPath(
  new URL("../app/(den)/dashboard/_components/mcp-connections-screen.tsx", import.meta.url),
)
const dataPath = fileURLToPath(
  new URL("../app/(den)/dashboard/_components/mcp-connections-data.tsx", import.meta.url),
)

describe("MCP OAuth callback compatibility UI contract", () => {
  test("keeps callback compatibility out of connection rows", () => {
    const screen = readFileSync(screenPath, "utf8")
    const data = readFileSync(dataPath, "utf8")

    expect(screen).toContain("onClick={onConnect}")
    expect(screen).not.toContain("Current callback:")
    expect(screen).not.toContain("Client metadata:")
    expect(screen).not.toContain("Callback update required")
    expect(screen).not.toContain("Reconnect using shared callback")
    expect(screen).not.toContain("Revert to previous callback")
    expect(data).not.toContain("/oauth/use-shared-callback")
    expect(data).not.toContain("/oauth/revert-shared-callback")
    expect(data).not.toContain("oauthMigrationStatus")
  })

  test("keeps connection rows focused on connect, disconnect, and a compact actions menu", () => {
    const screen = readFileSync(screenPath, "utf8")

    expect(screen).toContain('const canConnectOAuth = !setupRequired && !connection.issuerReviewRequired && connection.authType === "oauth"')
    expect(screen).toContain('isPerMember ? !connection.connectedForMe : !connection.connected')
    expect(screen).toContain('aria-haspopup="menu"')
    expect(screen).toContain('role="menu"')
    expect(screen).toContain('aria-label={`${connection.name} 的更多操作`}')
    expect(screen).toContain('{toolsOpen ? "收起工具" : "查看工具"}')
  })

  test("requires explicit administrator confirmation when live issuer metadata changes", () => {
    const screen = readFileSync(screenPath, "utf8")
    const data = readFileSync(dataPath, "utf8")

    expect(screen).toContain("需要复核 OAuth 设置")
    expect(screen).toContain("复核 OAuth 服务")
    expect(screen).toContain("确认签发方")
    expect(screen).toContain("旧 OAuth 客户端和凭据会被清除")
    expect(data).toContain("/oauth/issuer-review")
    expect(data).toContain('action: "preview" | "confirm"')
  })

  test("edits requested scopes without forcing an immediate reconnect", () => {
    const screen = readFileSync(screenPath, "utf8")

    expect(screen).toContain("申请的 OAuth 授权范围")
    expect(screen).toContain("requestedScopesText")
    expect(screen).toContain("修改后需重新连接并授权。")
  })

  test("warns before deleting a connection", () => {
    const screen = readFileSync(screenPath, "utf8")

    expect(screen).toContain("相关访问授权、成员认证状态以及插件或能力市场绑定都会被移除")
    expect(screen).toContain("window.confirm")
  })

  test("does not expose runtime selection to the normalized UI contract", () => {
    const screen = readFileSync(screenPath, "utf8")
    const data = readFileSync(dataPath, "utf8")

    expect(screen).not.toContain("DEN_ENABLE_ENTERPRISE_MCP_CLIENT")
    expect(data).not.toContain("DEN_ENABLE_ENTERPRISE_MCP_CLIENT")
    expect(data).not.toContain("enterpriseRuntime")
  })
})
