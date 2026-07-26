import { beforeEach, describe, expect, test } from "bun:test"

import {
  chatMcpReconnectKey,
  chatMcpReconnectPresentation,
  chatMcpReconnectRecord,
  useChatMcpReconnectStore,
} from "../src/components/tools/mcp-reconnect-state"

const action = {
  connectionId: "emc_research",
  connectionName: "Research Vault",
  label: "重新连接",
}

beforeEach(() => useChatMcpReconnectStore.getState().reset())

describe("chat MCP reconnect state", () => {
  test("keeps completion by tool call and connection across component remounts", () => {
    const key = chatMcpReconnectKey("call-1", action.connectionId)
    useChatMcpReconnectStore.getState().setRecord(key, { phase: "connected", error: null, authorizeUrl: null })

    expect(chatMcpReconnectRecord(key)).toEqual({ phase: "connected", error: null, authorizeUrl: null })
    expect(chatMcpReconnectRecord(chatMcpReconnectKey("call-2", action.connectionId))).toEqual({
      phase: "ready",
      error: null,
      authorizeUrl: null,
    })
  })

  test("keeps the pending browser continuation across chat row remounts", () => {
    const key = chatMcpReconnectKey("call-1", action.connectionId)
    const authorizeUrl = "https://provider.example/authorize?state=pending"
    useChatMcpReconnectStore.getState().setRecord(key, {
      phase: "authorization_opened",
      error: null,
      authorizeUrl,
    })

    expect(chatMcpReconnectRecord(key)).toEqual({
      phase: "authorization_opened",
      error: null,
      authorizeUrl,
    })

    useChatMcpReconnectStore.getState().reset()
    expect(chatMcpReconnectRecord(key)).toEqual({ phase: "ready", error: null, authorizeUrl: null })
  })

  test("presents a safe retry only after reconnection completes", () => {
    expect(chatMcpReconnectPresentation(action, "ready")).toEqual({
      badgeLabel: "需要重新连接",
      buttonLabel: "重新连接",
      disabled: false,
    })
    expect(chatMcpReconnectPresentation(action, "authorization_opened")).toEqual({
      badgeLabel: "需要重新连接",
      buttonLabel: "重新打开登录页面",
      disabled: false,
    })
    expect(chatMcpReconnectPresentation(action, "connected")).toEqual({
      badgeLabel: "已重新连接",
      buttonLabel: "重试",
      disabled: false,
    })
    expect(chatMcpReconnectPresentation(action, "failed")).toEqual({
      badgeLabel: "重新连接失败",
      buttonLabel: "再次连接",
      disabled: false,
    })
  })
})
