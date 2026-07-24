/** @jsxImportSource react */
import {
  Page,
  PageBackground,
  PageDescription,
  PageHeader,
  PageTitle,
  PageTitlebarRegion,
} from "@/components/page";
import { Button } from "@/components/ui/button";
import { KeyRoundIcon, SkipForwardIcon, SparklesIcon } from "lucide-react";

type ProviderSelectionStepProps = {
  showOpenWorkModels?: boolean;
  onOpenWorkModels: () => void;
  onBringYourOwn: () => void;
  onSkip: () => void;
};

export function ProviderSelectionStep({
  showOpenWorkModels = true,
  onOpenWorkModels,
  onBringYourOwn,
  onSkip,
}: ProviderSelectionStepProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <PageBackground />
      <PageTitlebarRegion />

      <div className="relative z-10 w-full max-w-md px-6">
        <PageHeader className="mb-8 text-center">
          <PageTitle>为第一个任务选择模型</PageTitle>
          <PageDescription>
            连接模型后，即可在对话中开始处理实际工作。
          </PageDescription>
        </PageHeader>

        <div className="space-y-3">
          {showOpenWorkModels ? (
            <button
              type="button"
              className="flex w-full items-start gap-4 rounded-xl border border-blue-7/50 bg-blue-2/30 p-4 text-left transition-colors hover:bg-blue-3/40"
              onClick={onOpenWorkModels}
            >
              <SparklesIcon className="mt-0.5 size-5 shrink-0 text-blue-10" />
              <div>
                <div className="text-sm font-medium text-foreground">
                  使用公司共享模型
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  使用公司统一配置的模型，无需管理 API 密钥。
                </div>
              </div>
            </button>
          ) : null}

          <button
            type="button"
            className="flex w-full items-start gap-4 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-accent"
            onClick={onBringYourOwn}
          >
            <KeyRoundIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium text-foreground">
                使用个人 API 密钥
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                连接 OpenAI、Anthropic、Google 或其他模型服务。
              </div>
            </div>
          </button>

          <div className="pt-1 text-center">
            <Button variant="ghost" size="sm" onClick={onSkip}>
              <SkipForwardIcon className="mr-1.5 size-3.5" />
              跳过，使用免费模型
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
