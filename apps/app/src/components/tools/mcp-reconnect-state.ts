import { create } from "zustand"

import type { ChatToolReconnectAction } from "./error-attribution"

export type ChatMcpReconnectPhase =
  | "ready"
  | "opening"
  | "authorization_opened"
  | "connected"
  | "failed"

export type ChatMcpReconnectRecord = {
  phase: ChatMcpReconnectPhase
  error: string | null
  authorizeUrl: string | null
}

type ChatMcpReconnectStore = {
  records: Record<string, ChatMcpReconnectRecord>
  setRecord: (key: string, record: ChatMcpReconnectRecord) => void
  reset: () => void
}

const READY_RECORD: ChatMcpReconnectRecord = { phase: "ready", error: null, authorizeUrl: null }

export function chatMcpReconnectKey(toolCallId: string, connectionId: string): string {
  return `${toolCallId}:${connectionId}`
}

export const useChatMcpReconnectStore = create<ChatMcpReconnectStore>((set) => ({
  records: {},
  setRecord: (key, record) => set((state) => ({
    records: { ...state.records, [key]: record },
  })),
  reset: () => set({ records: {} }),
}))

export function chatMcpReconnectRecord(key: string): ChatMcpReconnectRecord {
  return useChatMcpReconnectStore.getState().records[key] ?? READY_RECORD
}

export type ChatMcpReconnectPresentation = {
  badgeLabel: string
  buttonLabel: string
  disabled: boolean
}

export function chatMcpReconnectPresentation(
  action: ChatToolReconnectAction,
  phase: ChatMcpReconnectPhase,
): ChatMcpReconnectPresentation {
  switch (phase) {
    case "opening":
      return { badgeLabel: "需要重新连接", buttonLabel: "正在打开登录页面...", disabled: true }
    case "authorization_opened":
      return { badgeLabel: "需要重新连接", buttonLabel: "重新打开登录页面", disabled: false }
    case "connected":
      return { badgeLabel: "已重新连接", buttonLabel: "重试", disabled: false }
    case "failed":
      return { badgeLabel: "重新连接失败", buttonLabel: "再次连接", disabled: false }
    default:
      return { badgeLabel: "需要重新连接", buttonLabel: action.label, disabled: false }
  }
}
