import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "bun:test"
import {
  appendAssistantQuote,
  formatAssistantQuote,
  readSelectionTextAtPointWithin,
  readSelectionTextWithin,
} from "../src/components/chat/assistant-message-actions"

const messageListSource = readFileSync(
  fileURLToPath(new URL("../src/components/chat/message-list.tsx", import.meta.url)),
  "utf8",
)

function selection(input: {
  anchorNode: Node | null
  focusNode: Node | null
  isCollapsed?: boolean
  rects?: Array<{ bottom: number; left: number; right: number; top: number }>
  text: string
}): Pick<Selection, "anchorNode" | "focusNode" | "getRangeAt" | "isCollapsed" | "rangeCount" | "toString"> {
  return {
    anchorNode: input.anchorNode,
    focusNode: input.focusNode,
    getRangeAt: () => ({
      getClientRects: () => input.rects ?? [],
    } as unknown as Range),
    isCollapsed: input.isCollapsed ?? false,
    rangeCount: 1,
    toString: () => input.text,
  }
}

describe("AI 回复右键操作", () => {
  test("AI 回复允许选择文本并只对当前选区提供操作", () => {
    expect(messageListSource).toContain('className="!select-text"')
    expect(messageListSource).toContain("onMouseUp={updateSelectedText}")
    expect(messageListSource).toContain("onContextMenuCapture={prepareSelectionMenu}")
    expect(messageListSource).toContain("readSelectionTextAtPointWithin(")
    expect(messageListSource).toContain("if (!text) event.preventDefault()")
    expect(messageListSource).toContain("open={selectionMenuOpen}")
    expect(messageListSource).toContain("添加到聊天框")
    expect(messageListSource).not.toContain("复制整条回复")

    const addToChatIndex = messageListSource.indexOf("添加到聊天框")
    const copyIndex = messageListSource.indexOf("复制\n")
    expect(addToChatIndex).toBeGreaterThan(-1)
    expect(copyIndex).toBeGreaterThan(addToChatIndex)
  })

  test("只读取起点和终点都属于当前回复的选区", () => {
    const inside = {} as Node
    const outside = {} as Node
    const container = {
      contains: (node: Node | null) => node === inside,
    }

    expect(readSelectionTextWithin(container, selection({
      anchorNode: inside,
      focusNode: inside,
      text: "  当前回复  ",
    }))).toBe("当前回复")
    expect(readSelectionTextWithin(container, selection({
      anchorNode: inside,
      focusNode: outside,
      text: "跨回复选区",
    }))).toBe("")
    expect(readSelectionTextWithin(container, selection({
      anchorNode: inside,
      focusNode: inside,
      isCollapsed: true,
      text: "",
    }))).toBe("")
  })

  test("右键必须落在当前高亮选区内", () => {
    const inside = {} as Node
    const container = {
      contains: (node: Node | null) => node === inside,
    }
    const currentSelection = selection({
      anchorNode: inside,
      focusNode: inside,
      rects: [{ bottom: 50, left: 20, right: 160, top: 30 }],
      text: "只处理这一段",
    })

    expect(readSelectionTextAtPointWithin(
      container,
      currentSelection,
      { x: 80, y: 40 },
    )).toBe("只处理这一段")
    expect(readSelectionTextAtPointWithin(
      container,
      currentSelection,
      { x: 180, y: 40 },
    )).toBe("")
  })

  test("引用多行内容并保留空行", () => {
    expect(formatAssistantQuote("第一行\n\n第二行")).toBe("> 第一行\n>\n> 第二行")
  })

  test("引用追加到现有草稿且保留原内容", () => {
    expect(appendAssistantQuote("我已有的问题", "第一行\n第二行")).toBe(
      "我已有的问题\n\n> 第一行\n> 第二行\n\n",
    )
    expect(appendAssistantQuote("", "内容")).toBe("> 内容\n\n")
  })
})
