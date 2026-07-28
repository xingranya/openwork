import type { WorkspaceConnectionState } from "../../../app/types";
import type { WorkspaceInfo } from "../../../app/lib/desktop";
import {
  createOpenworkServerClient,
  normalizeOpenworkServerUrl,
  parseOpenworkWorkspaceIdFromUrl,
  stripOpenworkWorkspaceMount,
  type OpenworkServerClient,
} from "../../../app/lib/openwork-server";
import {
  describeWorkspaceTaskLoadError,
  redactTokenLikeText,
} from "../../../app/utils";

export type RemoteWorkspaceConnectionTarget = {
  kind: "openwork";
  baseUrl: string;
  endpointLabel: string;
  token: string;
  workspaceId: string | null;
};

type TargetResult =
  | { ok: true; target: RemoteWorkspaceConnectionTarget }
  | { ok: false; state: WorkspaceConnectionState };

export type RemoteWorkspaceConnectionResult = {
  ok: boolean;
  state: WorkspaceConnectionState;
  target?: RemoteWorkspaceConnectionTarget;
};

type TestOptions = {
  now?: () => number;
  createClient?: (target: RemoteWorkspaceConnectionTarget) => Pick<
    OpenworkServerClient,
    "health" | "capabilities" | "status" | "listWorkspaces"
  > | Promise<Pick<OpenworkServerClient, "health" | "capabilities" | "status" | "listWorkspaces">>;
};

function trim(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function fail(message: string, checkedAt = Date.now()): RemoteWorkspaceConnectionResult {
  return {
    ok: false,
    state: {
      status: "error",
      message,
      checkedAt,
    },
  };
}

function endpointLabel(baseUrl: string) {
  try {
    const url = new URL(baseUrl);
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.host}${path && path !== "/" ? path : ""}`;
  } catch {
    return baseUrl;
  }
}

function isValidHttpEndpoint(baseUrl: string) {
  try {
    const url = new URL(baseUrl);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.host);
  } catch {
    return false;
  }
}

function describeUnknownError(error: unknown) {
  return describeWorkspaceTaskLoadError(error instanceof Error ? error.message : String(error || "未知错误"));
}

function isServerErrorStatus(error: unknown, status: number | number[]) {
  const expected = Array.isArray(status) ? status : [status];
  const actual =
    error && typeof error === "object" && "status" in error
      ? Number((error as { status?: unknown }).status)
      : NaN;
  return expected.includes(actual);
}

function rejectedTokenMessage(target: RemoteWorkspaceConnectionTarget) {
  return remoteSupportMessage(`服务器 ${target.endpointLabel} 拒绝了登录令牌。请编辑连接并重新连接远程工作环境。`);
}

function remoteSupportMessage(message: string) {
  return `${message} 请确认远程 SeeWayWork 服务已升级到公司批准版本后重试；仍失败时请联系公司管理员。`;
}

export function redactRemoteDiagnosticText(value: string): string {
  return redactTokenLikeText(value);
}

export function getRemoteWorkspaceConnectionKey(workspace: WorkspaceInfo): string {
  return [
    workspace.id,
    workspace.workspaceType,
    workspace.remoteType ?? "",
    trim(workspace.baseUrl),
    trim(workspace.openworkHostUrl),
    trim(workspace.openworkWorkspaceId),
    trim(workspace.openworkToken),
    trim(workspace.openworkClientToken),
    trim(workspace.openworkHostToken),
  ].join("\u001f");
}

function displayWorkspaceName(workspace: unknown) {
  if (!workspace || typeof workspace !== "object") return "";
  const value = workspace as {
    displayName?: string | null;
    openworkWorkspaceName?: string | null;
    name?: string | null;
    id?: string | null;
  };
  return (
    trim(value.displayName) ||
    trim(value.openworkWorkspaceName) ||
    trim(value.name) ||
    trim(value.id)
  );
}

function defaultCreateClient(target: RemoteWorkspaceConnectionTarget) {
  return createOpenworkServerClient({
    baseUrl: target.baseUrl,
    token: target.token || undefined,
  });
}

export function resolveRemoteWorkspaceConnectionTarget(workspace: WorkspaceInfo): TargetResult {
  if (workspace.workspaceType !== "remote") {
    return {
      ok: false,
      state: {
        status: "error",
        message: "只有远程工作区可以进行连接测试。",
        checkedAt: Date.now(),
      },
    };
  }

  if (workspace.remoteType && workspace.remoteType !== "openwork") {
    return {
      ok: false,
      state: {
        status: "error",
        message: "连接诊断仅支持 SeeWayWork 远程工作区。",
        checkedAt: Date.now(),
      },
    };
  }

  const rawHostUrl = trim(workspace.openworkHostUrl) || trim(workspace.baseUrl);
  if (!rawHostUrl) {
    return {
      ok: false,
      state: {
        status: "error",
        message: remoteSupportMessage("缺少远程工作环境地址。请编辑连接并填写服务器地址。"),
        checkedAt: Date.now(),
      },
    };
  }

  const normalizedHostUrl = normalizeOpenworkServerUrl(rawHostUrl);
  if (!normalizedHostUrl || !isValidHttpEndpoint(normalizedHostUrl)) {
    return {
      ok: false,
      state: {
        status: "error",
        message: remoteSupportMessage("远程工作环境地址无效。请编辑连接并填写 http:// 或 https:// 地址。"),
        checkedAt: Date.now(),
      },
    };
  }

  const workspaceId =
    trim(workspace.openworkWorkspaceId) ||
    parseOpenworkWorkspaceIdFromUrl(normalizedHostUrl) ||
    parseOpenworkWorkspaceIdFromUrl(trim(workspace.baseUrl)) ||
    null;
  const hostBaseUrl = stripOpenworkWorkspaceMount(normalizedHostUrl);
  const token =
    trim(workspace.openworkToken) ||
    trim(workspace.openworkClientToken) ||
    trim(workspace.openworkHostToken);

  return {
    ok: true,
    target: {
      kind: "openwork",
      baseUrl: hostBaseUrl,
      endpointLabel: endpointLabel(hostBaseUrl),
      token,
      workspaceId,
    },
  };
}

export async function testRemoteWorkspaceConnection(
  workspace: WorkspaceInfo,
  options: TestOptions = {},
): Promise<RemoteWorkspaceConnectionResult> {
  const checkedAt = options.now?.() ?? Date.now();
  const targetResult = resolveRemoteWorkspaceConnectionTarget(workspace);
  if (!targetResult.ok) {
    return {
      ok: false,
      state: {
        ...targetResult.state,
        checkedAt,
      },
    };
  }

  const { target } = targetResult;
  const client = await (options.createClient?.(target) ?? defaultCreateClient(target));

  try {
    const health = await client.health();
    if (!health?.ok) {
      return fail(
        remoteSupportMessage(`无法连接 ${target.endpointLabel}，健康检查返回异常状态。`),
        checkedAt,
      );
    }
  } catch (error) {
    return fail(
      remoteSupportMessage(`无法连接 ${target.endpointLabel}，健康检查失败：${describeUnknownError(error)}`),
      checkedAt,
    );
  }

  if (!target.token) {
    return fail(
      remoteSupportMessage(`${target.endpointLabel} 缺少登录令牌。请编辑连接并填写有效的 SeeWayWork 令牌。`),
      checkedAt,
    );
  }

  try {
    await client.capabilities();
  } catch (error) {
    if (isServerErrorStatus(error, [401, 403])) {
      return fail(rejectedTokenMessage(target), checkedAt);
    }
    return fail(
      remoteSupportMessage(`已连接 ${target.endpointLabel}，但读取服务能力失败：${describeUnknownError(error)}`),
      checkedAt,
    );
  }

  if (target.workspaceId) {
    try {
      const list = await client.listWorkspaces();
      const workspace = list.items.find((item) => item.id === target.workspaceId) ?? null;
      if (!workspace) {
        return fail(
          remoteSupportMessage(`服务器 ${target.endpointLabel} 中没有找到工作区 ${target.workspaceId}。请重新连接远程工作环境。`),
          checkedAt,
        );
      }
      const name = displayWorkspaceName(workspace) || target.workspaceId;
      return {
        ok: true,
        target,
        state: {
          status: "connected",
          message: `已连接到 ${name}。`,
          checkedAt,
        },
      };
    } catch (error) {
      if (isServerErrorStatus(error, 403)) {
        return fail(
          remoteSupportMessage(`工作区 ${target.workspaceId} 无权访问 ${target.endpointLabel}。请检查令牌或服务器权限设置。`),
          checkedAt,
        );
      }
      return fail(
        remoteSupportMessage(`已连接 ${target.endpointLabel}，但读取工作区列表失败：${describeUnknownError(error)}`),
        checkedAt,
      );
    }
  }

  try {
    const list = await client.listWorkspaces();
    const active =
      list.items.find((item) => item.id === list.activeId) ??
      list.items[0] ??
      null;
    const name = displayWorkspaceName(active) || target.endpointLabel;
    return {
      ok: true,
      target,
      state: {
        status: "connected",
        message: `已连接到 ${name}。`,
        checkedAt,
      },
    };
  } catch (error) {
    if (isServerErrorStatus(error, [401, 403])) {
      return fail(rejectedTokenMessage(target), checkedAt);
    }
    return fail(
      remoteSupportMessage(`已连接 ${target.endpointLabel}，但读取工作区列表失败：${describeUnknownError(error)}`),
      checkedAt,
    );
  }
}

export async function diagnoseRemoteWorkspaceTaskLoadFailure(
  workspace: WorkspaceInfo,
  taskLoadError: string,
  options: TestOptions = {},
): Promise<WorkspaceConnectionState> {
  const checkedAt = options.now?.() ?? Date.now();
  const fallback = describeWorkspaceTaskLoadError(trim(taskLoadError) || "远程工作环境连接失败。");

  try {
    const diagnostic = await testRemoteWorkspaceConnection(workspace, options);
    if (diagnostic.ok) {
      return {
        status: "error",
        message: `远程工作环境可以连接，但任务加载失败：${fallback}`,
        checkedAt: diagnostic.state.checkedAt ?? checkedAt,
      };
    }

    return {
      status: "error",
      message: diagnostic.state.message?.trim() || fallback,
      checkedAt: diagnostic.state.checkedAt ?? checkedAt,
    };
  } catch (error) {
    return {
      status: "error",
      message: fallback || describeUnknownError(error),
      checkedAt,
    };
  }
}
