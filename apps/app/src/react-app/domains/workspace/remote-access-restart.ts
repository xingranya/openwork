import { useCallback, useState } from "react";

import { openworkServerRestart, type OpenworkServerInfo } from "../../../app/lib/desktop";
import {
  readOpenworkServerSettings,
  writeOpenworkServerSettings,
} from "../../../app/lib/openwork-server";
import { t } from "../../../i18n";
import { toChineseUserMessage } from "../../../app/lib/user-facing-error";

export type RemoteAccessRestartPhase =
  | "idle"
  | "restarting"
  | "reconnecting"
  | "failed";

type UseRemoteAccessRestartOptions = {
  isEnabled: () => boolean;
  onHostInfo: (info: OpenworkServerInfo) => void;
  onSettingsChanged: () => void;
};

export function useRemoteAccessRestart(options: UseRemoteAccessRestartOptions) {
  const [phase, setPhase] = useState<RemoteAccessRestartPhase>("idle");
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(
    async (enabled: boolean) => {
      if (phase === "restarting" || phase === "reconnecting") return;

      const previous = readOpenworkServerSettings();
      const next = { ...previous, remoteAccessEnabled: enabled };

      setPhase("restarting");
      setError(null);
      writeOpenworkServerSettings(next);
      options.onSettingsChanged();

      try {
        const info = await openworkServerRestart({ remoteAccessEnabled: enabled }) as OpenworkServerInfo;
        writeOpenworkServerSettings({
          urlOverride: info.baseUrl?.trim() || undefined,
          token:
            info.ownerToken?.trim() ||
            info.clientToken?.trim() ||
            undefined,
          hostToken: info.hostToken?.trim() || undefined,
          portOverride: info.port ?? undefined,
          remoteAccessEnabled: info.remoteAccessEnabled === true,
        });
        options.onHostInfo(info);
        options.onSettingsChanged();
        setPhase("idle");
      } catch (caught) {
        writeOpenworkServerSettings(previous);
        options.onSettingsChanged();
        setError(toChineseUserMessage(caught, t("app.error_remote_access")));
        setPhase("failed");
      }
    },
    [options, phase],
  );

  const reset = useCallback(() => {
    if (phase === "failed") {
      setPhase("idle");
      setError(null);
    }
  }, [phase]);

  return {
    busy: phase === "restarting" || phase === "reconnecting",
    error,
    phase,
    reset,
    save,
    status: remoteAccessStatusForPhase(phase, options.isEnabled()),
  };
}

export function remoteAccessStatusForPhase(phase: RemoteAccessRestartPhase, enabled: boolean) {
  switch (phase) {
    case "restarting":
      return "正在重启本机服务...";
    case "reconnecting":
      return "正在重新连接本机服务...";
    case "failed":
      return enabled
        ? "远程访问可能仍处于开启状态，请检查连接信息后重试。"
        : "远程访问仍处于关闭状态，准备好后可以重试。";
    default:
      return enabled
        ? "远程访问已开启。"
        : "远程访问已关闭。";
  }
}
