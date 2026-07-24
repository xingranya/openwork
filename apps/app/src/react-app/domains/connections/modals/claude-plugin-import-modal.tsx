/** @jsxImportSource react */
import { useReducer } from "react";
import { Download, Loader2, Search } from "lucide-react";

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
import { TextInput } from "../../../design-system/text-input";
import type { OpenworkClaudePluginPreview } from "../../../../app/lib/openwork-server";
import { toChineseUserMessage } from "@/app/lib/user-facing-error";

export type ClaudePluginImportModalProps = {
  open: boolean;
  onClose: () => void;
  onPreview: (url: string) => Promise<OpenworkClaudePluginPreview>;
  onInstall: (url: string) => Promise<{ ok: boolean; message: string }>;
  /** Called after a successful install so the host view can refresh. */
  onInstalled?: () => void;
};

type ModalState = {
  url: string;
  preview: OpenworkClaudePluginPreview | null;
  /** URL the current preview was generated from; install always targets this. */
  previewedUrl: string | null;
  previewing: boolean;
  installing: boolean;
  error: string | null;
};

const initialState: ModalState = {
  url: "",
  preview: null,
  previewedUrl: null,
  previewing: false,
  installing: false,
  error: null,
};

type ModalAction =
  | Partial<ModalState>
  | "reset"
  | { kind: "preview-success"; url: string; preview: OpenworkClaudePluginPreview };

function reducer(state: ModalState, action: ModalAction): ModalState {
  if (action === "reset") return initialState;
  if ("kind" in action) {
    // Ignore preview responses for a URL the user has since edited away from.
    if (state.url.trim() !== action.url) return { ...state, previewing: false };
    return { ...state, previewing: false, preview: action.preview, previewedUrl: action.url };
  }
  return { ...state, ...action };
}

const COMPONENT_LABELS: Record<string, string> = {
  mcp: "MCP 服务",
  skill: "技能",
  command: "命令",
  agent: "智能体",
};

export function ClaudePluginImportModal(props: ClaudePluginImportModalProps) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const handleClose = () => {
    if (state.previewing || state.installing) return;
    dispatch("reset");
    props.onClose();
  };

  const handlePreview = async () => {
    const url = state.url.trim();
    if (!url) {
      dispatch({ error: "请输入 GitHub 仓库地址。" });
      return;
    }
    dispatch({ previewing: true, error: null, preview: null, previewedUrl: null });
    try {
      const preview = await props.onPreview(url);
      dispatch({ kind: "preview-success", url, preview });
    } catch (error) {
      dispatch({
        previewing: false,
        error: toChineseUserMessage(error, "无法读取插件信息，请检查仓库地址和访问权限。"),
      });
    }
  };

  const handleInstall = async () => {
    // Install exactly what was previewed — never a URL edited after preview.
    const url = state.previewedUrl;
    if (!url || state.installing) return;
    dispatch({ installing: true, error: null });
    try {
      const result = await props.onInstall(url);
      if (!result.ok) {
        dispatch({
          installing: false,
          error: toChineseUserMessage(result.message, "插件安装失败，请检查仓库内容后重试。"),
        });
        return;
      }
    } catch (error) {
      dispatch({
        installing: false,
        error: toChineseUserMessage(error, "插件安装失败，请稍后重试。"),
      });
      return;
    }
    dispatch("reset");
    props.onInstalled?.();
    props.onClose();
  };

  const preview = state.preview;
  const groups = preview
    ? (["mcp", "skill", "command", "agent"] as const)
        .map((type) => ({
          type,
          items: preview.components.filter((component) => component.type === type),
        }))
        .filter((group) => group.items.length > 0)
    : [];

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <DialogContent className="flex max-h-[90vh] min-h-0 w-full max-w-lg flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>从 GitHub 安装插件</DialogTitle>
          <DialogDescription>
            支持包含 .claude-plugin/plugin.json 的 Claude Code 插件仓库，可导入 MCP 服务、技能和命令。
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <TextInput
                label="GitHub 仓库"
                placeholder="https://github.com/slackapi/slack-mcp-plugin"
                value={state.url}
                onChange={(event) =>
                  dispatch({ url: event.currentTarget.value, preview: null, previewedUrl: null })
                }
              />
            </div>
            <Button
              variant="outline"
              onClick={() => void handlePreview()}
              disabled={state.previewing || state.installing}
            >
              {state.previewing ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <Search data-icon="inline-start" />
              )}
              预览
            </Button>
          </div>

          {state.preview ? (
            <div className="space-y-3 rounded-xl border border-dls-border bg-dls-hover/40 p-4">
              <div>
                <div className="text-sm font-semibold text-dls-text">
                  {state.preview.name}
                  {state.preview.version ? (
                    <span className="ml-2 text-xs font-normal text-dls-secondary">v{state.preview.version}</span>
                  ) : null}
                </div>
                {state.preview.description ? (
                  <div className="mt-0.5 text-xs text-dls-secondary">
                    {toChineseUserMessage(state.preview.description, "此插件暂未提供中文说明。")}
                  </div>
                ) : null}
                <div className="mt-1 text-[11px] text-dls-secondary">
                  {state.preview.source.owner}/{state.preview.source.repo} @ {state.preview.source.ref}
                  {state.preview.source.dir ? ` · ${state.preview.source.dir}` : ""}
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-xs font-medium text-dls-text">将安装以下内容</div>
                <div className="space-y-2">
                  {groups.map((group) => (
                    <div key={group.type}>
                      <div className="text-[11px] font-medium uppercase tracking-wide text-dls-secondary">
                        {group.items.length} 个{COMPONENT_LABELS[group.type]}
                      </div>
                      <ul className="mt-0.5 space-y-0.5">
                        {group.items.map((item) => (
                          <li key={`${group.type}:${item.name}`} className="text-xs text-dls-text">
                            <span className="font-medium">{item.name}</span>
                            {item.description ? (
                              <span className="text-dls-secondary">
                                ：{toChineseUserMessage(item.description, "暂无中文说明")}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>

              {state.preview.warnings.length > 0 ? (
                <div className="rounded-lg border border-amber-6 bg-amber-2 px-3 py-2 text-xs text-amber-11">
                  {state.preview.warnings.map((warning) => (
                    <div key={warning}>
                      {toChineseUserMessage(warning, "此插件包含需要管理员确认的兼容性提示。")}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {state.error ? (
            <div className="rounded-lg border border-red-6 bg-red-2 px-3 py-2 text-xs text-red-11">
              {state.error}
            </div>
          ) : null}
        </div>

        <DialogFooter className="shrink-0">
          <DialogClose
            render={<Button variant="outline" disabled={state.previewing || state.installing} />}
            disabled={state.previewing || state.installing}
          >
            取消
          </DialogClose>
          <Button
            onClick={() => void handleInstall()}
            disabled={!state.preview || state.previewing || state.installing}
          >
            {state.installing ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <Download data-icon="inline-start" />
            )}
            安装
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
