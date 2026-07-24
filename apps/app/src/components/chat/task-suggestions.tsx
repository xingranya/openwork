"use client"

import {
  DescriptiveButton,
  DescriptiveButtonContent,
  DescriptiveButtonDescription,
  DescriptiveButtonIcon,
  DescriptiveButtonTitle,
} from "@/components/descriptive-button"
import { useMessageList } from "@/components/chat/message-list-provider"
import { cn } from "@/lib/utils"
import { useOrgRestrictions } from "@/react-app/domains/cloud/desktop-config-provider"
import { BoltIcon, CubeIcon, DocumentChartBarIcon, GlobeAltIcon, SparklesIcon } from "@heroicons/react/24/solid"

const CSV_PROMPT =
  "创建一份包含 20 行虚拟客户数据的 CSV 文件，字段包括姓名、邮箱、公司和收入，然后汇总这份数据。"

const BROWSER_PROMPT =
  "在浏览器中打开 craigslist.org，搜索正在出售的沙发，并列出前 5 条结果和价格。"

const ORGANIZATION_PROMPT_TITLES = ["公司任务 1", "公司任务 2", "公司任务 3"]

export function resolveOrganizationPromptCardContent(input: {
  prompt: string
  description?: string
  index: number
}) {
  const title = input.description?.trim()
  return {
    title: title || ORGANIZATION_PROMPT_TITLES[input.index] || "公司任务",
    description: input.prompt,
    selectionPrompt: input.prompt,
  }
}

interface TaskSuggestionsProps {
  className?: string
}

export function TaskSuggestions({ className }: TaskSuggestionsProps) {
  const { displaySuggestions, providerConnectedCount, dispatchAction, setPrompt } = useMessageList()
  const orgRestrictions = useOrgRestrictions()
  const organizationPrompts = orgRestrictions.onboardingPrompts
  const organizationPromptDescriptions = orgRestrictions.onboardingPromptDescriptions

  if (!displaySuggestions) {
    return null
  }

  const noProviders = providerConnectedCount === 0
  const hasOrganizationPrompts = organizationPrompts !== undefined

  return (
    <div className={cn("@container flex flex-col gap-4 pt-1", className)}>
      <p className="text-muted-foreground font-medium select-none">
        {noProviders
          ? "请先连接模型服务："
          : hasOrganizationPrompts
            ? "试试公司提供的任务："
            : "可以从这些任务开始："}
      </p>
      <div className="grid min-w-0 gap-2 @lg:grid-cols-2 @2xl:grid-cols-3">
        {noProviders ? (
          <DescriptiveButton
            orientation="vertical"
            className="border-blue-7/50 bg-blue-2/30 hover:bg-blue-3/40 @lg:col-span-2 @2xl:col-span-3"
            onClick={() =>
              dispatchAction({
                target: "settings",
                action: "open",
                section: "providers",
              })
            }
          >
            <DescriptiveButtonIcon>
              <BoltIcon className="size-6 text-blue-10" aria-hidden />
            </DescriptiveButtonIcon>
            <DescriptiveButtonContent>
              <DescriptiveButtonTitle>连接模型服务</DescriptiveButtonTitle>
              <DescriptiveButtonDescription>
                添加 Anthropic、OpenAI、Google 或其他模型服务的 API 密钥
              </DescriptiveButtonDescription>
            </DescriptiveButtonContent>
          </DescriptiveButton>
        ) : null}

        {hasOrganizationPrompts ? (
          organizationPrompts.map((prompt, index) => {
            const card = resolveOrganizationPromptCardContent({
              prompt,
              description: organizationPromptDescriptions?.[index],
              index,
            })
            return (
              <DescriptiveButton key={`${index}-${prompt}`} orientation="vertical" onClick={() => setPrompt(card.selectionPrompt)}>
                <DescriptiveButtonIcon>
                  <SparklesIcon className="size-6 text-purple-10" aria-hidden />
                </DescriptiveButtonIcon>
                <DescriptiveButtonContent>
                  <DescriptiveButtonTitle>{card.title}</DescriptiveButtonTitle>
                  <DescriptiveButtonDescription>{card.description}</DescriptiveButtonDescription>
                </DescriptiveButtonContent>
              </DescriptiveButton>
            )
          })
        ) : (
          <>
            <DescriptiveButton orientation="vertical" onClick={() => setPrompt(CSV_PROMPT)}>
              <DescriptiveButtonIcon>
                <DocumentChartBarIcon className="size-6 text-green-10" aria-hidden />
              </DescriptiveButtonIcon>
              <DescriptiveButtonContent>
                <DescriptiveButtonTitle>编辑 CSV</DescriptiveButtonTitle>
                <DescriptiveButtonDescription>创建一份示例表格</DescriptiveButtonDescription>
              </DescriptiveButtonContent>
            </DescriptiveButton>

            <DescriptiveButton orientation="vertical" onClick={() => setPrompt(BROWSER_PROMPT)}>
              <DescriptiveButtonIcon>
                <GlobeAltIcon className="size-6 text-blue-10" aria-hidden />
              </DescriptiveButtonIcon>
              <DescriptiveButtonContent>
                <DescriptiveButtonTitle>浏览网页</DescriptiveButtonTitle>
                <DescriptiveButtonDescription>在 Craigslist 搜索沙发</DescriptiveButtonDescription>
              </DescriptiveButtonContent>
            </DescriptiveButton>

            <DescriptiveButton
              orientation="vertical"
              onClick={() =>
                dispatchAction({
                  target: "settings",
                  action: "open",
                  section: "mcps",
                })
              }
            >
              <DescriptiveButtonIcon>
                <CubeIcon className="size-6 text-amber-10" aria-hidden />
              </DescriptiveButtonIcon>
              <DescriptiveButtonContent>
                <DescriptiveButtonTitle>连接扩展</DescriptiveButtonTitle>
                <DescriptiveButtonDescription>添加 MCP 和其他集成</DescriptiveButtonDescription>
              </DescriptiveButtonContent>
            </DescriptiveButton>
          </>
        )}
      </div>
    </div>
  )
}
