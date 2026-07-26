type SelectionContainer = Pick<Node, "contains">

type TextSelection = Pick<
  Selection,
  "anchorNode" | "focusNode" | "getRangeAt" | "isCollapsed" | "rangeCount" | "toString"
>

type SelectionPoint = {
  x: number
  y: number
}

export function readSelectionTextWithin(
  container: SelectionContainer,
  selection: TextSelection | null,
): string {
  if (
    !selection
    || selection.isCollapsed
    || !selection.anchorNode
    || !selection.focusNode
    || !container.contains(selection.anchorNode)
    || !container.contains(selection.focusNode)
  ) {
    return ""
  }

  return selection.toString().trim()
}

export function readSelectionTextAtPointWithin(
  container: SelectionContainer,
  selection: TextSelection | null,
  point: SelectionPoint,
): string {
  const text = readSelectionTextWithin(container, selection)
  if (!text || !selection || selection.rangeCount < 1) return ""

  try {
    const rightClickHitsSelection = Array.from(selection.getRangeAt(0).getClientRects())
      .some((rect) => (
        point.x >= rect.left
        && point.x <= rect.right
        && point.y >= rect.top
        && point.y <= rect.bottom
      ))

    return rightClickHitsSelection ? text : ""
  } catch {
    return ""
  }
}

export function formatAssistantQuote(text: string): string {
  const normalized = text.replace(/\r\n?/g, "\n").trim()
  if (!normalized) return ""

  return normalized
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n")
}

export function appendAssistantQuote(draft: string, text: string): string {
  const quote = formatAssistantQuote(text)
  if (!quote) return draft

  const separator = !draft || draft.endsWith("\n\n")
    ? ""
    : draft.endsWith("\n")
      ? "\n"
      : "\n\n"

  return `${draft}${separator}${quote}\n\n`
}
