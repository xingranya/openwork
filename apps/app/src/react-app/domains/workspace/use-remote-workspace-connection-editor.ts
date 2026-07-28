/** @jsxImportSource react */
import { useCallback, useMemo, useState } from "react";

import {
  workspaceUpdateRemote,
  type WorkspaceInfo,
} from "../../../app/lib/desktop";
import { buildOpenworkWorkspaceBaseUrl, type OpenworkServerClient } from "../../../app/lib/openwork-server";
import { isDesktopRuntime } from "../../../app/lib/runtime-env";
import { t } from "../../../i18n";
import type { RemoteWorkspaceInput } from "./types";

type RemoteWorkspaceCredentialSource = Pick<
  WorkspaceInfo,
  "openworkToken" | "openworkClientToken" | "openworkHostToken"
> | null | undefined;

/**
 * 会话令牌和配置管理令牌是两种独立权限。编辑连接地址时必须保留
 * 已授权的配置管理令牌，不能把普通会话令牌误当成主机令牌。
 */
export function resolveRemoteWorkspaceConnectionCredentials(
  workspace: RemoteWorkspaceCredentialSource,
  fields: Pick<RemoteWorkspaceInput, "openworkToken" | "openworkHostToken">,
) {
  const existingSessionToken =
    workspace?.openworkToken?.trim() ??
    workspace?.openworkClientToken?.trim() ??
    "";
  const existingHostToken = workspace?.openworkHostToken?.trim() ?? "";
  return {
    openworkToken:
      fields.openworkToken === undefined
        ? existingSessionToken
        : fields.openworkToken?.trim() ?? "",
    openworkHostToken:
      fields.openworkHostToken === undefined
        ? existingHostToken
        : fields.openworkHostToken?.trim() ?? "",
  };
}

function describeEditorError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    const serialized = JSON.stringify(error);
    return serialized && serialized !== "{}" ? serialized : t("app.unknown_error");
  } catch {
    return t("app.unknown_error");
  }
}

export function useRemoteWorkspaceConnectionEditor<TWorkspace extends WorkspaceInfo>(input: {
  workspaces: TWorkspace[];
  client: OpenworkServerClient | null;
  onSaved: (workspaceId: string) => void | Promise<void>;
}) {
  const { client, onSaved, workspaces } = input;
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const workspace = useMemo(
    () =>
      workspaceId
        ? workspaces.find(
            (item) =>
              item.id === workspaceId && item.workspaceType === "remote",
          ) ?? null
        : null,
    [workspaces, workspaceId],
  );

  const initialValues = useMemo(
    () => {
      const hostUrl = workspace?.openworkHostUrl ?? workspace?.baseUrl ?? "";
      const mountedUrl = workspace?.remoteType === "openwork"
        ? buildOpenworkWorkspaceBaseUrl(hostUrl, workspace.openworkWorkspaceId) ?? hostUrl
        : hostUrl;
      return {
        openworkHostUrl: mountedUrl,
        openworkToken:
          workspace?.openworkToken ??
          workspace?.openworkClientToken ??
          "",
        openworkHostToken: workspace?.openworkHostToken ?? "",
        directory: workspace?.directory ?? workspace?.path ?? "",
        displayName: workspace?.displayName ?? workspace?.name ?? "",
      };
    },
    [workspace],
  );

  const open = useCallback(
    (nextWorkspaceId: string) => {
      const next = workspaces.find((item) => item.id === nextWorkspaceId);
      if (!next || next.workspaceType !== "remote") return;
      setWorkspaceId(nextWorkspaceId);
      setError(null);
    },
    [workspaces],
  );

  const close = useCallback(() => {
    if (busy) return;
    setWorkspaceId(null);
    setError(null);
  }, [busy]);

  const save = useCallback(
    async (fields: RemoteWorkspaceInput) => {
      const id = workspaceId?.trim() ?? "";
      const baseUrl = fields.openworkHostUrl?.trim() ?? "";
      if (!id || !baseUrl) {
        setError(t("dashboard.remote_base_url_required"));
        return;
      }

      setBusy(true);
      setError(null);
      try {
        const displayName = fields.displayName?.trim() || null;
        const directory = fields.directory?.trim() || null;
        const credentials = resolveRemoteWorkspaceConnectionCredentials(workspace, fields);
        if (isDesktopRuntime()) {
          await workspaceUpdateRemote({
            workspaceId: id,
            baseUrl,
            openworkHostUrl: baseUrl,
            openworkToken: credentials.openworkToken,
            openworkClientToken: "",
            openworkHostToken: credentials.openworkHostToken,
            displayName,
            directory,
            remoteType: "openwork",
          });
          await onSaved(id);
        } else {
          if (!client) throw new Error(t("app.error_connect_first"));
          const connectionChanged = baseUrl !== (initialValues.openworkHostUrl?.trim() ?? "") ||
            credentials.openworkToken !== (initialValues.openworkToken?.trim() ?? "") ||
            credentials.openworkHostToken !== (workspace?.openworkHostToken?.trim() ?? "") ||
            directory !== (initialValues.directory?.trim() || null);
          if (connectionChanged) {
            const result = await client.createRemoteWorkspace({
              baseUrl,
              openworkHostUrl: baseUrl,
              openworkToken: credentials.openworkToken || null,
              openworkHostToken: credentials.openworkHostToken || null,
              displayName,
              directory,
              remoteType: "openwork",
            });
            await onSaved(result.activeId ?? id);
          } else {
            await client.updateWorkspaceDisplayName(id, displayName);
            await onSaved(id);
          }
        }
        setWorkspaceId(null);
      } catch (nextError) {
        setError(describeEditorError(nextError));
      } finally {
        setBusy(false);
      }
    },
    [client, initialValues.directory, initialValues.openworkHostUrl, initialValues.openworkToken, onSaved, workspace, workspaceId],
  );

  return {
    workspace,
    busy,
    error,
    initialValues,
    open,
    close,
    save,
  };
}
