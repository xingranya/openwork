/** @jsxImportSource react */
import { useState } from "react";
import { CircleAlert, Info } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConfirmModal } from "../../../design-system/modals/confirm-modal";
import { Button } from "@/components/ui/button";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { formatBytes, formatRelativeTime } from "../../../../app/utils";
import { t } from "../../../../i18n";
import type { ReleaseChannel } from "../../../../app/types";
import type { SettingsUpdateStatus } from "../state/electron-updater-state";
import {
  LayoutSectionItem,
  LayoutSectionItemDescription,
  LayoutSectionItemHeader,
  LayoutSectionItemHeaderActions,
  LayoutSectionItemTitle,
  LayoutStack,
} from "../settings-layout";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "../settings-section";

const RELEASE_CHANNEL_OPTIONS: { label: string; value: ReleaseChannel }[] = [
  { label: "稳定版", value: "stable" },
  { label: "测试版", value: "alpha" },
];

function localizedUpdateMessage(message: string | null, fallback: string) {
  return message && /[\u3400-\u9fff]/.test(message) ? message : fallback;
}

type UpdateDownloadProgressProps = {
  downloadedBytes: number | null;
  totalBytes: number | null;
};

function UpdateDownloadProgress(props: UpdateDownloadProgressProps) {
  const downloadedBytes = props.downloadedBytes ?? 0;
  const progressPercent =
    props.totalBytes != null && props.totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / props.totalBytes) * 100)) : 0;
  const progressLabel = (
    <>
      {formatBytes(downloadedBytes)}
      {props.totalBytes != null ? ` / ${formatBytes(props.totalBytes)}` : ""}
    </>
  );

  return (
    <Progress value={progressPercent} className="w-full">
      <ProgressLabel className="text-sm text-muted-foreground font-normal">{progressLabel}</ProgressLabel>
      <ProgressValue className="text-sm" />
    </Progress>
  );
}

export type UpdatesViewProps = {
  busy: boolean;
  webDeployment: boolean;
  appVersion: string | null;
  updateEnv: { supported?: boolean; reason?: string | null } | null;
  updateAutoCheck: boolean;
  toggleUpdateAutoCheck: () => void;
  updateAutoDownload: boolean;
  toggleUpdateAutoDownload: () => void;
  updateStatus: SettingsUpdateStatus;
  anyActiveRuns: boolean;
  checkForUpdates: () => void | Promise<void>;
  downloadUpdate: () => void | Promise<void>;
  installUpdateAndRestart: () => void | Promise<void>;
  /** 当前更新渠道；调用方可以不提供。 */
  releaseChannel?: ReleaseChannel;
  /**
   * 修改更新渠道。未提供时以只读方式显示，适用于网页预览等不能修改偏好的环境。
   */
  onReleaseChannelChange?: (next: ReleaseChannel) => void;
  /**
   * 当前平台是否支持测试版渠道。测试版暂时仅支持 macOS，其他平台传入 false 并隐藏入口。
   */
  alphaChannelSupported?: boolean;
};

export function UpdatesView(props: UpdatesViewProps) {
  const [confirmRestartOpen, setConfirmRestartOpen] = useState(false);
  const updateState = props.updateStatus?.state ?? "idle";
  const updateVersion = props.updateStatus?.version ?? null;
  const updateDate = props.updateStatus?.date ?? null;
  const updateLastCheckedAt = props.updateStatus?.lastCheckedAt ?? null;
  const updateDownloadedBytes = props.updateStatus?.downloadedBytes ?? null;
  const updateTotalBytes = props.updateStatus?.totalBytes ?? null;
  const updateErrorMessage = props.updateStatus?.message ?? null;
  const updateNotes = props.updateStatus?.notes ?? null;

  const updateRestartActiveRunsMessage =
    updateState === "ready" && props.anyActiveRuns
      ? t("settings.update_restart_active_tasks")
      : null;

  return (
    <LayoutStack>
      {props.appVersion ? (
        <LayoutSectionItem>
          <LayoutSectionItemHeader>
            <LayoutSectionItemTitle>当前版本</LayoutSectionItemTitle>
            <LayoutSectionItemDescription className="font-mono">v{props.appVersion}</LayoutSectionItemDescription>
          </LayoutSectionItemHeader>
        </LayoutSectionItem>
      ) : null}
      <LayoutSectionItem>
              <LayoutSectionItemHeader>
                <LayoutSectionItemTitle>
                  {updateState === "checking"
                    ? t("settings.update_checking")
                    : updateState === "available"
                      ? t("settings.update_available_version", undefined, { version: updateVersion ?? "" })
                      : updateState === "blocked"
                        ? t("settings.update_blocked_version", undefined, { version: updateVersion ?? "" })
                      : updateState === "downloading"
                        ? t("settings.update_downloading")
                        : updateState === "ready"
                          ? t("settings.update_ready_version", undefined, { version: updateVersion ?? "" })
                          : updateState === "error"
                            ? t("settings.update_check_failed")
                            : t("settings.update_uptodate")}
                </LayoutSectionItemTitle>
                <LayoutSectionItemDescription>
                  {(updateState === "idle" || updateState === "blocked") && updateLastCheckedAt
                    ? t("settings.update_last_checked", undefined, {
                        time: formatRelativeTime(updateLastCheckedAt),
                      })
                    : updateState === "available" && updateDate
                      ? t("settings.update_published", undefined, { date: updateDate })
                      : null}
                </LayoutSectionItemDescription>
                <LayoutSectionItemHeaderActions>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      onClick={() => void props.checkForUpdates()}
                      disabled={props.busy || updateState === "checking" || updateState === "downloading"}
                    >
                      {updateState === "checking" ? <Spinner className="size-4" /> : null}
                      {t("settings.update_check_button")}
                    </Button>

                    {updateState === "available" ? (
                      <Button
                        variant="secondary"
                        onClick={() => void props.downloadUpdate()}
                        disabled={props.busy}
                      >
                        {t("settings.update_download_button")}
                      </Button>
                    ) : null}

                    {updateState === "ready" ? (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          if (props.anyActiveRuns) {
                            setConfirmRestartOpen(true);
                            return;
                          }
                          void props.installUpdateAndRestart();
                        }}
                        disabled={props.busy}
                      >
                        {t("settings.update_install_button")}
                      </Button>
                    ) : null}
                  </div>
                </LayoutSectionItemHeaderActions>
              </LayoutSectionItemHeader>

              {updateState === "downloading" ? (
                <UpdateDownloadProgress downloadedBytes={updateDownloadedBytes} totalBytes={updateTotalBytes} />
              ) : null}

              {updateState === "error" && updateErrorMessage ? (
                <Alert variant="destructive">
                  <CircleAlert />
                  <AlertDescription>{localizedUpdateMessage(updateErrorMessage, "检查更新失败，请稍后重试。")}</AlertDescription>
                </Alert>
              ) : null}

              {updateState === "blocked" && updateErrorMessage ? (
                <Alert>
                  <Info />
                  <AlertDescription>{localizedUpdateMessage(updateErrorMessage, "当前版本暂时无法更新，请稍后重试。")}</AlertDescription>
                </Alert>
              ) : null}

              {updateRestartActiveRunsMessage ? (
                <Alert>
                  <Info />
                  <AlertDescription>{updateRestartActiveRunsMessage}</AlertDescription>
                </Alert>
              ) : null}

              <ConfirmModal
                open={confirmRestartOpen}
                title={t("settings.update_restart_confirm_title")}
                message={t("settings.update_restart_confirm_message")}
                confirmLabel={t("settings.update_install_button")}
                cancelLabel={t("common.cancel")}
                onConfirm={() => {
                  setConfirmRestartOpen(false);
                  void props.installUpdateAndRestart();
                }}
                onCancel={() => setConfirmRestartOpen(false)}
              />
            </LayoutSectionItem>

            {updateState === "available" && updateNotes ? (
              <LayoutSectionItem className="max-h-40 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
                {localizedUpdateMessage(updateNotes, "此版本暂无中文更新说明。")}
              </LayoutSectionItem>
            ) : null}

      {props.webDeployment ? (
        <Alert>
          <AlertDescription>{t("settings.updates_desktop_only")}</AlertDescription>
        </Alert>
      ) : props.updateEnv && props.updateEnv.supported === false ? (
        <Alert>
          <AlertDescription>{localizedUpdateMessage(props.updateEnv.reason ?? null, t("settings.updates_not_supported"))}</AlertDescription>
        </Alert>
      ) : (
        <>
        <Separator />
          {props.alphaChannelSupported && props.releaseChannel ? (
            <LayoutSectionItem>
              <LayoutSectionItemHeader>
                <LayoutSectionItemTitle>更新渠道</LayoutSectionItemTitle>
                <LayoutSectionItemDescription>
                  稳定版经过完整测试；测试版包含最新改动，稳定性可能较低，目前仅支持 macOS。
                </LayoutSectionItemDescription>
                <LayoutSectionItemHeaderActions>
                  <Select
                    value={props.releaseChannel}
                    items={RELEASE_CHANNEL_OPTIONS}
                    onValueChange={(value) => {
                      if (value === "stable" || value === "alpha") {
                        props.onReleaseChannelChange?.(value);
                      }
                    }}
                    disabled={!props.onReleaseChannelChange}
                  >
                    <SelectTrigger aria-label="更新渠道" className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {RELEASE_CHANNEL_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </LayoutSectionItemHeaderActions>
              </LayoutSectionItemHeader>
            </LayoutSectionItem>
          ) : null}

            <LayoutSectionItem>
              <LayoutSectionItemHeader>
                <LayoutSectionItemTitle>{t("settings.background_checks_title")}</LayoutSectionItemTitle>
                <LayoutSectionItemDescription>{t("settings.background_checks_desc")}</LayoutSectionItemDescription>
                <LayoutSectionItemHeaderActions>
                  <Switch
                    aria-label={t("settings.background_checks_title")}
                    checked={props.updateAutoCheck}
                    onCheckedChange={props.toggleUpdateAutoCheck}
                  />
                </LayoutSectionItemHeaderActions>
              </LayoutSectionItemHeader>
            </LayoutSectionItem>

            <LayoutSectionItem>
              <LayoutSectionItemHeader>
                <LayoutSectionItemTitle>{t("settings.auto_update_title")}</LayoutSectionItemTitle>
                <LayoutSectionItemDescription>{t("settings.auto_update_desc")}</LayoutSectionItemDescription>
                <LayoutSectionItemHeaderActions>
                  <Switch
                    aria-label={t("settings.auto_update_title")}
                    checked={props.updateAutoDownload}
                    onCheckedChange={props.toggleUpdateAutoDownload}
                  />
                </LayoutSectionItemHeaderActions>
              </LayoutSectionItemHeader>
            </LayoutSectionItem>


          </>
      )}
    </LayoutStack>
  );
}
