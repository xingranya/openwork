/** @jsxImportSource react */
import { useCallback, useMemo } from "react";

import type { createClient } from "../../../../app/lib/opencode";
import type { OpenworkServerClient, OpenworkWorkspaceInfo } from "../../../../app/lib/openwork-server";
import { setSessionArchived } from "../../../../app/lib/opencode-session";
import { getDisplaySessionTitle } from "../../../../app/lib/session-title";
import { useControlAction, type OpenworkControlAction } from "../../../shell/control/control-provider";
import { useSessionManagementStore } from "../sidebar/session-management-store";
import { useWorkbenchStore } from "../chat/workbench-store";

type SessionLike = {
  id?: string;
  title?: string;
  time?: {
    updated?: number;
    created?: number;
  };
};

type SessionControlWorkspace = OpenworkWorkspaceInfo & {
  displayNameResolved?: string;
};

type UseSessionControlActionsInput = {
  workspaces: SessionControlWorkspace[];
  sessionsByWorkspaceId: Record<string, SessionLike[]>;
  selectedWorkspaceId: string;
  selectedWorkspaceRoot: string;
  selectedSessionId: string | null;
  canCreateTask: boolean;
  openworkClient: OpenworkServerClient | null;
  opencodeClient: ReturnType<typeof createClient> | null;
  navigateToSession: (sessionId: string) => void;
  navigateToSessionRoot: () => void;
  createTaskInWorkspace: (workspaceId: string) => Promise<unknown> | unknown;
  openModelPicker: () => void;
  refreshRouteState: () => Promise<unknown> | unknown;
};

function workspaceLabel(workspace: SessionControlWorkspace) {
  return workspace.displayName?.trim() || workspace.name?.trim() || workspace.path?.trim() || "工作区";
}

function findSessionWorkspace(
  workspaces: SessionControlWorkspace[],
  sessionsByWorkspaceId: Record<string, SessionLike[]>,
  sessionId: string,
) {
  return workspaces.find((workspace) => (
    sessionsByWorkspaceId[workspace.id] ?? []
  ).some((session) => session.id === sessionId));
}

function objectArgs(args: unknown) {
  return args && typeof args === "object" ? args as Record<string, unknown> : {};
}

function stringArg(args: unknown, name: string) {
  const value = objectArgs(args)[name];
  return typeof value === "string" ? value.trim() : "";
}

function booleanArg(args: unknown, name: string) {
  return objectArgs(args)[name] === true;
}

export function useSessionControlActions(input: UseSessionControlActionsInput) {
  const {
    canCreateTask,
    createTaskInWorkspace,
    navigateToSession,
    navigateToSessionRoot,
    openModelPicker,
    openworkClient,
    opencodeClient,
    refreshRouteState,
    selectedSessionId,
    selectedWorkspaceId,
    selectedWorkspaceRoot,
    sessionsByWorkspaceId,
    workspaces,
  } = input;

  const createTaskControlAction = useMemo<OpenworkControlAction>(() => ({
    id: "session.create_task",
    label: "新建任务",
    description: "在当前工作区中新建会话。",
    sideEffect: "mutation",
    disabled: !canCreateTask || !selectedWorkspaceId,
    execute: async () => {
      if (!selectedWorkspaceId) return false;
      await createTaskInWorkspace(selectedWorkspaceId);
      return true;
    },
  }), [canCreateTask, createTaskInWorkspace, selectedWorkspaceId]);
  useControlAction(createTaskControlAction);

  const listSessionsControlAction = useMemo<OpenworkControlAction>(() => ({
    id: "session.list_sessions",
    label: "列出可用会话",
    description: "列出各工作区的会话，以便按名称打开。",
    sideEffect: "none",
    execute: () => {
      const out: { sessionId: string; title: string; workspace: string; updatedAt: number }[] = [];
      for (const workspace of workspaces) {
        const list = sessionsByWorkspaceId[workspace.id] ?? [];
        for (const session of list) {
          const sessionId = session.id?.trim() ?? "";
          if (!sessionId) continue;
          const title = getDisplaySessionTitle(session.title ?? "");
          const updatedAt = session.time?.updated ?? session.time?.created ?? 0;
          out.push({ sessionId, title, workspace: workspaceLabel(workspace), updatedAt });
        }
      }
      out.sort((a, b) => b.updatedAt - a.updatedAt);
      return out.slice(0, 30);
    },
  }), [sessionsByWorkspaceId, workspaces]);
  useControlAction(listSessionsControlAction);

  const openSessionControlAction = useMemo<OpenworkControlAction>(() => ({
    id: "session.open",
    label: "按 ID 打开会话",
    description: "打开指定会话，可先列出会话以取得会话 ID。",
    sideEffect: "navigation",
    requiresArgs: true,
    args: [{ name: "sessionId", type: "string", required: true, description: "会话列表返回的会话 ID。" }],
    execute: (args) => {
      const sessionId = stringArg(args, "sessionId");
      if (!sessionId) return { ok: false, error: "必须提供 sessionId。" };
      const targetWorkspace = findSessionWorkspace(workspaces, sessionsByWorkspaceId, sessionId);
      const workbench = useWorkbenchStore.getState();
      if (targetWorkspace?.id === workbench.workspaceId) {
        if (sessionId === workbench.primarySessionId) {
          workbench.focusPane("primary");
          return { ok: true, sessionId, reused: "primary-pane" };
        }
        if (sessionId === workbench.splitSessionId) {
          workbench.focusPane("secondary");
          return { ok: true, sessionId, reused: "secondary-pane" };
        }
      }
      navigateToSession(sessionId);
      return {
        ok: true,
        sessionId,
        reused: workbench.tabs.some((tab) => tab.sessionId === sessionId) ? "tab" : "new-tab",
      };
    },
  }), [navigateToSession, sessionsByWorkspaceId, workspaces]);
  useControlAction(openSessionControlAction);

  const renameSessionControlAction = useMemo<OpenworkControlAction>(() => ({
    id: "session.rename",
    label: "重命名会话",
    description: "按 ID 重命名会话，可先列出会话以核对名称。",
    sideEffect: "mutation",
    requiresArgs: true,
    args: [
      { name: "sessionId", type: "string", required: true, description: "会话列表返回的会话 ID。" },
      { name: "title", type: "string", required: true, description: "新的会话标题。" },
    ],
    disabled: !opencodeClient,
    execute: async (args) => {
      const sessionId = stringArg(args, "sessionId");
      const title = stringArg(args, "title");
      if (!sessionId) return { ok: false, error: "必须提供 sessionId。" };
      if (!title) return { ok: false, error: "必须提供会话标题。" };
      if (!opencodeClient) return { ok: false, error: "工作区运行环境尚未连接。" };

      const targetWorkspace = findSessionWorkspace(workspaces, sessionsByWorkspaceId, sessionId);
      await opencodeClient.session.update({
        sessionID: sessionId,
        title,
        directory: targetWorkspace?.path || selectedWorkspaceRoot || undefined,
      });
      await refreshRouteState();
      return { ok: true, sessionId, title };
    },
  }), [opencodeClient, refreshRouteState, selectedWorkspaceRoot, sessionsByWorkspaceId, workspaces]);
  useControlAction(renameSessionControlAction);

  const deleteSessionControlAction = useMemo<OpenworkControlAction>(() => ({
    id: "session.delete",
    label: "删除会话",
    description: "按 ID 删除会话。此操作不可撤销，必须先得到用户明确确认。",
    sideEffect: "mutation",
    requiresArgs: true,
    requiresConfirmation: true,
    args: [
      { name: "sessionId", type: "string", required: true, description: "会话列表返回的会话 ID。" },
      { name: "confirmed", type: "boolean", required: true, description: "用户明确确认后必须设为 true。" },
    ],
    disabled: !openworkClient,
    execute: async (args) => {
      const sessionId = stringArg(args, "sessionId");
      const confirmed = booleanArg(args, "confirmed");
      if (!sessionId) return { ok: false, error: "必须提供 sessionId。" };
      if (!confirmed) return { ok: false, error: "删除前必须得到用户明确确认，并将 confirmed 设为 true。" };
      if (!openworkClient) return { ok: false, error: "SeeWayWork 服务尚未连接。" };

      const targetWorkspace = findSessionWorkspace(workspaces, sessionsByWorkspaceId, sessionId);
      if (!targetWorkspace) return { ok: false, error: "当前会话列表中未找到该会话。" };
      await openworkClient.deleteSession(targetWorkspace.id, sessionId);
      if (selectedSessionId === sessionId) {
        navigateToSessionRoot();
      }
      await refreshRouteState();
      return { ok: true, sessionId, deleted: true };
    },
  }), [navigateToSessionRoot, openworkClient, refreshRouteState, selectedSessionId, sessionsByWorkspaceId, workspaces]);
  useControlAction(deleteSessionControlAction);

  const modelPickerControlAction = useMemo<OpenworkControlAction>(() => ({
    id: "session.model_picker.open",
    label: "打开模型选择器",
    description: "打开当前会话的模型选择器。",
    sideEffect: "none",
    disabled: !selectedWorkspaceId,
    execute: openModelPicker,
  }), [openModelPicker, selectedWorkspaceId]);
  useControlAction(modelPickerControlAction);

  // ---------------------------------------------------------------------------
  // Session management control actions (pin, archive, groups)
  // ---------------------------------------------------------------------------

  const store = useSessionManagementStore;

  /** Resolve a workspace ID from user input. Falls back to selectedWorkspaceId
   *  if the input is empty or doesn't match any known workspace (e.g. if the
   *  caller passes a display name instead of the actual ID). */
  const resolveWorkspaceId = useCallback((input: string | undefined): string | undefined => {
    if (!input) return selectedWorkspaceId || undefined;
    // Exact match on ID.
    if (workspaces.some((ws) => ws.id === input)) return input;
    // Fuzzy match on display name / path — return the first matching workspace ID.
    const byName = workspaces.find(
      (ws) =>
        (ws.displayName?.trim() || ws.name?.trim() || ws.path?.trim() || "").toLowerCase() === input.toLowerCase(),
    );
    if (byName) return byName.id;
    // Unknown — fall back to selected.
    return selectedWorkspaceId || undefined;
  }, [selectedWorkspaceId, workspaces]);

  const pinControlAction = useMemo<OpenworkControlAction>(() => ({
    id: "session.pin",
    label: "置顶或取消置顶会话",
    description: "切换会话置顶状态，置顶会话会显示在侧栏顶部。",
    sideEffect: "mutation",
    requiresArgs: true,
    args: [{ name: "sessionId", type: "string", required: true, description: "要切换置顶状态的会话 ID。" }],
    execute: (args) => {
      const sessionId = stringArg(args, "sessionId");
      if (!sessionId) return { ok: false, error: "必须提供 sessionId。" };
      store.getState().togglePin(sessionId);
      const pinned = store.getState().pinnedIds.includes(sessionId);
      return { ok: true, sessionId, pinned };
    },
  }), []);
  useControlAction(pinControlAction);

  const archiveControlAction = useMemo<OpenworkControlAction>(() => ({
    id: "session.archive",
    label: "归档或取消归档会话",
    description: "归档会话但保留上下文；将 archived 设为 false 可取消归档。",
    sideEffect: "mutation",
    requiresArgs: true,
    args: [
      { name: "sessionId", type: "string", required: true, description: "会话 ID。" },
      { name: "archived", type: "boolean", required: true, description: "true 表示归档，false 表示取消归档。" },
    ],
    disabled: !opencodeClient,
    execute: async (args) => {
      const sessionId = stringArg(args, "sessionId");
      const archived = booleanArg(args, "archived");
      if (!sessionId) return { ok: false, error: "必须提供 sessionId。" };
      if (!opencodeClient) return { ok: false, error: "工作区运行环境尚未连接。" };
      const targetWorkspace = findSessionWorkspace(workspaces, sessionsByWorkspaceId, sessionId);
      await setSessionArchived(opencodeClient, sessionId, archived, targetWorkspace?.path || selectedWorkspaceRoot || undefined);
      await refreshRouteState();
      return { ok: true, sessionId, archived };
    },
  }), [opencodeClient, refreshRouteState, selectedWorkspaceRoot, sessionsByWorkspaceId, workspaces]);
  useControlAction(archiveControlAction);

  const groupCreateControlAction = useMemo<OpenworkControlAction>(() => ({
    id: "session.group.create",
    label: "创建会话分组",
    description: "在当前工作区侧栏中创建分组，之后可将会话移入其中。",
    sideEffect: "mutation",
    requiresArgs: true,
    args: [
      { name: "label", type: "string", required: true, description: "分组名称，例如“已完成”“进行中”“待处理”。" },
      { name: "workspaceId", type: "string", required: false, description: "工作区 ID，默认使用当前工作区。" },
    ],
    disabled: !selectedWorkspaceId,
    execute: (args) => {
      const label = stringArg(args, "label");
      const wsId = resolveWorkspaceId(stringArg(args, "workspaceId"));
      if (!label) return { ok: false, error: "必须提供分组名称。" };
      if (!wsId) return { ok: false, error: "尚未选择工作区。" };
      store.getState().createGroup(wsId, label);
      const created = store.getState().groupsByWorkspace[wsId];
      const newGroup = created?.groups[created.groups.length - 1];
      return { ok: true, workspaceId: wsId, label, groupId: newGroup?.id ?? null };
    },
  }), [resolveWorkspaceId]);
  useControlAction(groupCreateControlAction);

  const groupMoveControlAction = useMemo<OpenworkControlAction>(() => ({
    id: "session.group.move",
    label: "将会话移入分组",
    description: "将会话分配到分组；省略 groupId 或传入 null 可移出当前分组。",
    sideEffect: "mutation",
    requiresArgs: true,
    args: [
      { name: "sessionId", type: "string", required: true, description: "会话 ID。" },
      { name: "groupId", type: "string", required: false, description: "目标分组 ID，省略或传入 null 表示不分组。" },
      { name: "workspaceId", type: "string", required: false, description: "工作区 ID，默认使用会话所在工作区。" },
    ],
    execute: (args) => {
      const sessionId = stringArg(args, "sessionId");
      const groupId = stringArg(args, "groupId") || null;
      if (!sessionId) return { ok: false, error: "必须提供 sessionId。" };
      const targetWorkspace = findSessionWorkspace(workspaces, sessionsByWorkspaceId, sessionId);
      const wsId = resolveWorkspaceId(stringArg(args, "workspaceId")) || targetWorkspace?.id;
      if (!wsId) return { ok: false, error: "无法确定会话所在的工作区。" };
      store.getState().assignGroup(wsId, sessionId, groupId);
      return { ok: true, sessionId, groupId, workspaceId: wsId };
    },
  }), [resolveWorkspaceId, sessionsByWorkspaceId, workspaces]);
  useControlAction(groupMoveControlAction);

  const groupRemoveControlAction = useMemo<OpenworkControlAction>(() => ({
    id: "session.group.remove",
    label: "删除会话分组",
    description: "从工作区移除分组，组内会话不会删除，只会变为未分组。",
    sideEffect: "mutation",
    requiresConfirmation: true,
    requiresArgs: true,
    args: [
      { name: "groupId", type: "string", required: true, description: "要删除的分组 ID。" },
      { name: "workspaceId", type: "string", required: false, description: "工作区 ID，默认使用当前工作区。" },
      { name: "confirmed", type: "boolean", required: true, description: "确认后必须设为 true。" },
    ],
    disabled: !selectedWorkspaceId,
    execute: (args) => {
      const groupId = stringArg(args, "groupId");
      const confirmed = booleanArg(args, "confirmed");
      const wsId = resolveWorkspaceId(stringArg(args, "workspaceId"));
      if (!groupId) return { ok: false, error: "必须提供 groupId。" };
      if (!confirmed) return { ok: false, error: "必须确认操作，并将 confirmed 设为 true。" };
      if (!wsId) return { ok: false, error: "尚未选择工作区。" };
      store.getState().removeGroup(wsId, groupId);
      return { ok: true, groupId, workspaceId: wsId };
    },
  }), [resolveWorkspaceId]);
  useControlAction(groupRemoveControlAction);

  const groupListControlAction = useMemo<OpenworkControlAction>(() => ({
    id: "session.group.list",
    label: "列出会话分组",
    description: "列出工作区中的全部分组及其 ID 和名称。",
    sideEffect: "none",
    args: [{ name: "workspaceId", type: "string", required: false, description: "工作区 ID，默认使用当前工作区。" }],
    execute: (args) => {
      const wsId = resolveWorkspaceId(stringArg(args, "workspaceId"));
      if (!wsId) return { ok: false, error: "尚未选择工作区。" };
      const state = store.getState().groupsByWorkspace[wsId];
      return {
        ok: true,
        workspaceId: wsId,
        groups: (state?.groups ?? []).map((g) => ({ id: g.id, label: g.label })),
        assignments: state?.assignments ?? {},
      };
    },
  }), [resolveWorkspaceId]);
  useControlAction(groupListControlAction);
}
