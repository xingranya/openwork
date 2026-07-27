import { describe, expect, test } from "bun:test";

import {
  addOpenSessionTab,
  closeAllOpenSessionTabs,
  closeOpenSessionTab,
  closeOtherOpenSessionTabs,
  forgetOpenSessionTabsForWorkspace,
  readOpenSessionTabs,
  reconcileOpenSessionTabs,
  writeOpenSessionTabs,
  type OpenSessionTab,
} from "../src/react-app/domains/session/chat/session-tab-state";

function tabs(...sessionIds: string[]): OpenSessionTab[] {
  return sessionIds.map((sessionId) => ({ workspaceId: "ws_company", sessionId }));
}

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("会话标签页关闭", () => {
  test("关闭中间标签页后选择右侧相邻标签页", () => {
    expect(closeOpenSessionTab(tabs("ses_a", "ses_b", "ses_c"), "ws_company", "ses_b")).toEqual({
      tabs: tabs("ses_a", "ses_c"),
      nextTab: { workspaceId: "ws_company", sessionId: "ses_c" },
    });
  });

  test("关闭末尾标签页后选择左侧相邻标签页", () => {
    expect(closeOpenSessionTab(tabs("ses_a", "ses_b", "ses_c"), "ws_company", "ses_c")).toEqual({
      tabs: tabs("ses_a", "ses_b"),
      nextTab: { workspaceId: "ws_company", sessionId: "ses_b" },
    });
  });

  test("关闭最后一个标签页后返回工作区根页面", () => {
    expect(closeOpenSessionTab(tabs("ses_a"), "ws_company", "ses_a")).toEqual({
      tabs: [],
      nextTab: null,
    });
  });

  test("相同会话编号的其他工作区标签页不会被误删", () => {
    const input = [
      { workspaceId: "ws_company", sessionId: "ses_shared" },
      { workspaceId: "ws_local", sessionId: "ses_shared" },
    ];

    expect(closeOpenSessionTab(input, "ws_company", "ses_shared")).toEqual({
      tabs: [{ workspaceId: "ws_local", sessionId: "ses_shared" }],
      nextTab: null,
    });
  });

  test("标签页可以持久化并在重启后恢复，且重复项只保留一次", () => {
    const storage = memoryStorage();
    const input = [
      { workspaceId: "ws_company", sessionId: "ses_a" },
      { workspaceId: "ws_company", sessionId: "ses_a" },
      { workspaceId: "ws_local", sessionId: "ses_b" },
      { workspaceId: "", sessionId: "invalid" },
    ];

    writeOpenSessionTabs(input, storage);

    expect(readOpenSessionTabs(storage)).toEqual([
      { workspaceId: "ws_company", sessionId: "ses_a" },
      { workspaceId: "ws_local", sessionId: "ses_b" },
    ]);
  });

  test("关闭后不会因重新挂载而自动复活，重新打开时才重新加入", () => {
    const initial = [
      { workspaceId: "ws_company", sessionId: "ses_a" },
      { workspaceId: "ws_company", sessionId: "ses_b" },
    ];
    const closed = closeOpenSessionTab(initial, "ws_company", "ses_a").tabs;

    expect(reconcileOpenSessionTabs(
      closed,
      [{ workspaceId: "ws_company", status: "ready", sessionIds: ["ses_a", "ses_b"] }],
      "ws_company",
      "ses_a",
      ["ws_company\u0000ses_a"],
    )).toEqual([{ workspaceId: "ws_company", sessionId: "ses_b" }]);

    expect(addOpenSessionTab(closed, "ws_company", "ses_a")).toEqual([
      { workspaceId: "ws_company", sessionId: "ses_b" },
      { workspaceId: "ws_company", sessionId: "ses_a" },
    ]);
  });

  test("工作区切换保留其他工作区标签，只清理已确认不存在的会话", () => {
    const current = [
      { workspaceId: "ws_company", sessionId: "ses_a" },
      { workspaceId: "ws_company", sessionId: "ses_removed" },
      { workspaceId: "ws_local", sessionId: "ses_local" },
      { workspaceId: "ws_remote", sessionId: "ses_pending" },
    ];

    expect(reconcileOpenSessionTabs(
      current,
      [
        { workspaceId: "ws_company", status: "ready", sessionIds: ["ses_a"] },
        { workspaceId: "ws_local", status: "ready", sessionIds: ["ses_local"] },
        { workspaceId: "ws_remote", status: "loading", sessionIds: [] },
      ],
      "ws_local",
      "ses_local",
    )).toEqual([
      { workspaceId: "ws_company", sessionId: "ses_a" },
      { workspaceId: "ws_local", sessionId: "ses_local" },
      { workspaceId: "ws_remote", sessionId: "ses_pending" },
    ]);
  });

  test("关闭其他标签后只保留当前标签，关闭工作区时清理恢复列表", () => {
    const all = [
      { workspaceId: "ws_company", sessionId: "ses_a" },
      { workspaceId: "ws_company", sessionId: "ses_b" },
      { workspaceId: "ws_local", sessionId: "ses_local" },
    ];

    expect(closeOtherOpenSessionTabs(all, "ws_company", "ses_b")).toEqual({
      tabs: [
        { workspaceId: "ws_company", sessionId: "ses_b" },
        { workspaceId: "ws_local", sessionId: "ses_local" },
      ],
      nextTab: { workspaceId: "ws_company", sessionId: "ses_b" },
    });
    expect(forgetOpenSessionTabsForWorkspace(all, "ws_company")).toEqual([
      { workspaceId: "ws_local", sessionId: "ses_local" },
    ]);
    expect(closeAllOpenSessionTabs(all, "ws_company")).toEqual({
      tabs: [{ workspaceId: "ws_local", sessionId: "ses_local" }],
      nextTab: null,
    });
  });
});
