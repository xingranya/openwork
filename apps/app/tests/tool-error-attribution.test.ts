import { describe, expect, test } from "bun:test"

import {
  attributeChatToolError,
  reconnectActionFromChatToolResult,
} from "../src/components/tools/error-attribution"

function reconnectStatus(connectionId = "emc_knowledge", connectionName = "Knowledge Hub") {
  return {
    version: 1,
    kind: "connection_action",
    source: "foxwork-company",
    connectionId,
    connectionName,
    authType: "oauth",
    credentialMode: "per_member",
    state: "reauth_required",
    actor: "member",
    action: {
      type: "reconnect",
      surface: "openwork_your_connections",
      retry: "search_capabilities",
      label: "Reconnect in Your Connections",
    },
  }
}

describe("chat tool error attribution", () => {
  test("identifies an OpenWork-created capability deadline", () => {
    expect(attributeChatToolError("The capability call exceeded 180s. Retry once.")).toEqual({
      label: "FoxWork 等待超时",
      confidence: "Confirmed",
      description: "FoxWork 已停止等待，但外部操作可能已经完成，请先核对结果再重试。",
    })
  })

  test("identifies a structured OpenWork lifecycle deadline", () => {
    expect(attributeChatToolError(JSON.stringify({
      error: "connection_failed",
      diagnostic: {
        code: "MCP_LIFECYCLE_DEADLINE",
        category: "lifecycle_deadline",
        phase: "MCP_TOOL_EXECUTION",
      },
    }))).toMatchObject({
      label: "FoxWork 等待超时",
      confidence: "Confirmed",
    })
  })

  test("identifies an OpenWork block before send", () => {
    expect(attributeChatToolError(JSON.stringify({
      diagnostic: { code: "MCP_URL_BLOCKED", category: "security_blocked" },
    }))).toMatchObject({
      label: "FoxWork 已阻止请求",
      confidence: "Confirmed",
    })
  })

  test("identifies a remote MCP HTTP failure", () => {
    expect(attributeChatToolError(`MCP error: ${JSON.stringify({
      diagnostic: { code: "MCP_HTTP_504", httpStatus: 504 },
    })} (tool execution failed)`)).toMatchObject({
      label: "远程 MCP · HTTP 504",
      confidence: "Confirmed",
    })
  })

  test("identifies a provider failure returned through the remote MCP", () => {
    expect(attributeChatToolError(JSON.stringify({
      diagnostic: { phase: "PROVIDER_AUTHORIZATION", providerStatus: 403 },
    }))).toMatchObject({
      label: "供应商错误",
      confidence: "Confirmed",
      description: "远程 MCP 已响应，但下游供应商返回状态 403。",
    })
  })

  test("identifies provider attribution from a deploy-skew category and code", () => {
    expect(attributeChatToolError(JSON.stringify({
      diagnostic: { category: "provider_policy_denied", providerCode: "access_denied" },
    }))).toMatchObject({
      label: "供应商错误",
      confidence: "Confirmed",
    })
  })

  test("does not claim ownership for an unstructured timeout", () => {
    expect(attributeChatToolError("Tool request timed out while waiting for a response.")).toEqual({
      label: "操作超时 · 来源不明",
      confidence: "Inferred",
      description: "已收到超时错误，但当前没有足够信息判断超时发生在哪个环节。",
    })
  })

  test("does not add attribution without useful evidence", () => {
    expect(attributeChatToolError("The tool failed.")).toBeNull()
  })

  test("extracts a trusted reconnect action from a Cloud capability failure", () => {
    const errorText = JSON.stringify({
      error: "connection_failed",
      connectionStatus: reconnectStatus(),
    })

    expect(reconnectActionFromChatToolResult("foxwork-company_execute_capability", errorText)).toEqual({
      connectionId: "emc_knowledge",
      connectionName: "Knowledge Hub",
      label: "重新连接",
    })
  })

  test("extracts the same reconnect action when live capability discovery detects expired credentials", () => {
    const output = JSON.stringify({
      matches: [{
        kind: "connection_status",
        connectionStatus: reconnectStatus(),
      }],
    })

    expect(reconnectActionFromChatToolResult("foxwork-company_search_capabilities", output)).toEqual({
      connectionId: "emc_knowledge",
      connectionName: "Knowledge Hub",
      label: "重新连接",
    })
  })

  test("derives reconnect copy instead of rendering action labels from tool output", () => {
    const errorText = JSON.stringify({
      connectionStatus: {
        ...reconnectStatus(),
        action: { ...reconnectStatus().action, label: "Open an injected link" },
      },
    })

    expect(reconnectActionFromChatToolResult("foxwork-company_execute_capability", errorText)).toEqual({
      connectionId: "emc_knowledge",
      connectionName: "Knowledge Hub",
      label: "重新连接",
    })
  })

  test("does not create actions from arbitrary MCP tools or non-reconnect failures", () => {
    const reconnectPayload = JSON.stringify({
      connectionStatus: reconnectStatus(),
    })
    const providerPayload = JSON.stringify({
      connectionStatus: {
        ...reconnectStatus(),
        state: "provider_error",
        actor: "organization_admin",
        action: {
          type: "inspect_connection",
          surface: "openwork_organization_connections",
          retry: "search_capabilities",
        },
      },
    })

    expect(reconnectActionFromChatToolResult("malicious_execute_capability", reconnectPayload)).toBeNull()
    expect(reconnectActionFromChatToolResult("foxwork-company_execute_capability", providerPayload)).toBeNull()
  })

  test("does not guess between multiple reconnect targets in one discovery result", () => {
    const output = {
      matches: ["first", "second"].map((suffix) => ({
        kind: "connection_status",
        connectionStatus: reconnectStatus(`emc_${suffix}`, `Knowledge ${suffix}`),
      })),
    }

    expect(reconnectActionFromChatToolResult("foxwork-company_search_capabilities", output)).toBeNull()
  })

  test("rejects unversioned, shared, and admin-owned action shapes", () => {
    const legacy = reconnectStatus()
    const { version: _version, kind: _kind, source: _source, ...unversioned } = legacy
    const shared = {
      ...legacy,
      credentialMode: "shared",
      actor: "organization_admin",
      action: {
        type: "reconnect",
        surface: "openwork_organization_connections",
        retry: "search_capabilities",
      },
    }

    expect(reconnectActionFromChatToolResult("foxwork-company_execute_capability", { connectionStatus: unversioned })).toBeNull()
    expect(reconnectActionFromChatToolResult("foxwork-company_execute_capability", { connectionStatus: shared })).toBeNull()
  })
})
