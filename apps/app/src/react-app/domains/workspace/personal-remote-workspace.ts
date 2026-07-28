import {
  DenApiError,
  type DenWorkerSummary,
  type DenWorkerTokens,
} from "@/app/lib/den";
import type { WorkspaceInfo, WorkspaceList } from "@/app/lib/desktop";
import { stripOpenworkWorkspaceMount } from "@/app/lib/openwork-server";

export const PERSONAL_REMOTE_WORKSPACE_NAME = "我的远程工作区";
export const PERSONAL_REMOTE_WORKSPACE_BACKEND = "den-worker";
export const PERSONAL_REMOTE_WORKSPACE_IDEMPOTENCY_KEY = "foxwork-personal-remote-workspace-v1";
export const PERSONAL_REMOTE_WORKSPACE_RETRY_MS = 5_000;

type PersonalRemoteWorkspaceDenClient = {
  listWorkers: (orgId: string, limit?: number) => Promise<DenWorkerSummary[]>;
  createWorker: (
    orgId: string,
    input: {
      name: string;
      destination: "cloud";
      sandboxBackend: string;
      idempotencyKey: string;
    },
  ) => Promise<DenWorkerSummary>;
  getWorkerTokens: (workerId: string, orgId: string) => Promise<DenWorkerTokens>;
};

type RemoteWorkspacePayload = {
  baseUrl: string;
  remoteType: "openwork";
  displayName: string;
  openworkHostUrl: string;
  openworkToken: string;
  openworkClientToken: string;
  openworkWorkspaceId: string;
  openworkWorkspaceName: string;
  sandboxBackend: string;
  sandboxRunId: string;
};

export type PersonalRemoteWorkspaceReconcileResult =
  | { status: "provisioning"; workerId: string; removedWorkspaceIds?: string[] }
  | {
      status: "ready";
      workerId: string;
      workspaceId: string;
      created: boolean;
      removedWorkspaceIds?: string[];
    };

function workerStatusPriority(worker: DenWorkerSummary) {
  if (worker.status === "healthy") return 0;
  if (worker.status === "provisioning") return 1;
  return 2;
}

export function selectPersonalWorker(workers: DenWorkerSummary[]) {
  const ownedWorkers = workers.filter((worker) => worker.isMine);
  const managedWorkers = ownedWorkers.filter(
    (worker) => worker.sandboxBackend === PERSONAL_REMOTE_WORKSPACE_BACKEND,
  );
  const candidates = managedWorkers.length > 0
    ? managedWorkers
    : ownedWorkers.filter((worker) => (
        worker.sandboxBackend === null && worker.workerName === PERSONAL_REMOTE_WORKSPACE_NAME
      ));

  return candidates
    .sort((left, right) => {
      const statusDifference = workerStatusPriority(left) - workerStatusPriority(right);
      if (statusDifference !== 0) return statusDifference;
      return (left.createdAt ?? "").localeCompare(right.createdAt ?? "");
    })[0] ?? null;
}

function findManagedWorkspace(workspaces: WorkspaceInfo[], worker: DenWorkerSummary, workspaceId: string) {
  return workspaces.find((workspace) => (
    workspace.workspaceType === "remote" &&
    (
      (
        workspace.sandboxBackend === PERSONAL_REMOTE_WORKSPACE_BACKEND &&
        workspace.sandboxRunId === worker.workerId
      ) ||
      workspace.openworkWorkspaceId === workspaceId
    )
  )) ?? null;
}

function workspaceIdFromList(list: WorkspaceList, workerId: string, serverWorkspaceId: string) {
  const workspace = list.workspaces.find((item) => (
    item.sandboxBackend === PERSONAL_REMOTE_WORKSPACE_BACKEND &&
    item.sandboxRunId === workerId
  )) ?? list.workspaces.find((item) => item.openworkWorkspaceId === serverWorkspaceId);
  return workspace?.id ?? null;
}

function toRemoteWorkspacePayload(worker: DenWorkerSummary, tokens: DenWorkerTokens): RemoteWorkspacePayload | null {
  const baseUrl = stripOpenworkWorkspaceMount(tokens.openworkUrl?.trim() ?? "");
  const clientToken = tokens.clientToken?.trim() ?? "";
  const workspaceId = tokens.workspaceId?.trim() ?? "";
  if (!baseUrl || !clientToken || !workspaceId) return null;

  return {
    baseUrl,
    remoteType: "openwork",
    displayName: PERSONAL_REMOTE_WORKSPACE_NAME,
    openworkHostUrl: baseUrl,
    openworkToken: clientToken,
    openworkClientToken: clientToken,
    openworkWorkspaceId: workspaceId,
    openworkWorkspaceName: PERSONAL_REMOTE_WORKSPACE_NAME,
    sandboxBackend: PERSONAL_REMOTE_WORKSPACE_BACKEND,
    sandboxRunId: worker.workerId,
  };
}

export async function reconcilePersonalRemoteWorkspace(input: {
  denClient: PersonalRemoteWorkspaceDenClient;
  orgId: string;
  workspaces: WorkspaceInfo[];
  removeRemoteWorkspace: (workspaceId: string) => Promise<WorkspaceList>;
  createRemoteWorkspace: (payload: RemoteWorkspacePayload) => Promise<WorkspaceList>;
  updateRemoteWorkspace: (
    payload: RemoteWorkspacePayload & { workspaceId: string },
  ) => Promise<WorkspaceList>;
}): Promise<PersonalRemoteWorkspaceReconcileResult> {
  let worker = selectPersonalWorker(await input.denClient.listWorkers(input.orgId, 50));
  if (!worker) {
    try {
      worker = await input.denClient.createWorker(input.orgId, {
        name: PERSONAL_REMOTE_WORKSPACE_NAME,
        destination: "cloud",
        sandboxBackend: PERSONAL_REMOTE_WORKSPACE_BACKEND,
        idempotencyKey: PERSONAL_REMOTE_WORKSPACE_IDEMPOTENCY_KEY,
      });
    } catch (error) {
      if (!(error instanceof DenApiError) || error.status !== 409) throw error;
      worker = selectPersonalWorker(await input.denClient.listWorkers(input.orgId, 50));
      if (!worker) throw error;
    }
  }

  const staleWorkspaceIds = input.workspaces
    .filter((workspace) => (
      workspace.workspaceType === "remote" &&
      workspace.sandboxBackend === PERSONAL_REMOTE_WORKSPACE_BACKEND &&
      workspace.sandboxRunId !== worker.workerId
    ))
    .map((workspace) => workspace.id);
  let currentWorkspaces = input.workspaces;
  for (const workspaceId of staleWorkspaceIds) {
    const nextList = await input.removeRemoteWorkspace(workspaceId);
    currentWorkspaces = nextList.workspaces.filter((workspace) => workspace.id !== workspaceId);
  }
  const removedWorkspaceResult = staleWorkspaceIds.length > 0
    ? { removedWorkspaceIds: staleWorkspaceIds }
    : {};

  if (worker.status === "failed") {
    throw new Error("个人远程工作区准备失败，请联系公司管理员检查服务器状态。");
  }
  if (worker.status !== "healthy" || !worker.instanceUrl) {
    return { status: "provisioning", workerId: worker.workerId, ...removedWorkspaceResult };
  }

  let tokens: DenWorkerTokens;
  try {
    tokens = await input.denClient.getWorkerTokens(worker.workerId, input.orgId);
  } catch (error) {
    if (error instanceof DenApiError && error.status === 409) {
      return { status: "provisioning", workerId: worker.workerId, ...removedWorkspaceResult };
    }
    throw error;
  }

  const payload = toRemoteWorkspacePayload(worker, tokens);
  if (!payload) {
    return { status: "provisioning", workerId: worker.workerId, ...removedWorkspaceResult };
  }

  const existing = findManagedWorkspace(currentWorkspaces, worker, payload.openworkWorkspaceId);
  const list = existing
    ? await input.updateRemoteWorkspace({ ...payload, workspaceId: existing.id })
    : await input.createRemoteWorkspace(payload);
  const workspaceId = workspaceIdFromList(list, worker.workerId, payload.openworkWorkspaceId);
  if (!workspaceId) {
    throw new Error("个人远程工作区已连接，但 FoxWork 未能保存工作区信息，请重试。");
  }

  return {
    status: "ready",
    workerId: worker.workerId,
    workspaceId,
    created: !existing,
    ...removedWorkspaceResult,
  };
}
