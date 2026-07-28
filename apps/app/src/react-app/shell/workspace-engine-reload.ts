import {
  isOpenworkWorkspaceNotFoundError,
  type OpenworkServerClient,
} from "@/app/lib/openwork-server";
import type { ResolvedWorkspaceEndpoint } from "@/app/lib/workspace-endpoint";

export type WorkspaceEngineEndpoint = {
  client: Pick<OpenworkServerClient, "reloadEngine">;
  workspaceId: string;
};

export type WorkspaceEngineReloadResult = {
  endpoint: WorkspaceEngineEndpoint;
  recovered: boolean;
};

function workspaceRecoveryError(cause: unknown): Error {
  return new Error("公司工作区已更新，正在重新连接。请稍后重试。", { cause });
}

export function isWorkspaceNotFoundError(error: unknown): boolean {
  return isOpenworkWorkspaceNotFoundError(error);
}

export async function reloadWorkspaceEngineWithWorkspaceRecovery(input: {
  endpoint: WorkspaceEngineEndpoint;
  recoverEndpoint: () => Promise<ResolvedWorkspaceEndpoint | null>;
}): Promise<WorkspaceEngineReloadResult> {
  try {
    await input.endpoint.client.reloadEngine(input.endpoint.workspaceId);
    return { endpoint: input.endpoint, recovered: false };
  } catch (error) {
    if (!isWorkspaceNotFoundError(error)) throw error;
    const recoveredEndpoint = await input.recoverEndpoint();
    if (!recoveredEndpoint) throw workspaceRecoveryError(error);
    try {
      await recoveredEndpoint.client.reloadEngine(recoveredEndpoint.workspaceId);
      return { endpoint: recoveredEndpoint, recovered: true };
    } catch (retryError) {
      if (isWorkspaceNotFoundError(retryError)) throw workspaceRecoveryError(retryError);
      throw retryError;
    }
  }
}
