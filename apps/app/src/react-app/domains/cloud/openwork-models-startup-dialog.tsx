/** @jsxImportSource react */
import { ArrowRight, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

const HIGHLIGHTS = [
  "公司统一配置并维护可用模型",
  "员工无需自行保存 Anthropic、OpenAI 或 Google API 密钥",
  "本地工作区仍可继续使用个人模型服务",
];

/**
 * 首次进入时介绍公司共享模型，并保留继续使用个人模型服务的选择。
 */
export function OpenWorkModelsStartupDialog(props: OpenWorkModelsStartupDialogProps) {
  const featuredModels = props.models.slice(0, 3);

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onContinueWithout();
      }}
    >
      <DialogContent className="w-full max-w-md gap-0 overflow-hidden rounded-3xl p-0 sm:max-w-md">
        <div className="px-8 pb-8 pt-9">
          <DialogHeader className="space-y-0">
            <div className="flex items-center gap-2">
              <ProviderIcon
                providerId={OPENWORK_MODELS_PROVIDER_ID}
                providerName={OPENWORK_MODELS_PROVIDER_NAME}
                size={18}
              />
              <span className="text-[13px] font-medium text-muted-foreground">
                {OPENWORK_MODELS_PROVIDER_NAME}
              </span>
            </div>
            <DialogTitle className="mt-5 text-[24px] font-semibold leading-[30px] tracking-[-0.02em] text-foreground">
              直接使用公司共享模型
            </DialogTitle>
            <DialogDescription className="mt-2 text-[14px] leading-[21px] text-muted-foreground">
              登录公司账号后，所有获授权工作区都会自动加载可用模型。
            </DialogDescription>
          </DialogHeader>

          <div className="mt-6 overflow-hidden rounded-2xl border border-border">
            {featuredModels.map((model, index) => (
              <div
                key={model.id}
                className={
                  index > 0
                    ? "flex items-baseline justify-between gap-3 border-t border-border px-4 py-2.5"
                    : "flex items-baseline justify-between gap-3 px-4 py-2.5"
                }
              >
                <span className="truncate text-[13px] font-medium text-foreground">
                  {model.title}
                </span>
                <span className="shrink-0 text-[12px] text-muted-foreground">
                  {model.subtitle}
                </span>
              </div>
            ))}
          </div>

          <ul className="mt-5 space-y-2">
            {HIGHLIGHTS.map((highlight) => (
              <li key={highlight} className="flex items-start gap-2.5 text-[13px] leading-[19px] text-muted-foreground">
                <Check className="mt-0.5 size-3.5 shrink-0 text-foreground" />
                <span>{highlight}</span>
              </li>
            ))}
          </ul>

          <div className="mt-7 space-y-2">
            <Button className="h-11 w-full text-[14px] font-semibold" onClick={props.onSubscribe}>
              {props.isSignedIn ? "查看公司模型" : "登录并查看公司模型"}
              <ArrowRight data-icon="inline-end" />
            </Button>
            <Button
              variant="ghost"
              className="h-10 w-full text-[13px] font-normal text-muted-foreground hover:text-foreground"
              onClick={props.onContinueWithout}
            >
              继续使用个人模型服务
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
