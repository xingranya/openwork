/** @jsxImportSource react */
import {
  ArrowRight,
  ArrowUpRight,
  Cable,
  Cloud,
  Cog,
  FolderLock,
  LifeBuoy,
  MessageCircle,
  Paintbrush,
  Puzzle,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wrench,
} from "lucide-react";

import { t } from "../../../../i18n";
import type { SettingsTab } from "../../../../app/types";
import { Button } from "@/components/ui/button";

export type GeneralSettingsViewProps = {
  onNavigateTab: (tab: SettingsTab) => void;
  developerMode: boolean;
  onSendFeedback: () => void;
  onReportIssue: () => void;
  showFeedback?: boolean;
  showReportIssue?: boolean;
};

type SettingsCardDefinition = { tab: SettingsTab; icon: typeof Sparkles } & (
  | { title: string; desc: string }
  | { titleKey: string; descKey: string }
);

const workspaceCards: SettingsCardDefinition[] = [
  { tab: "preferences", icon: Cog, title: "偏好设置", desc: "设置默认模型、推理方式和上下文整理。" },
  { tab: "permissions", icon: FolderLock, title: "权限", desc: "管理已授权文件夹和文件访问。" },
  { tab: "extensions", icon: Puzzle, titleKey: "settings.tab_extensions", descKey: "settings.tab_description_extensions" },
  { tab: "advanced", icon: Wrench, title: "高级", desc: "管理运行时、引擎和开发者选项。" },
];

const globalCards: SettingsCardDefinition[] = [
  { tab: "ai", icon: Sparkles, title: "AI 模型服务", desc: "连接可提供 AI 模型的服务。" },
  { tab: "cloud-account", icon: Cloud, title: "公司账号", desc: "管理 FoxWork 公司账号和公司信息。" },
  { tab: "connect", icon: Cable, titleKey: "settings.tab_connect", descKey: "settings.tab_description_connect" },
  { tab: "appearance", icon: Paintbrush, title: "外观", desc: "调整主题、字号和界面显示。" },
  { tab: "environment", icon: Terminal, title: "环境变量", desc: "管理环境变量和本机路径。" },
  { tab: "updates", icon: RefreshCcw, title: "更新", desc: "查看应用版本和更新渠道。" },
  { tab: "recovery", icon: ShieldCheck, title: "恢复", desc: "重置入门状态或清理应用数据。" },
];

function cardTitle(card: SettingsCardDefinition) {
  return "titleKey" in card ? t(card.titleKey) : card.title;
}

function cardDescription(card: SettingsCardDefinition) {
  return "descKey" in card ? t(card.descKey) : card.desc;
}

function SettingsCard(props: {
  icon: typeof Sparkles;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="flex items-center gap-3 rounded-2xl border border-dls-border bg-dls-surface p-4 text-left transition-colors hover:bg-dls-hover"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-dls-border bg-dls-hover">
        <props.icon size={16} className="text-dls-secondary" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-dls-text">{props.title}</div>
        <div className="text-[11px] text-dls-secondary">{props.desc}</div>
      </div>
      <ArrowRight size={14} className="shrink-0 text-dls-secondary" />
    </button>
  );
}

export function GeneralSettingsView(props: GeneralSettingsViewProps) {
  return (
    <div className="w-full max-w-3xl space-y-8">
      {/* 工作区设置 */}
      <div className="space-y-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-dls-secondary">
          工作区
        </div>
        <div className="grid grid-cols-2 gap-2">
          {workspaceCards.map((card) => (
            <SettingsCard
              key={card.tab}
              icon={card.icon}
              title={cardTitle(card)}
              desc={cardDescription(card)}
              onClick={() => props.onNavigateTab(card.tab)}
            />
          ))}
        </div>
      </div>

      {/* 全局设置 */}
      <div className="space-y-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-dls-secondary">
          全局
        </div>
        <div className="grid grid-cols-2 gap-2">
          {globalCards.map((card) => (
            <SettingsCard
              key={card.tab}
              icon={card.icon}
              title={cardTitle(card)}
              desc={cardDescription(card)}
              onClick={() => props.onNavigateTab(card.tab)}
            />
          ))}
        </div>
      </div>

      {/* 帮助与反馈 */}
      <div className="space-y-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-dls-secondary">
          帮助
        </div>
        <div className="rounded-2xl border border-dls-border bg-dls-surface p-4">
          <div className="space-y-3">
            <div>
              <div className="flex items-center gap-2">
                <LifeBuoy size={14} className="text-dls-secondary" />
                <div className="text-[13px] font-medium text-dls-text">{t("settings.feedback_title")}</div>
              </div>
              <div className="mt-1 max-w-[58ch] text-[11px] text-dls-secondary">{t("settings.feedback_desc")}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {props.showFeedback !== false ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={props.onSendFeedback}
                >
                  <MessageCircle size={12} />
                  {t("settings.send_feedback")}
                  <ArrowUpRight size={11} />
                </Button>
              ) : null}
              {props.showReportIssue !== false ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={props.onReportIssue}
                >
                  {t("settings.report_issue")}
                  <ArrowUpRight size={11} />
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
