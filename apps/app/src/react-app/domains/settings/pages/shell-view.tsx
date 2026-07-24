/** @jsxImportSource react */
import { AlertTriangle, Info, Lock, RotateCcw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import {
  LayoutSection,
  LayoutSectionDescription,
  LayoutSectionHeader,
  LayoutSectionItem,
  LayoutSectionItemDescription,
  LayoutSectionItemHeader,
  LayoutSectionItemHeaderActions,
  LayoutSectionItemTitle,
  LayoutSectionTitle,
  LayoutStack,
} from "../settings-layout";
import { useShellConfig, DEFAULT_SHELL_CONFIG, type ShellConfig } from "../../../shell/shell-config";
import { useUiStateStore } from "../../../shell/ui-state-store";
import { useBrandAppName } from "../../cloud/brand-theme";

/* ------------------------------------------------------------------ */
/*  交互式界面预览                                                     */
/* ------------------------------------------------------------------ */

function ShellWireframe({ config }: { config: ShellConfig }) {
  const cx = config.sidebar ? 102 : 1;
  const cw = config.sidebar ? 297 : 398;

  return (
    <div className="mx-auto mb-2 w-full max-w-md">
      <svg viewBox="0 0 400 260" className="w-full" aria-hidden="true">
        {/* 窗口 */}
        <rect x="0" y="0" width="400" height="260" rx="10" fill="var(--dls-surface)" stroke="var(--dls-border)" strokeWidth="1" />

        {/* 标题栏 */}
        <rect x="0.5" y="0.5" width="399" height="30" rx="10" fill="var(--dls-hover)" />
        <rect x="0.5" y="18" width="399" height="13" fill="var(--dls-hover)" />
        <line x1="0" y1="30" x2="400" y2="30" stroke="var(--dls-border)" strokeWidth="0.5" />
        <circle cx="14" cy="15" r="3.5" fill="#ff5f57" opacity="0.6" />
        <circle cx="26" cy="15" r="3.5" fill="#febc2e" opacity="0.6" />
        <circle cx="38" cy="15" r="3.5" fill="#28c840" opacity="0.6" />
        <text x="200" y="19" textAnchor="middle" fontSize="8" fontWeight="600" fill="var(--dls-text-secondary)" opacity="0.7">
          {config.appName}
        </text>

        {/* 侧边栏 */}
        <g className="transition-all duration-300" style={{ opacity: config.sidebar ? 1 : 0.1 }}>
          <rect x="0.5" y="31" width="100" height="195" fill="var(--dls-hover)" />
          <line x1="101" y1="31" x2="101" y2="226" stroke="var(--dls-border)" strokeWidth="0.5" />

          {/* 工作区标题 */}
          <circle cx="16" cy="44" r="5" fill="var(--dls-accent)" opacity="0.3" />
          <text x="26" y="47" fontSize="6.5" fontWeight="600" fill="var(--dls-text-primary)" opacity="0.7">工作区</text>

          {/* 会话列表 */}
          <rect x="8" y="58" width="85" height="16" rx="4" fill="var(--dls-surface)" opacity="0.6" />
          <text x="14" y="68" fontSize="5.5" fill="var(--dls-text-primary)" opacity="0.5">会议简报</text>

          <rect x="8" y="78" width="85" height="16" rx="4" fill="transparent" />
          <text x="14" y="88" fontSize="5.5" fill="var(--dls-text-secondary)" opacity="0.4">合同审阅</text>

          <rect x="8" y="98" width="85" height="16" rx="4" fill="transparent" />
          <text x="14" y="108" fontSize="5.5" fill="var(--dls-text-secondary)" opacity="0.4">客户跟进</text>

          {/* 新建会话 */}
          <text x="14" y="130" fontSize="5" fill="var(--dls-text-secondary)" opacity="0.3">+ 新建会话</text>

          {/* 添加工作区 */}
          {config.addWorkspace ? (
            <g>
              <rect x="8" y="200" width="85" height="16" rx="8" fill="var(--dls-accent)" opacity="0.15" />
              <text x="50" y="210" textAnchor="middle" fontSize="5.5" fontWeight="500" fill="var(--dls-accent)" opacity="0.6">添加工作区</text>
            </g>
          ) : null}
        </g>

        {/* 主内容区 */}
        <rect x={cx} y="31" width={cw} height="195" fill="var(--dls-surface)" />

        {/* 快捷任务 */}
        <g className="transition-all duration-300" style={{ opacity: config.starterCards ? 1 : 0 }}>
          {[
            { x: cx + 12, icon: "\u{1F4CA}", label: "编辑表格" },
            { x: cx + 12 + (cw - 36) / 3 + 6, icon: "\u{1F310}", label: "浏览网页" },
            { x: cx + 12 + ((cw - 36) / 3 + 6) * 2, icon: "\u{1F50C}", label: "扩展" },
          ].map((card, i) => {
            const w = (cw - 36) / 3;
            return (
              <g key={i}>
                <rect x={card.x} y="120" width={w} height="34" rx="5" fill="none" stroke="var(--dls-border)" strokeWidth="0.5" />
                <text x={card.x + 6} y="133" fontSize="7">{card.icon}</text>
                <text x={card.x + 16} y="133" fontSize="5" fontWeight="500" fill="var(--dls-text-primary)" opacity="0.5">{card.label}</text>
                <rect x={card.x + 6} y="140" width={w - 16} height="3" rx="1.5" fill="var(--dls-text-secondary)" opacity="0.06" />
              </g>
            );
          })}
        </g>

        {/* 输入框 */}
        <rect x={cx + 10} y="196" width={cw - 20} height="22" rx="11" fill="none" stroke="var(--dls-border)" strokeWidth="0.75" />
        <text x={cx + 24} y="210" fontSize="5.5" fill="var(--dls-text-secondary)" opacity="0.3">输入任务…</text>
        {/* 发送按钮 */}
        <rect x={cx + cw - 42} y="200" width="24" height="14" rx="7" fill="var(--dls-accent)" opacity="0.2" />
        <text x={cx + cw - 30} y="210" textAnchor="middle" fontSize="4.5" fontWeight="500" fill="var(--dls-accent)" opacity="0.5">执行</text>

        {/* 模型选择 */}
        {config.modelPicker ? (
          <text x={cx + 14} y="174" fontSize="4.5" fill="var(--dls-text-secondary)" opacity="0.3">默认模型</text>
        ) : null}

        {/* 状态栏 */}
        <g className="transition-all duration-300" style={{ opacity: config.statusBar ? 1 : 0.08 }}>
          <line x1="0" y1="226" x2="400" y2="226" stroke="var(--dls-border)" strokeWidth="0.5" />
          <rect x="0.5" y="226" width="399" height="33.5" rx="0" fill="var(--dls-hover)" />
          {/* 底部圆角 */}
          <rect x="0.5" y="250" width="399" height="10" rx="10" fill="var(--dls-hover)" />

          {/* 状态点和文字 */}
          <circle cx="14" cy="242" r="2.5" fill="#28c840" opacity="0.5" />
          <text x="22" y="245" fontSize="5.5" fontWeight="500" fill="var(--dls-text-primary)" opacity="0.5">就绪</text>

          {/* 公司服务登录 */}
          {config.cloudSignin ? (
            <g>
              <rect x="280" y="236" width="32" height="12" rx="6" fill="var(--dls-accent)" opacity="0.2" />
              <text x="296" y="244" textAnchor="middle" fontSize="4.5" fontWeight="500" fill="var(--dls-accent)" opacity="0.5">登录</text>
            </g>
          ) : null}

          {/* 文档 */}
          {config.docsButton ? (
            <text x="326" y="244" fontSize="5" fill="var(--dls-text-secondary)" opacity="0.35">文档</text>
          ) : null}

          {/* 反馈 */}
          {config.feedbackButton ? (
            <text x="350" y="244" fontSize="5" fill="var(--dls-text-secondary)" opacity="0.35">反馈</text>
          ) : null}

          {/* 设置按钮 */}
          <text x="388" y="245" textAnchor="middle" fontSize="7" fill="var(--dls-text-secondary)" opacity="0.3">{"\u2699"}</text>
        </g>

        {/* 浏览器面板 */}
        <g className="transition-all duration-300" style={{ opacity: config.browser ? 1 : 0 }}>
          <line x1={cx + cw - 120} y1="31" x2={cx + cw - 120} y2="226" stroke="var(--dls-border)" strokeWidth="0.5" />
          <rect x={cx + cw - 120} y="31" width="120" height="195" fill="var(--dls-hover)" opacity="0.5" />
          {/* 浏览器边框 */}
          <rect x={cx + cw - 115} y="36" width="110" height="14" rx="4" fill="var(--dls-surface)" />
          <circle cx={cx + cw - 108} cy="43" r="2" fill="var(--dls-text-secondary)" opacity="0.2" />
          <circle cx={cx + cw - 100} cy="43" r="2" fill="var(--dls-text-secondary)" opacity="0.2" />
          <rect x={cx + cw - 92} y="40" width="60" height="6" rx="3" fill="var(--dls-text-secondary)" opacity="0.08" />
          {/* 页面内容占位 */}
          <rect x={cx + cw - 112} y="56" width="100" height="6" rx="2" fill="var(--dls-text-secondary)" opacity="0.07" />
          <rect x={cx + cw - 112} y="66" width="80" height="6" rx="2" fill="var(--dls-text-secondary)" opacity="0.05" />
          <rect x={cx + cw - 112} y="76" width="90" height="6" rx="2" fill="var(--dls-text-secondary)" opacity="0.05" />
          <rect x={cx + cw - 112} y="92" width="100" height="50" rx="4" fill="var(--dls-surface)" opacity="0.6" />
        </g>
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  开关行                                                             */
/* ------------------------------------------------------------------ */

type ToggleRowProps = {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  unavailable?: string | null;
  warning?: string | null;
  cloudOnly?: boolean;
  className?: string;
};

function CloudOnlyBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-dls-hover size-5 justify-center text-xs font-medium text-dls-secondary" aria-label="仅由公司管理">
      <Lock className="size-3" />
    </span>
  );
}

function ToggleRow(props: ToggleRowProps) {
  return (
    <LayoutSectionItem className={cn("gap-3", props.className)}>
      <LayoutSectionItemHeader>
        <LayoutSectionItemTitle>
          {props.label}
          {props.cloudOnly ? <CloudOnlyBadge /> : null}
        </LayoutSectionItemTitle>
        <LayoutSectionItemDescription>{props.description}</LayoutSectionItemDescription>
        <LayoutSectionItemHeaderActions>
          <Switch
            aria-label={props.label}
            checked={props.checked}
            disabled={props.disabled || props.cloudOnly}
            onCheckedChange={props.onChange}
          />
        </LayoutSectionItemHeaderActions>
      </LayoutSectionItemHeader>
      {props.warning && !props.checked ? (
        <Alert variant="warning">
          <AlertTriangle />
          <AlertDescription>{props.warning}</AlertDescription>
        </Alert>
      ) : null}
      {props.unavailable ? (
        <Alert>
          <Info />
          <AlertDescription>{props.unavailable}</AlertDescription>
        </Alert>
      ) : null}
    </LayoutSectionItem>
  );
}

/* ------------------------------------------------------------------ */
/*  主页面                                                             */
/* ------------------------------------------------------------------ */

export function ShellCustomizationView() {
  const { config, update, reset } = useShellConfig();
  const brandAppName = useBrandAppName();
  const applicationMenuVisible = useUiStateStore((state) => state.applicationMenuVisible);
  const setApplicationMenuVisible = useUiStateStore((state) => state.setApplicationMenuVisible);

  const isDefault = (Object.keys(DEFAULT_SHELL_CONFIG) as (keyof ShellConfig)[]).every(
    (key) => config[key] === DEFAULT_SHELL_CONFIG[key],
  ) && !applicationMenuVisible;

  const resetAll = () => {
    reset();
    setApplicationMenuVisible(false);
  };

  return (
    <LayoutStack>
      {/* 品牌 */}
      <LayoutSection>
        <LayoutSectionHeader>
          <LayoutSectionTitle>品牌</LayoutSectionTitle>
          <LayoutSectionDescription>
            设置员工在应用中看到的名称。
          </LayoutSectionDescription>
        </LayoutSectionHeader>

        <LayoutSectionItem>
          <LayoutSectionItemHeader>
            <LayoutSectionItemTitle>应用名称</LayoutSectionItemTitle>
            <LayoutSectionItemDescription>
              此名称会显示在标题栏、侧边栏和欢迎页面中。
            </LayoutSectionItemDescription>
            <LayoutSectionItemHeaderActions>
              <Field className="w-64 max-w-full gap-0">
               <FieldLabel className="sr-only" htmlFor="shell-app-name">
                  应用名称
                </FieldLabel>
                <Input
                  id="shell-app-name"
                  className="h-8 text-xs"
                  value={brandAppName}
                  placeholder="FoxWork"
                  disabled
                  onChange={(event) => update({ appName: event.currentTarget.value || DEFAULT_SHELL_CONFIG.appName })}
                />
              </Field>
            </LayoutSectionItemHeaderActions>
          </LayoutSectionItemHeader>
          <Alert>
            <Info />
            <AlertDescription>
              {brandAppName === "OpenWork" ? "公司尚未设置应用名称。" : "应用名称由公司统一管理。"}
            </AlertDescription>
          </Alert>
        </LayoutSectionItem>
      </LayoutSection>

      <Separator />

      {/* 界面布局 */}
      <LayoutSection>
        <LayoutSectionHeader>
          <LayoutSectionTitle>界面布局</LayoutSectionTitle>
          <LayoutSectionDescription>
            选择界面中显示的功能区域。
          </LayoutSectionDescription>
        </LayoutSectionHeader>

        <Alert>
          <AlertDescription>
            隐藏的功能仍可通过命令面板（Cmd+K）使用。
          </AlertDescription>
        </Alert>

        <LayoutSectionItem className="rounded-2xl border border-dls-border p-4">
          <ShellWireframe config={{ ...config, appName: brandAppName }} />
        </LayoutSectionItem>

        <ToggleRow
          label="显示侧边栏"
          description="从侧边栏浏览工作区和历史会话。"
          checked={config.sidebar}
          onChange={(v) => update({ sidebar: v })}
        />

        <ToggleRow
          label="显示状态栏"
          description="在底部快速查看状态、设置和常用操作。"
          checked={config.statusBar}
          onChange={(v) => update({ statusBar: v })}
          warning="隐藏后，只能通过 Cmd+K 打开设置。"
        />

        {config.statusBar ? (
          <div className="ml-6 flex flex-col gap-3 border border-dls-border px-4 py-4 rounded-2xl -mr-4">
            <ToggleRow
              label="显示文档入口"
              description="显示公司文档链接。"
              checked={config.docsButton}
              onChange={(value) => update({ docsButton: value })}
            />
            <ToggleRow
              label="显示反馈按钮"
              description="显示提交反馈的入口。"
              checked={config.feedbackButton}
              onChange={(value) => update({ feedbackButton: value })}
            />
            <ToggleRow
              label="显示公司登录入口"
              description="未登录时显示公司服务登录入口。"
              checked={config.cloudSignin}
              onChange={(value) => update({ cloudSignin: value })}
            />
          </div>
        ) : null}

        <ToggleRow
          label="显示通知"
          description="在标题栏集中显示公司服务和工作区的最新消息。"
          checked={config.notifications}
          onChange={(v) => update({ notifications: v })}
        />

        <ToggleRow
          label="显示任务建议"
          description="显示常用任务建议，帮助员工快速开始工作。"
          checked={config.starterCards}
          onChange={(v) => update({ starterCards: v })}
        />

        <ToggleRow
          label="显示模型选择"
          description="允许员工选择要使用的 AI 模型。"
          checked={config.modelPicker}
          onChange={(v) => update({ modelPicker: v })}
          disabled
          unavailable="暂时无法单独控制模型选择器的显示状态。"
        />

        <ToggleRow
          label="显示浏览器面板"
          description="在会话旁使用内置浏览器查看网页内容。"
          checked={config.browser}
          onChange={(v) => update({ browser: v })}
          disabled
          unavailable="暂时无法单独控制浏览器面板的显示状态。"
        />

        <ToggleRow
          label="显示菜单栏"
          description="显示桌面应用的系统菜单栏。"
          checked={applicationMenuVisible}
          onChange={setApplicationMenuVisible}
          className="hidden windows:flex linux:flex"
        />

        <ToggleRow
          label="显示添加工作区按钮"
          description="允许员工添加本地或远程工作区。"
          checked={config.addWorkspace}
          onChange={(v) => update({ addWorkspace: v })}
          disabled
          unavailable="暂时无法单独控制添加工作区按钮的显示状态。"
        />
      </LayoutSection>

      <Separator />

      {/* 公司统一管理，当前员工不可修改 */}
      <LayoutSection>
        <LayoutSectionHeader>
          <LayoutSectionTitle>公司统一设置</LayoutSectionTitle>
          <LayoutSectionDescription>
            以下设置由公司管理员统一管理。
          </LayoutSectionDescription>
        </LayoutSectionHeader>

        <Alert variant="warning">
          <Lock />
          <AlertDescription>
            只有公司管理员可以修改这些设置。如需调整，请联系管理员。
          </AlertDescription>
        </Alert>

        <ToggleRow
          label="设置访问权限"
          description="允许员工打开设置页面。"
          checked={true}
          onChange={() => {}}
          cloudOnly
        />

        <ToggleRow
          label="模型使用范围"
          description="限制员工可以选择的 AI 模型和服务商。"
          checked={false}
          onChange={() => {}}
          cloudOnly
        />

        <ToggleRow
          label="扩展安装范围"
          description="限制员工可以安装的扩展、插件和 Skills。"
          checked={false}
          onChange={() => {}}
          cloudOnly
        />

        <ToggleRow
          label="启用欢迎页面"
          description="首次使用时显示入门页面。"
          checked={config.welcomePage}
          onChange={(v) => update({ welcomePage: v })}
          cloudOnly
          disabled
        />
      </LayoutSection>

      <Separator />

      {/* 重置 */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-dls-secondary">
          {isDefault ? "所有设置均为默认值。" : "部分设置已自定义。"}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={resetAll}
          disabled={isDefault}
        >
          <RotateCcw size={12} />
          恢复默认值
        </Button>
      </div>
    </LayoutStack>
  );
}
