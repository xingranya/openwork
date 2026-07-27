export type OpenSessionTab = {
  workspaceId: string;
  sessionId: string;
};

export type CloseOpenSessionTabResult = {
  tabs: OpenSessionTab[];
  nextTab: OpenSessionTab | null;
};

export type OpenSessionTabWorkspaceSnapshot = {
  workspaceId: string;
  status: "idle" | "loading" | "ready" | "error";
  sessionIds: readonly string[];
};

type SessionTabStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const OPEN_SESSION_TABS_STORAGE_KEY = "openwork.react.sessionTabs.v1";

function normalizeOpenSessionTab(value: unknown): OpenSessionTab | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const workspaceId = Reflect.get(value, "workspaceId");
  const sessionId = Reflect.get(value, "sessionId");
  if (typeof workspaceId !== "string" || typeof sessionId !== "string") return null;
  const normalizedWorkspaceId = workspaceId.trim();
  const normalizedSessionId = sessionId.trim();
  if (!normalizedWorkspaceId || !normalizedSessionId) return null;
  return {
    workspaceId: normalizedWorkspaceId,
    sessionId: normalizedSessionId,
  };
}

function openSessionTabKey(workspaceId: string, sessionId: string) {
  return `${workspaceId}\u0000${sessionId}`;
}

function normalizeOpenSessionTabs(tabs: readonly OpenSessionTab[]): OpenSessionTab[] {
  const seen = new Set<string>();
  const result: OpenSessionTab[] = [];
  for (const value of tabs) {
    const tab = normalizeOpenSessionTab(value);
    if (!tab) continue;
    const key = openSessionTabKey(tab.workspaceId, tab.sessionId);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tab);
  }
  return result;
}

function browserSessionTabStorage(): SessionTabStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 读取会话标签恢复列表。损坏或旧格式数据会被忽略。 */
export function readOpenSessionTabs(storage = browserSessionTabStorage()): OpenSessionTab[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(OPEN_SESSION_TABS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeOpenSessionTabs(parsed.flatMap((value) => {
      const tab = normalizeOpenSessionTab(value);
      return tab ? [tab] : [];
    }));
  } catch {
    return [];
  }
}

/** 写入会话标签恢复列表。空列表会直接删除持久化键。 */
export function writeOpenSessionTabs(
  tabs: readonly OpenSessionTab[],
  storage = browserSessionTabStorage(),
): void {
  if (!storage) return;
  const normalized = normalizeOpenSessionTabs(tabs);
  try {
    if (normalized.length === 0) {
      storage.removeItem(OPEN_SESSION_TABS_STORAGE_KEY);
      return;
    }
    storage.setItem(OPEN_SESSION_TABS_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // 隐私模式或存储空间不足时保留内存状态，不中断会话。
  }
}

/** 在指定工作区末尾打开标签，已存在时保持原有顺序。 */
export function addOpenSessionTab(
  tabs: readonly OpenSessionTab[],
  workspaceId: string,
  sessionId: string,
): OpenSessionTab[] {
  const normalized = normalizeOpenSessionTabs(tabs);
  const tab = normalizeOpenSessionTab({ workspaceId, sessionId });
  if (!tab) return normalized;
  const key = openSessionTabKey(tab.workspaceId, tab.sessionId);
  if (normalized.some((item) => openSessionTabKey(item.workspaceId, item.sessionId) === key)) {
    return normalized;
  }
  return [...normalized, tab];
}

/**
 * 关闭指定工作区中的会话标签，并按“优先右侧、否则左侧”选择相邻标签。
 * 相同会话编号可能同时存在于本地和远程工作区，因此删除必须带工作区范围。
 */
export function closeOpenSessionTab(
  tabs: readonly OpenSessionTab[],
  workspaceId: string,
  sessionId: string,
): CloseOpenSessionTabResult {
  const normalized = normalizeOpenSessionTabs(tabs);
  const normalizedWorkspaceId = workspaceId.trim();
  const normalizedSessionId = sessionId.trim();
  const workspaceTabs = normalized.filter((tab) => tab.workspaceId === normalizedWorkspaceId);
  const closingIndex = workspaceTabs.findIndex((tab) => tab.sessionId === normalizedSessionId);
  const nextTabs = normalized.filter((tab) => !(
    tab.workspaceId === normalizedWorkspaceId && tab.sessionId === normalizedSessionId
  ));

  if (closingIndex < 0) {
    return { tabs: normalized, nextTab: null };
  }

  const remainingWorkspaceTabs = nextTabs.filter((tab) => tab.workspaceId === normalizedWorkspaceId);
  const nextTab = remainingWorkspaceTabs[
    Math.min(closingIndex, remainingWorkspaceTabs.length - 1)
  ] ?? null;

  return { tabs: nextTabs, nextTab };
}

/** 关闭同一工作区中的其他标签，其他工作区不受影响。 */
export function closeOtherOpenSessionTabs(
  tabs: readonly OpenSessionTab[],
  workspaceId: string,
  sessionId: string,
): CloseOpenSessionTabResult {
  const normalized = normalizeOpenSessionTabs(tabs);
  const target = normalizeOpenSessionTab({ workspaceId, sessionId });
  if (!target) return { tabs: normalized, nextTab: null };
  const nextTabs = normalized.filter((tab) => (
    tab.workspaceId !== target.workspaceId || tab.sessionId === target.sessionId
  ));
  const nextTab = nextTabs.find((tab) => (
    tab.workspaceId === target.workspaceId && tab.sessionId === target.sessionId
  )) ?? null;
  return { tabs: nextTabs, nextTab };
}

/** 关闭指定工作区的全部标签，其他工作区不受影响。 */
export function closeAllOpenSessionTabs(
  tabs: readonly OpenSessionTab[],
  workspaceId: string,
): CloseOpenSessionTabResult {
  const normalizedWorkspaceId = workspaceId.trim();
  const normalized = normalizeOpenSessionTabs(tabs);
  return {
    tabs: normalized.filter((tab) => tab.workspaceId !== normalizedWorkspaceId),
    nextTab: null,
  };
}

/** 从标签恢复列表中移除整个工作区。 */
export function forgetOpenSessionTabsForWorkspace(
  tabs: readonly OpenSessionTab[],
  workspaceId: string,
): OpenSessionTab[] {
  const normalizedWorkspaceId = workspaceId.trim();
  if (!normalizedWorkspaceId) return normalizeOpenSessionTabs(tabs);
  return normalizeOpenSessionTabs(tabs).filter((tab) => tab.workspaceId !== normalizedWorkspaceId);
}

/**
 * 用已加载的会话列表校准标签：只清理服务端已确认不存在的会话；加载中、
 * 断网或错误状态继续保留，以免网络抖动造成标签丢失。
 */
export function reconcileOpenSessionTabs(
  tabs: readonly OpenSessionTab[],
  snapshots: readonly OpenSessionTabWorkspaceSnapshot[],
  activeWorkspaceId: string,
  activeSessionId: string | null | undefined,
  suppressedTabKeys: readonly string[] = [],
): OpenSessionTab[] {
  const snapshotByWorkspace = new Map(snapshots.flatMap((snapshot) => {
    const workspaceId = snapshot.workspaceId.trim();
    return workspaceId ? [[workspaceId, snapshot] as const] : [];
  }));
  const activeTab = normalizeOpenSessionTab({
    workspaceId: activeWorkspaceId,
    sessionId: activeSessionId ?? "",
  });
  const suppressed = new Set(suppressedTabKeys);
  const normalized = normalizeOpenSessionTabs(tabs);
  const next = normalized.filter((tab) => {
    const snapshot = snapshotByWorkspace.get(tab.workspaceId);
    if (!snapshot || snapshot.status !== "ready") return true;
    if (snapshot.sessionIds.includes(tab.sessionId)) return true;
    return Boolean(
      activeTab &&
      activeTab.workspaceId === tab.workspaceId &&
      activeTab.sessionId === tab.sessionId,
    );
  });

  if (!activeTab) return next;
  const activeKey = openSessionTabKey(activeTab.workspaceId, activeTab.sessionId);
  if (suppressed.has(activeKey)) {
    return next.filter((tab) => openSessionTabKey(tab.workspaceId, tab.sessionId) !== activeKey);
  }
  return addOpenSessionTab(next, activeTab.workspaceId, activeTab.sessionId);
}
