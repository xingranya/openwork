/** @jsxImportSource react */
import { ArrowRight, KeyRound, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProviderIcon } from "../../design-system/provider-icon";
import {
  OPENWORK_MODELS_PROVIDER_ID,
  OPENWORK_MODELS_PROVIDER_NAME,
  type OpenWorkModelPreview,
} from "./openwork-models-promo";

type OpenWorkModelsStartupDialogProps = {
  open: boolean;
  isSignedIn: boolean;
  models: OpenWorkModelPreview[];
  onSubscribe: () => void;
  onContinueWithout: () => void;
};

export function OpenWorkModelsStartupDialog(props: OpenWorkModelsStartupDialogProps) {
  const featuredModels = props.models.slice(0, 3);

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onContinueWithout();
      }}
    >
      <DialogContent className="w-full max-w-lg overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <div className="mb-2 flex size-11 items-center justify-center rounded-2xl border border-blue-6 bg-blue-2 text-blue-11">
            <ProviderIcon providerId={OPENWORK_MODELS_PROVIDER_ID} providerName={OPENWORK_MODELS_PROVIDER_NAME} size={22} />
          </div>
          <DialogTitle>使用公司共享模型</DialogTitle>
          <DialogDescription>
            公司统一配置并管理工作区模型，员工无需自行保存 API 密钥；你也可以继续使用个人模型服务。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            {featuredModels.map((model) => (
              <div key={model.id} className="rounded-xl border border-dls-border bg-dls-surface px-3 py-2">
                <div className="truncate text-xs font-medium text-dls-text">{model.title}</div>
                <div className="mt-0.5 truncate text-[11px] text-dls-secondary">{model.subtitle}</div>
              </div>
            ))}
          </div>

          <div className="grid gap-2 text-xs text-dls-secondary sm:grid-cols-2">
            <div className="flex gap-2 rounded-xl bg-dls-hover/50 p-3">
              <Sparkles className="mt-0.5 size-3.5 shrink-0 text-blue-11" />
              <span>公司任务和共享流程使用统一的模型配置。</span>
            </div>
            <div className="flex gap-2 rounded-xl bg-dls-hover/50 p-3">
              <KeyRound className="mt-0.5 size-3.5 shrink-0 text-blue-11" />
              <span>无需自行配置 Anthropic、OpenAI 或 Google API 密钥。</span>
            </div>
          </div>

          <p className="text-xs text-dls-secondary">
            公司共享模型由管理员配置；也可以继续使用 OpenCode Zen 或个人模型服务。
          </p>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={props.onContinueWithout}>
            暂不使用公司模型
          </Button>
          <Button onClick={props.onSubscribe}>
            {props.isSignedIn ? "查看公司模型" : "登录并查看"}
            <ArrowRight className="ml-1.5 size-3.5" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
