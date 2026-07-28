/** @jsxImportSource react */
import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollAreaViewport } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { ExtensionKind } from "@/app/constants";
import { MarkdownBlock } from "../domains/session/surface/markdown";
import { resolveExtensionIconUrl } from "./extension-icon-src";
import { ExtensionMeshAvatar } from "./extension-mesh-avatar";

export type ExtensionDetailModalProps = {
  open: boolean;
  onClose: () => void;
  name: string;
  description: string;
  iconSlug?: string;
  iconSrc?: string;
  kind?: ExtensionKind;
  connected?: boolean;
  connectedLabel?: string;
  disconnectedLabel?: string;
  connecting?: boolean;
  /** Whether this item is hidden from the normal extensions catalog. */
  hidden?: boolean;
  /** Whether this extension is still in preview. */
  preview?: boolean;
  /** Whether this extension is beta / untested. */
  beta?: boolean;
  /** Reason this item is visible but unavailable. */
  disabledReason?: string | null;
  /** Remote URL if applicable. */
  url?: string;
  /** Declarative setup instructions from an extension manifest. */
  setupInstructions?: string;
  /** Declarative install resource labels from an extension manifest. */
  resourceLabels?: string[];
  /** Declarative UI/runtime contribution labels from an extension manifest. */
  contributionLabels?: string[];
  /** Whether OAuth is required. */
  oauth?: boolean;
  /** Exact local command this extension will launch, when known. */
  launchCommand?: string[];
  /** Environment passed to the local MCP process, when known. */
  environment?: Record<string, string>;
  /** Filesystem path (for skills). Not shown directly, used for reveal. */
  path?: string;
  /** Skill trigger phrase (e.g. "when user asks to create an agent"). */
  trigger?: string;
  /** Reveal the file in Finder/Explorer. */
  onReveal?: () => void;
  /** Skill content preview (first ~500 chars of the SKILL.md). */
  contentPreview?: string;
  /** Connect handler. */
  onConnect?: () => void;
  connectLabel?: string;
  connectingLabel?: string;
  /** Uninstall/disconnect handler. Shown when connected. */
  onUninstall?: () => void;
  uninstallLabel?: string;
  /** Hide from the normal catalog view. */
  onHide?: () => void;
  /** Show again in the normal catalog view. */
  onShow?: () => void;
  /** Extension-specific configuration UI rendered inside the modal body. */
  configSlot?: React.ReactNode;
  showEnablementCard?: boolean;
  size?: "default" | "wide";
};

const kindLabel: Record<ExtensionKind, string> = {
  mcp: "MCP 服务",
  plugin: "插件",
  skill: "Skill（技能）",
  "ui-control": "界面控制",
  extension: "FoxWork 扩展",
};

const kindDesc: Record<ExtensionKind, string> = {
  mcp: "通过模型上下文协议连接外部工具和数据。",
  plugin: "为 FoxWork 增加由公司统一管理的能力。",
  skill: "可由助手按需执行的可复用工作方法。",
  "ui-control": "允许其他 MCP 客户端通过本机标准输入输出桥接查看和操作 FoxWork 界面。",
  extension: "为工作区增加工具、模型服务或其他集成。",
};

const uiControlClientConfig = `{
  "mcpServers": {
    "openwork-ui": {
      "command": "npx",
      "args": ["-y", "openwork-ui-mcp"]
    }
  }
}`;

function uiControlOpencodeConfig(command: string[], environment?: Record<string, string>) {
  return JSON.stringify({
    mcp: {
      "openwork-ui": {
        type: "local",
        command,
        ...(environment ? { environment } : {}),
        enabled: true,
      },
    },
  }, null, 2);
}

const fallbackUiControlCommand = ["npx", "-y", "openwork-ui-mcp"];

const fallbackUiControlOpencodeConfig = `{
  "mcp": {
    "openwork-ui": {
      "type": "local",
      "command": ["npx", "-y", "openwork-ui-mcp"],
      "enabled": true
    }
  }
}`;

/**
 * Strip YAML-like frontmatter from the beginning of a skill content string.
 * Handles both `---` delimited blocks and bare `key: value` lines at the top.
 */
function stripSkillFrontmatter(content: string): string {
  let text = content;

  // Handle --- delimited frontmatter block
  const fencedMatch = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (fencedMatch) {
    text = text.slice(fencedMatch[0].length);
  } else {
    // Handle bare key: value lines at the top
    const lines = text.split("\n");
    let startIndex = 0;

    // Skip leading blank lines
    while (startIndex < lines.length && !lines[startIndex].trim()) {
      startIndex++;
    }

    // Skip any key: value lines (common frontmatter keys)
    while (startIndex < lines.length) {
      const line = lines[startIndex].trim();
      if (/^[a-zA-Z_-]+\s*:/.test(line) && !line.startsWith("#")) {
        startIndex++;
      } else {
        break;
      }
    }

    if (startIndex > 0) {
      text = lines.slice(startIndex).join("\n");
    }
  }

  return text.trim();
}

export function ExtensionDetailModal({
  open,
  onClose,
  name,
  description,
  iconSlug,
  iconSrc,
  kind = "mcp",
  connected = false,
  connectedLabel,
  disconnectedLabel,
  connecting = false,
  hidden = false,
  preview = false,
  beta = false,
  disabledReason = null,
  url,
  setupInstructions,
  resourceLabels = [],
  contributionLabels = [],
  oauth,
  launchCommand,
  environment,
  path,
  trigger,
  contentPreview,
  onReveal,
  onConnect,
  connectLabel = "连接",
  connectingLabel = "正在连接...",
  onUninstall,
  uninstallLabel,
  onHide,
  onShow,
  configSlot,
  showEnablementCard = true,
  size = "default",
}: ExtensionDetailModalProps) {
  "use memo";
  const resolvedIconSrc = resolveExtensionIconUrl({ iconSrc, iconSlug, serviceUrl: url });

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent
        className={cn(
          "flex max-h-[90vh] min-h-0 w-full flex-col overflow-hidden",
          size === "wide" ? "max-w-3xl sm:max-w-3xl" : "max-w-xl sm:max-w-xl",
        )}
      >
        <DialogHeader>
          <div className="flex min-w-0 items-start gap-4">
            {/* Icon */}
            <div className="relative shrink-0">
              <div
                className={cn(
                  "flex size-12 items-center justify-center rounded-xl border",
                  connected ? "border-green-6 bg-green-2" : "border-dls-border bg-dls-hover",
                )}
              >
                {resolvedIconSrc ? (
                  <div className="flex size-8 items-center justify-center rounded-md bg-white">
                    <img src={resolvedIconSrc} alt="" width={20} height={20} loading="lazy" style={{ display: "block" }} />
                  </div>
                ) : (
                  <ExtensionMeshAvatar
                    name={name}
                    category={kind}
                    className="size-9 rounded-lg shadow-inner"
                  />
                )}
              </div>
              {connected ? (
                <div className="absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full border-2 border-dls-surface bg-green-9">
                  <CheckCircle2 size={11} className="text-white" strokeWidth={3} />
                </div>
              ) : null}
            </div>

            <div className="min-w-0 flex flex-col gap-1 justify-center self-stretch">
              <DialogTitle>{name}</DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-2">
                <span>{kindLabel[kind]}</span>
                {preview ? (
                  <span className="rounded-md bg-blue-3 px-1.5 py-0.5 text-[10px] font-medium text-blue-11">
                    预览版
                  </span>
                ) : null}
                {beta ? (
                  <span className="rounded-md bg-amber-3 px-1.5 py-0.5 text-[10px] font-medium text-amber-11">
                    内测版
                  </span>
                ) : null}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Body */}
        <ScrollArea className="flex min-h-0 flex-1 flex-col">
          <ScrollAreaViewport className="min-h-0 flex-1 h-auto!">
            <div className="space-y-5 px-px">
            {/* Description */}
            <div className="text-sm leading-relaxed text-card-foreground">
              {description}
            </div>

            {setupInstructions ? (
              <Card variant="outline" size="sm">
                <CardHeader>
                  <CardTitle>配置说明</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-sm leading-relaxed text-muted-foreground">
                    {setupInstructions}
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {resourceLabels.length > 0 || contributionLabels.length > 0 ? (
              <Card variant="outline" size="sm">
                <CardHeader>
                  <CardTitle>扩展清单</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 text-sm">
                    {resourceLabels.length > 0 ? (
                      <div>
                        <div className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">资源</div>
                        <div className="flex flex-wrap gap-1.5">
                          {resourceLabels.map((label) => (
                            <span key={label} className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">{label}</span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {contributionLabels.length > 0 ? (
                      <div>
                        <div className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">提供的能力</div>
                        <div className="flex flex-wrap gap-1.5">
                          {contributionLabels.map((label) => (
                            <span key={label} className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">{label}</span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {/* Details */}
            <Card variant="outline" size="sm">
              <CardHeader>
                <CardTitle>详细信息</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">类型</span>
                    <span className="font-medium text-card-foreground">{kindLabel[kind]}</span>
                  </div>

                  {url ? (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">服务地址</span>
                      <span className="flex items-center gap-1.5 truncate font-mono text-xs text-card-foreground">
                        {url.replace(/^https?:\/\//, "").slice(0, 40)}
                        <ExternalLink size={10} className="shrink-0 text-muted-foreground" />
                      </span>
                    </div>
                  ) : null}

                  {kind === "ui-control" ? (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">启动命令</span>
                      <span className="max-w-[300px] truncate font-mono text-xs text-card-foreground">{(launchCommand ?? fallbackUiControlCommand).join(" ")}</span>
                    </div>
                  ) : null}

                  {path && onReveal ? (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">位置</span>
                      <Button
                        variant="link"
                        size="xs"
                        onClick={onReveal}
                      >
                        在访达中显示
                        <ExternalLink data-icon="inline-end" />
                      </Button>
                    </div>
                  ) : null}

                  {oauth ? (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">身份验证</span>
                      <span className="font-medium text-card-foreground">需要 OAuth</span>
                    </div>
                  ) : null}

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">状态</span>
                    <span className={cn("font-medium", connected ? "text-green-11" : "text-muted-foreground")}>
                      {connected
                        ? connectedLabel ?? (kind === "skill" || kind === "plugin" ? "已安装" : "已连接")
                        : connecting
                          ? connectingLabel
                          : disconnectedLabel ?? (kind === "skill" || kind === "plugin" ? "未安装" : "未连接")}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">显示状态</span>
                    <span className="font-medium text-card-foreground">{hidden ? "已隐藏" : "已显示"}</span>
                  </div>

                  {preview ? (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">发布阶段</span>
                      <span className="font-medium text-blue-11">预览版</span>
                    </div>
                  ) : null}

                  {beta ? (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">发布阶段</span>
                      <span className="font-medium text-amber-11">内测版</span>
                    </div>
                  ) : null}

                  {disabledReason ? (
                    <div className="flex items-center justify-between gap-4 text-sm">
                      <span className="text-muted-foreground">可用状态</span>
                      <span className="text-right font-medium text-amber-11">{disabledReason}</span>
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            {/* Skill-specific: trigger + content preview */}
            {kind === "ui-control" ? <UiControlConnectionDetails launchCommand={launchCommand} environment={environment} /> : null}

            {kind === "skill" && trigger ? (
              <Card variant="outline" size="sm">
                <CardHeader>
                  <CardTitle>触发方式</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-sm leading-relaxed text-card-foreground">
                    {trigger}
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {kind === "skill" && contentPreview ? (() => {
              const body = stripSkillFrontmatter(contentPreview);

              if (!body) {
                return null;
              }

              return (
                <div className="flex flex-col gap-2">
                  <div className="text-sm font-medium text-card-foreground">
                    Skill 内容
                  </div>
                  <div className="max-h-[300px] overflow-y-auto rounded-xl border border-border bg-card p-4 text-sm leading-relaxed text-card-foreground">
                    <MarkdownBlock text={body} />
                  </div>
                </div>
              );
            })() : null}

            {/* What this enables (generic, for non-skills or skills without preview) */}
            {showEnablementCard && ((kind !== "skill" && kind !== "ui-control") || (!trigger && !contentPreview && kind !== "ui-control")) ? (
              <Card variant="outline" size="sm">
                <CardHeader>
                  <CardTitle>提供的能力</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-sm leading-relaxed text-muted-foreground">
                    {kindDesc[kind]}
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {configSlot}
            </div>
          </ScrollAreaViewport>
        </ScrollArea>

        <DialogFooter className="shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {hidden && onShow ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onShow();
                  onClose();
                }}
              >
                显示
              </Button>
            ) : !hidden && onHide ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onHide();
                  onClose();
                }}
              >
                隐藏
              </Button>
            ) : null}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <DialogClose render={<Button variant="outline" />}>
              关闭
            </DialogClose>
            {connected && onUninstall ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  onUninstall();
                  onClose();
                }}
              >
                {uninstallLabel ?? (kind === "skill" ? "卸载" : "断开连接")}
              </Button>
            ) : null}
            {!connected && onConnect ? (
              <Button
                onClick={onConnect}
                disabled={connecting}
              >
                {connecting ? (
                  <>
                    <Loader2 data-icon="inline-start" className="animate-spin" />
                    {connectingLabel}
                  </>
                ) : (
                  connectLabel
                )}
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface UiControlConnectionDetailsProps {
  launchCommand?: string[];
  environment?: Record<string, string>;
}

function UiControlConnectionDetails(props: UiControlConnectionDetailsProps) {
  "use memo";

  const opencodeConfig = props.launchCommand ? uiControlOpencodeConfig(props.launchCommand, props.environment) : fallbackUiControlOpencodeConfig;

  return (
    <div className="space-y-4">
      <Card variant="outline" size="sm">
        <CardHeader>
          <CardTitle>连接其他客户端</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2 text-sm leading-relaxed text-muted-foreground">
            <div>FoxWork 桌面端会自动启动仅限本机访问的桥接服务。</div>
            <div>MCP 客户端通过标准输入输出启动 <span className="font-mono text-card-foreground">openwork-ui-mcp</span>，由该程序自动发现桥接服务并转发界面工具。</div>
            <div>不要让客户端直接连接随机生成的本机桥接地址。</div>
          </div>
        </CardContent>
      </Card>

      <Card variant="outline" size="sm">
        <CardHeader>
          <CardTitle>Claude Desktop, Codex, Cursor</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="max-h-[180px] overflow-x-auto rounded-xl border border-border p-3 text-xs leading-relaxed text-card-foreground">
            <code>{uiControlClientConfig}</code>
          </pre>
        </CardContent>
      </Card>

      <Card variant="outline" size="sm">
        <CardHeader>
          <CardTitle>本地运行引擎</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="max-h-[180px] overflow-x-auto rounded-xl border border-border p-3 text-xs leading-relaxed text-card-foreground">
            <code>{opencodeConfig}</code>
          </pre>
        </CardContent>
      </Card>

      <Card variant="outline" size="sm">
        <CardHeader>
          <CardTitle>自动发现</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative overflow-hidden rounded-xl bg-clip-padding before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-xl)-1px)] before:border before:border-border">
            <Table className="text-xs">
              <TableBody>
                <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                  <TableCell className="bg-muted/50 w-40 py-2 text-xs font-medium">
                    正式版发现文件
                  </TableCell>
                  <TableCell className="py-2 whitespace-normal">
                    <span className="font-mono text-xs break-all">~/Library/Application Support/com.foxwork.desktop/openwork-ui-control.json</span>
                  </TableCell>
                </TableRow>
                <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                  <TableCell className="bg-muted/50 py-2 text-xs font-medium">
                    开发版发现文件
                  </TableCell>
                  <TableCell className="py-2 whitespace-normal">
                    <span className="font-mono text-xs break-all">~/Library/Application Support/com.foxwork.desktop.dev/openwork-ui-control.json</span>
                  </TableCell>
                </TableRow>
                <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                  <TableCell className="bg-muted/50 py-2 text-xs font-medium">
                    自定义路径
                  </TableCell>
                  <TableCell className="py-2 whitespace-normal">
                    <span className="font-mono text-xs break-all">OPENWORK_UI_CONTROL_DISCOVERY=/path/to/openwork-ui-control.json</span>
                  </TableCell>
                </TableRow>
                {props.environment?.OPENWORK_UI_CONTROL_DISCOVERY ? (
                  <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                    <TableCell className="bg-muted/50 py-2 text-xs font-medium">
                      当前自定义路径
                    </TableCell>
                    <TableCell className="py-2 whitespace-normal">
                      <span className="font-mono text-xs break-all">{props.environment.OPENWORK_UI_CONTROL_DISCOVERY}</span>
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
