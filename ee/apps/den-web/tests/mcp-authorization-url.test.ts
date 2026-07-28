import { describe, expect, test } from "bun:test"
import {
  mcpAuthorizationErrorDocument,
  mcpAuthorizationPendingDocument,
  safeMcpAuthorizationUrl,
} from "../app/(den)/dashboard/_components/mcp-authorization-url"

describe("safeMcpAuthorizationUrl", () => {
  test("allows provider HTTPS and loopback HTTP authorization URLs", () => {
    expect(safeMcpAuthorizationUrl("https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize?state=opaque"))
      .toStartWith("https://login.microsoftonline.com/")
    expect(safeMcpAuthorizationUrl("http://127.0.0.1:3978/authorize")).toBe("http://127.0.0.1:3978/authorize")
    expect(safeMcpAuthorizationUrl("http://localhost:3978/authorize")).toBe("http://localhost:3978/authorize")
  })

  test.each([
    "http://login.example.com/authorize",
    "https://user:password@login.example.com/authorize",
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "file:///tmp/token",
    "not a url",
  ])(
    "rejects unsafe provider authorization URL %s",
    (url) => expect(() => safeMcpAuthorizationUrl(url)).toThrow(),
  )
})

describe("mcpAuthorizationPendingDocument", () => {
  test("服务跳转前显示简洁且可访问的中文连接页", () => {
    const document = mcpAuthorizationPendingDocument()

    expect(document).toContain('<html lang="zh-CN">')
    expect(document).toContain("正在准备连接")
    expect(document).toContain("正在安全检查服务")
    expect(document).toContain("请保持此窗口打开")
    expect(document).toContain("SeeWayWork 公司连接")
    expect(document).not.toContain("OpenWork Connect")
    expect(document).not.toContain("Preparing your connection")
    expect(document).toContain('role="status"')
    expect(document).toContain('aria-live="polite"')
    expect(document).toContain("prefers-reduced-motion: reduce")
  })
})

describe("mcpAuthorizationErrorDocument", () => {
  test("OAuth 失败时显示中文提示并保留准确的重定向地址", () => {
    const document = mcpAuthorizationErrorDocument({
      message: "A pre-registered OAuth client is required.",
      details: {
        httpStatus: 409,
        errorCode: "mcp_oauth_configuration_required",
        redirectUri: "https://api.openwork.example/v1/mcp-connections/oauth/callback",
        clientMetadataUrl: "https://api.openwork.example/.well-known/oauth-client",
        responseJson: JSON.stringify({
          error: "mcp_oauth_configuration_required",
          callbackUrl: "https://api.openwork.example/v1/mcp-connections/oauth/callback",
        }, null, 2),
      },
    })

    expect(document).toContain('<html lang="zh-CN">')
    expect(document).toContain("连接失败")
    expect(document).toContain("无法连接 MCP 账号，请重试。")
    expect(document).not.toContain("A pre-registered OAuth client is required.")
    expect(document).toContain("技术详情")
    expect(document).toContain("重定向地址")
    expect(document).toContain("https://api.openwork.example/v1/mcp-connections/oauth/callback")
    expect(document).toContain("HTTP 状态")
    expect(document).toContain("409")
    expect(document).toContain("错误代码")
    expect(document).toContain("mcp_oauth_configuration_required")
    expect(document).toContain("返回数据")
    expect(document).not.toContain("Connection failed")
    expect(document).not.toContain("Technical details")
    expect(document).toContain("<details>")
    expect(document).not.toContain("<details open")
    expect(document).toContain('role="alert"')
    expect(document).not.toContain("window.close")
  })

  test("escapes API error details before writing them into the popup", () => {
    const document = mcpAuthorizationErrorDocument({
      message: '<script>alert("message")</script>',
      details: {
        httpStatus: 502,
        redirectUri: 'https://example.com/callback?next=<script>alert("uri")</script>',
        responseJson: '<script>alert("response")</script>',
      },
    })

    expect(document).not.toContain("<script>alert")
    expect(document).not.toContain("alert(&quot;message&quot;)")
    expect(document).toContain("无法连接 MCP 账号，请重试。")
    expect(document).toContain("next=&lt;script&gt;alert(&quot;uri&quot;)&lt;/script&gt;")
    expect(document).toContain("&lt;script&gt;alert(&quot;response&quot;)&lt;/script&gt;")
  })
})
