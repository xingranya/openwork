/** @jsxImportSource react */
import { useEffect, type ReactNode } from "react";
import { ShareIcon, UserGroupIcon } from "@heroicons/react/24/solid";
import { PaperGrainGradient } from "@openwork/ui/react/paper-grain-gradient";

import { t } from "../../../i18n";
import { useBootState } from "../../shell/boot-state";
import {
  Page,
  PageBackground,
  PageDescription,
  PageHeader,
  PageTitle,
  PageTitlebarRegion,
} from "@/components/page";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollAreaViewport } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { OrganizationServerAffordance } from "../settings/cloud/organization-server-affordance";
import { toChineseUserMessage } from "../../../app/lib/user-facing-error";

interface BrandIconProps {
  slug: string;
  className?: string;
}

function BrandIcon({ slug, className }: BrandIconProps) {
  return (
    <img
      className={cn("block size-4", className)}
      src={`https://cdn.simpleicons.org/${slug}/_/777b84`}
      alt=""
      loading="lazy"
    />
  );
}

const capabilities = [
  {
    slug: "googlesheets",
    title: "处理表格",
    desc: "创建、清理和转换 CSV、Excel 文件。",
  },
  {
    slug: "semanticweb",
    title: "操作浏览器",
    desc: "自动完成重复的网页操作。",
  },
  {
    slug: "apple",
    title: "整理文件",
    desc: "读取、写入和管理文件与文件夹。",
  },
  {
    slug: "zapier",
    title: "自动执行任务",
    desc: "通过技能和命令复用工作流程。",
  },
  {
    slug: "medium",
    title: "生成内容",
    desc: "起草文档、邮件和报告。",
  },
  {
    slug: "stripe",
    title: "连接业务系统",
    desc: "通过 MCP 使用公司服务和工具。",
  },
];

function ShowcasePanel() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold tracking-[-0.01em] text-foreground">
          你的电脑，
          <br />
          交给 AI 协助
        </h2>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {capabilities.map((cap) => (
          <div
            key={cap.title}
            className="flex flex-col gap-2.5 rounded-xl border border-border p-3"
          >
            <BrandIcon className="size-4" slug={cap.slug} />
            <div className="text-sm font-medium leading-tight text-foreground">
              {cap.title}
            </div>
            <div className="text-xs leading-snug text-muted-foreground">
              {cap.desc}
            </div>
          </div>
        ))}
        <div className="flex flex-col items-start gap-2.5 rounded-xl border border-border p-3">
            <ShareIcon className="size-4 shrink-0 text-muted-foreground" />
            <div className="flex flex-col gap-1.5">
              <div className="text-sm font-medium text-foreground">
              公司能力
              </div>
              <div className="text-xs leading-snug text-muted-foreground">
              使用公司批准的技能、MCP 和插件。
              </div>
            </div>
          </div>
        <div className="flex flex-col items-start gap-2.5 rounded-xl border border-border p-3">
          <UserGroupIcon className="size-4 shrink-0 text-muted-foreground" />
          <div className="flex flex-col gap-1.5">
            <div className="text-sm font-medium text-foreground">
              团队协作
            </div>
            <div className="text-xs leading-snug text-muted-foreground">
              统一管理工作区、模型和权限。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

type WelcomePageProps = {
  onGetStarted: () => void;
  getStartedLabel?: string;
  busy?: boolean;
  error?: string | null;
  manualFolder?: string;
  onManualFolderChange?: (value: string) => void;
  onUseManualFolder?: () => void;
  showManualFolder?: boolean;
  getStartedDisabled?: boolean;
  companyConfigured: boolean;
  companySignedIn: boolean;
  organizationServerBusy: boolean;
  organizationServerError: string | null;
  organizationServerUrl: string;
  onOrganizationServerSave: (url: string) => Promise<boolean>;
};

type OnboardingStepProps = {
  number: string;
  title: string;
  children: ReactNode;
};

function OnboardingStep({ number, title, children }: OnboardingStepProps) {
  return (
    <div className="flex items-start gap-4">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground/5 text-sm font-medium text-foreground">
        {number}
      </div>
      <div className="flex flex-col gap-0.5 pt-1">
        <div className="text-base font-medium text-foreground">{title}</div>
        <div className="text-sm text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

export function WelcomePage({
  onGetStarted,
  getStartedLabel,
  busy,
  error,
  manualFolder,
  onManualFolderChange,
  onUseManualFolder,
  showManualFolder,
  getStartedDisabled,
  companyConfigured,
  companySignedIn,
  organizationServerBusy,
  organizationServerError,
  organizationServerUrl,
  onOrganizationServerSave,
}: WelcomePageProps) {
  const { markRouteReady } = useBootState();

  // 首次引导是一个完整页面，渲染完成后立即释放启动遮罩，避免遮罩继续吞掉点击。
  useEffect(() => {
    markRouteReady();
  }, [markRouteReady]);

  return (
    <Page className="min-h-screen">
      <PageBackground />

      <PageTitlebarRegion />

      <ScrollArea className="relative z-10">
        <ScrollAreaViewport>
          <div className="flex min-h-screen">
            {/* ---- Left: onboarding steps ---- */}
            <div className="flex w-full flex-col items-center justify-center px-8 py-16 lg:w-[45%] lg:px-12">
              <div className="flex w-full max-w-md flex-col gap-10">
                {/* Header */}
                <PageHeader className="text-left">
                  <PageTitle>{t("welcome.title")}</PageTitle>
                  <PageDescription>{t("welcome.subtitle")}</PageDescription>
                </PageHeader>

                {/* Steps */}
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <h2 className="text-lg font-semibold tracking-tight text-foreground">
                      开始使用
                    </h2>
                  </div>
                  <OnboardingStep number="1" title="连接公司">
                    {companyConfigured
                      ? "公司服务器已经连接。"
                      : "填写管理员提供的公司服务器地址，SeeWayWork 会先检查服务是否可用。"}
                  </OnboardingStep>
                  <OnboardingStep number="2" title="登录账号">
                    {companySignedIn
                      ? "公司账号已经登录，模型、工具和技能会按权限自动加载。"
                      : "连接成功后使用公司账号登录，不需要手动填写访问令牌。"}
                  </OnboardingStep>
                  <OnboardingStep number="3" title="开始工作">
                    登录后可以使用公司远程工作区，也可以继续添加本地工作区。
                  </OnboardingStep>
                </div>

                <div className="space-y-2">
                  <OrganizationServerAffordance
                    busy={organizationServerBusy}
                    error={organizationServerError
                      ? toChineseUserMessage(organizationServerError, "无法连接公司服务器，请检查地址后重试。")
                      : null}
                    onSave={onOrganizationServerSave}
                    required={!companyConfigured}
                    url={organizationServerUrl}
                  />
                  <Button
                    size="lg"
                    className="w-full"
                    onClick={onGetStarted}
                    disabled={busy || getStartedDisabled}
                  >
                    {busy ? t("welcome.creating_workspace") : (getStartedLabel || t("welcome.get_started"))}
                  </Button>
                  {error ? (
                    <p className="text-center text-xs text-destructive">
                      {toChineseUserMessage(error, "无法创建工作区，请稍后重试。")}
                    </p>
                  ) : null}
                  {showManualFolder ? (
                    <div className="rounded-xl border border-dashed border-border p-3">
                      <label className="grid gap-2 text-xs font-medium text-muted-foreground">
                        Daytona 文件夹路径
                        <input
                          className="h-9 rounded-md border border-input bg-background px-3 text-sm font-normal text-foreground outline-none focus:border-ring"
                          value={manualFolder ?? ""}
                          onChange={(event) => onManualFolderChange?.(event.target.value)}
                          placeholder="/workspace/my-project"
                        />
                      </label>
                      <Button
                        className="mt-2 w-full"
                        variant="outline"
                        onClick={onUseManualFolder}
                        disabled={busy || !manualFolder?.trim()}
                      >
                        使用此文件夹
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            {/* ---- Right: shader outer card > white inner card ---- */}
            <div className="hidden lg:flex lg:w-[55%] lg:items-center lg:justify-center lg:p-6">
              <div className="relative w-full max-w-xl overflow-hidden rounded-3xl">
                {/* Shader background */}
                <div className="absolute inset-0 z-0">
                  <PaperGrainGradient
                    className="size-full bg-white"
                    speed={0}
                    scale={1}
                    rotation={0}
                    offsetX={0}
                    offsetY={0}
                    softness={0.5}
                    intensity={0.5}
                    noise={0.25}
                    shape="corners"
                    frame={37706.748}
                    colors={["#0E33D9", "#FF7E2E", "#FFE340", "#000000"]}
                    colorBack="#00000000"
                  />
                </div>

                {/* Inner white card */}
                <div className="relative z-10 m-3 rounded-2xl bg-background p-7">
                  <ShowcasePanel />
                </div>
              </div>
            </div>
          </div>
        </ScrollAreaViewport>
      </ScrollArea>
    </Page>
  );
}
