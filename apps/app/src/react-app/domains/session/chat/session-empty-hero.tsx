/** @jsxImportSource react */
import { useState } from "react";
import { Zap } from "lucide-react";

import { resolveOrganizationPromptCardContent } from "@/components/chat/task-suggestions";
import { useCheckDesktopRestriction, useOrgRestrictions } from "@/react-app/domains/cloud/desktop-config-provider";
import { NewTaskComposer, type NewTaskComposerContext } from "./new-task-composer";

type HeroSuggestion = {
  title: string;
  description: string;
  prompt: string;
};

const DEFAULT_SUGGESTIONS: HeroSuggestion[] = [
  {
    title: "总结本周工作",
    description: "从邮件和日历中整理重点。",
    prompt: "请总结我本周的工作：从已连接的邮件和日历中提取重点，简要说明发生了什么，以及接下来需要我关注什么。",
  },
  {
    title: "整理电子表格",
    description: "放入 CSV 文件并说明你想要的结果。",
    prompt: "请创建一个包含 20 行示例客户数据的 CSV 文件，字段包括姓名、邮箱、公司和收入，然后汇总这份数据。",
  },
  {
    title: "起草文档",
    description: "根据几个要点生成报告、邮件或简报。",
    prompt: "请起草一页项目简报。先询问我需要提供哪些要点，再把这些内容整理成清晰、结构完整的文档。",
  },
  {
    title: "自动处理网页任务",
    description: "使用内置浏览器完成重复操作。",
    prompt: "请打开浏览器，根据我的要求完成一项重复网页操作。开始前先询问目标网站和具体步骤。",
  },
];

export type SessionEmptyHeroProps = {
  providerCount: number;
  /** Disable submission while a default workspace is being prepared. */
  busy?: boolean;
  /** Called with the task prompt; the caller creates the session (and workspace if needed). */
  onRunTask: (prompt: string) => void;
  onOpenProviderAuth?: () => void;
  /** Workspace-scoped wiring for the full composer (skills, agents, models). */
  composer?: NewTaskComposerContext | null;
};

/**
 * Paper "first chat" empty state: the real session composer front and
 * center with suggestion cards below. Suggestions come from desktop
 * policies (organization onboarding prompts) when configured, with
 * built-in defaults otherwise.
 */
export function SessionEmptyHero(props: SessionEmptyHeroProps) {
  const [prompt, setPrompt] = useState("");
  const orgRestrictions = useOrgRestrictions();
  const checkDesktopRestriction = useCheckDesktopRestriction();
  const canAddProviders = !checkDesktopRestriction({ restriction: "allowCustomProviders" });

  const organizationPrompts = orgRestrictions.onboardingPrompts;
  const suggestions: HeroSuggestion[] = organizationPrompts !== undefined
    ? organizationPrompts.map((orgPrompt, index) => {
      const card = resolveOrganizationPromptCardContent({
        prompt: orgPrompt,
        description: orgRestrictions.onboardingPromptDescriptions?.[index],
        index,
      });
      return { title: card.title, description: card.description, prompt: card.selectionPrompt };
    })
    : DEFAULT_SUGGESTIONS;

  const submit = () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt || props.busy) return;
    props.onRunTask(trimmedPrompt);
  };

  const fillPrompt = (value: string) => {
    setPrompt(value);
    window.dispatchEvent(new Event("openwork:focusPrompt"));
  };

  return (
    <div className="mx-auto w-full max-w-[640px] space-y-6 px-6">
      <div className="space-y-1.5 text-center">
        <h2 className="text-[24px] font-semibold leading-[30px] tracking-[-0.02em] text-foreground">
          你想完成什么工作？
        </h2>
        <p className="text-[13px] text-muted-foreground">直接用自然语言描述即可</p>
      </div>

      <NewTaskComposer
        draft={prompt}
        onDraftChange={setPrompt}
        onRunTask={submit}
        busy={props.busy ?? false}
        context={props.composer ?? null}
      />

      {canAddProviders && props.providerCount === 0 && props.onOpenProviderAuth ? (
        <button
          type="button"
          className="flex w-full items-start gap-3 rounded-xl border border-blue-7/50 bg-blue-2/40 p-3.5 text-left transition-colors hover:bg-blue-3/50"
          onClick={props.onOpenProviderAuth}
        >
          <Zap className="mt-0.5 size-4 shrink-0 text-blue-10" />
          <div>
            <div className="text-[13px] font-medium text-foreground">连接模型服务</div>
            <div className="mt-0.5 text-[12px] text-muted-foreground">
              添加常用模型服务或自定义兼容协议的 API 密钥后即可运行任务。
            </div>
          </div>
        </button>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.title}
            type="button"
            className="rounded-xl border border-border bg-background p-3.5 text-left transition-colors hover:bg-accent"
            onClick={() => fillPrompt(suggestion.prompt)}
          >
            <div className="truncate text-[13px] font-medium text-foreground">{suggestion.title}</div>
            <div className="mt-0.5 line-clamp-2 text-[12px] leading-[17px] text-muted-foreground">
              {suggestion.description}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
