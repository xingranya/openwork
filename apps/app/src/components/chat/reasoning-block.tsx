"use client"

import { useEffect, useRef, useState } from "react"
import { BrainCircuit, ChevronDown } from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { MessageContent } from "@/components/ui/message"
import { cn } from "@/lib/utils"

type ReasoningBlockProps = {
  text: string
  isStreaming: boolean
  className?: string
}

/**
 * 使用上游折叠容器承载思考过程。流式阶段自动展开，完成后自动收起，
 * 用户仍可随时手动切换，避免仅靠文字深浅区分思考内容和最终回答。
 */
export function ReasoningBlock({ text, isStreaming, className }: ReasoningBlockProps) {
  const [open, setOpen] = useState(isStreaming)
  const wasStreaming = useRef(isStreaming)

  useEffect(() => {
    if (isStreaming && !wasStreaming.current) setOpen(true)
    if (!isStreaming && wasStreaming.current) setOpen(false)
    wasStreaming.current = isStreaming
  }, [isStreaming])

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn(
        "not-prose w-full overflow-hidden rounded-lg border border-blue-7/70 bg-blue-2/55",
        className,
      )}
      data-reasoning-block=""
    >
      <CollapsibleTrigger className="group flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2 text-blue-12 transition-colors hover:bg-blue-3/70">
        <span className="flex min-w-0 items-center gap-2 text-xs font-medium">
          <BrainCircuit className="size-4 shrink-0 text-blue-11" aria-hidden="true" />
          <span>{isStreaming ? "正在深入思考" : "深度思考"}</span>
          <span className={cn("text-[11px] font-normal text-blue-11", isStreaming && "animate-pulse")}>
            {isStreaming ? "进行中" : "已完成"}
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-blue-11 transition-transform duration-150 group-data-panel-open:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden border-t border-blue-7/60 transition-[height] duration-150 ease-out data-starting-style:h-0 data-ending-style:h-0 [&[hidden]:not([hidden='until-found'])]:hidden">
        <MessageContent
          markdown
          className="prose w-full min-w-0 max-w-none rounded-none bg-transparent px-3 py-3 text-[13px] leading-6 text-blue-12/90"
        >
          {text}
        </MessageContent>
      </CollapsibleContent>
    </Collapsible>
  )
}
