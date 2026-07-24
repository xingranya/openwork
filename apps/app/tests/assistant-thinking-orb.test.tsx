import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "bun:test"
import { AssistantThinkingOrb } from "../src/components/chat/assistant-thinking-orb"

function read(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
}

describe("FoxWork AI 等待图标", () => {
  test("使用 Thinking Orbs 的工作状态并适配应用主题", () => {
    const markup = renderToStaticMarkup(<AssistantThinkingOrb />)

    expect(markup).toContain("data-testid=\"assistant-thinking-orb\"")
    expect(markup).toContain("role=\"presentation\"")
    expect(markup).toContain("width:20px")
    expect(markup).not.toContain("Working")
  })

  test("空会话和流式回答共用同一个等待图标", () => {
    const messageList = read("../src/components/chat/message-list.tsx")
    const sessionSurface = read("../src/react-app/domains/session/surface/session-surface.tsx")

    expect(messageList).toContain("<AssistantThinkingOrb />")
    expect(sessionSurface).toContain("<AssistantThinkingOrb />")
    expect(messageList).not.toContain("PaperGrainGradient")
    expect(sessionSurface).not.toContain("PaperGrainGradient")
  })
})
