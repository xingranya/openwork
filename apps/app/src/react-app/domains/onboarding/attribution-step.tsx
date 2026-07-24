/** @jsxImportSource react */
import { useState } from "react";

import {
  PageBackground,
  PageDescription,
  PageHeader,
  PageTitle,
  PageTitlebarRegion,
} from "@/components/page";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  BotIcon,
  GithubIcon,
  MessageCircleIcon,
  SearchIcon,
  SkipForwardIcon,
  UsersIcon,
} from "lucide-react";

export type AttributionSource =
  | "ai_assistant"
  | "search"
  | "social"
  | "github"
  | "friend_or_colleague";

type AttributionOption = {
  source: AttributionSource;
  label: string;
  description: string;
  icon: typeof BotIcon;
};

const options: AttributionOption[] = [
  {
    source: "ai_assistant",
    label: "AI 助手",
    description: "ChatGPT、Claude、Gemini、Perplexity 等",
    icon: BotIcon,
  },
  {
    source: "search",
    label: "搜索引擎",
    description: "Google、Bing、DuckDuckGo 等",
    icon: SearchIcon,
  },
  {
    source: "social",
    label: "社交媒体",
    description: "X、LinkedIn、YouTube、Reddit 等",
    icon: MessageCircleIcon,
  },
  {
    source: "github",
    label: "GitHub 或开源社区",
    description: "仓库、收藏或项目清单",
    icon: GithubIcon,
  },
  {
    source: "friend_or_colleague",
    label: "朋友或同事",
    description: "由身边的人直接推荐",
    icon: UsersIcon,
  },
];

type AttributionStepProps = {
  onSubmit: (source: AttributionSource, aiPrompt?: string) => void;
  onSkip: () => void;
};

/**
 * Self-reported attribution survey shown once during onboarding.
 * When the user picks "AI assistant" we ask which prompt led them
 * here — first-party data on how answer engines describe OpenWork.
 */
export function AttributionStep({ onSubmit, onSkip }: AttributionStepProps) {
  const [aiSelected, setAiSelected] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <PageBackground />
      <PageTitlebarRegion />

      <div className="relative z-10 w-full max-w-md px-6">
        <PageHeader className="mb-8 text-center">
          <PageTitle>你是从哪里了解到 FoxWork 的？</PageTitle>
          <PageDescription>
            这个答案会帮助我们改进内部推广方式。
          </PageDescription>
        </PageHeader>

        {aiSelected ? (
          <div className="space-y-3">
            <div className="text-sm font-medium text-foreground">
              你当时向 AI 问了什么？
            </div>
            <Textarea
              autoFocus
              value={aiPrompt}
              onChange={(event) => setAiPrompt(event.target.value)}
              placeholder="例如：适合团队使用的 AI 工作软件"
              rows={3}
            />
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onSubmit("ai_assistant")}
              >
                跳过此项
              </Button>
              <Button size="sm" onClick={() => onSubmit("ai_assistant", aiPrompt)}>
                继续
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {options.map((option) => (
              <button
                key={option.source}
                type="button"
                className="flex w-full items-start gap-4 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-accent"
                onClick={() => {
                  if (option.source === "ai_assistant") {
                    setAiSelected(true);
                    return;
                  }
                  onSubmit(option.source);
                }}
              >
                <option.icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium text-foreground">
                    {option.label}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {option.description}
                  </div>
                </div>
              </button>
            ))}

            <div className="pt-1 text-center">
              <Button variant="ghost" size="sm" onClick={onSkip}>
                <SkipForwardIcon className="mr-1.5 size-3.5" />
                跳过
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
