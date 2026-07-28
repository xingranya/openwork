import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { DynamicToolUIPart } from "ai"

import { Tool } from "../src/components/ui/tool"

test("renders compact MCP attribution in a failed chat tool row", () => {
  const toolPart: DynamicToolUIPart = {
    type: "dynamic-tool",
    toolName: "foxwork-company_execute_capability",
    toolCallId: "call-1",
    state: "output-error",
    input: {},
    errorText: JSON.stringify({
      error: "connection_failed",
      diagnostic: { code: "MCP_HTTP_504", httpStatus: 504 },
    }),
  }

  const html = renderToStaticMarkup(<Tool toolPart={toolPart} />)

  expect(html).toContain("远程 MCP · HTTP 504")
  expect(html).toContain("错误来源：远程 MCP · HTTP 504。已确认。")
  expect(html).not.toContain(">failed<")
})

test("renders an inline reconnect button when Cloud capability discovery finds expired credentials", () => {
  const toolPart: DynamicToolUIPart = {
    type: "dynamic-tool",
    toolName: "foxwork-company_search_capabilities",
    toolCallId: "call-reconnect",
    state: "output-available",
    input: {},
    output: JSON.stringify({
      matches: [{
        kind: "connection_status",
        connectionStatus: {
          version: 1,
          kind: "connection_action",
          source: "foxwork-company",
          connectionId: "emc_knowledge",
          connectionName: "Knowledge Hub",
          authType: "oauth",
          credentialMode: "per_member",
          state: "reauth_required",
          actor: "member",
          action: {
            type: "reconnect",
            surface: "openwork_your_connections",
            retry: "search_capabilities",
          },
        },
      }],
    }),
  }

  const html = renderToStaticMarkup(
    <Tool toolPart={toolPart} onReconnect={async () => "connected"} />,
  )

  expect(html).toContain("需要重新连接")
  expect(html).toContain('aria-label="重新连接 Knowledge Hub"')
  expect(html).toContain("重新连接</button>")
  expect(html).toContain("bg-amber-3/60")
  expect(html).toContain('data-testid="chat-mcp-reconnect-action"')
})

test("renders a copy action inside the expanded tool result", () => {
  const toolPart: DynamicToolUIPart = {
    type: "dynamic-tool",
    toolName: "foxwork-company_search_capabilities",
    toolCallId: "call-copy",
    state: "output-available",
    input: { query: "Notion pages" },
    output: { matches: [{ name: "searchPages" }] },
  }

  const html = renderToStaticMarkup(<Tool toolPart={toolPart} defaultOpen />)
  const contentIndex = html.indexOf('data-slot="collapsible-content"')
  const copyActionIndex = html.indexOf('data-testid="tool-result-copy-action"')

  expect(html).toContain('data-testid="tool-result-copy-action"')
  expect(html).toContain('aria-label="复制工具结果"')
})

test("does not render a copy action before a tool has a result", () => {
  const toolPart: DynamicToolUIPart = {
    type: "dynamic-tool",
    toolName: "foxwork-company_search_capabilities",
    toolCallId: "call-running",
    state: "input-available",
    input: { query: "Notion pages" },
  }

  const html = renderToStaticMarkup(<Tool toolPart={toolPart} />)

  expect(html).not.toContain('data-testid="tool-result-copy-action"')
})
