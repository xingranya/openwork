import {
  clearSessionDraft,
  getSessionDraft,
  saveSessionDraft,
  takeSessionDraft,
} from "./draft-store";

declare const describe: (name: string, fn: () => void) => void;
declare const test: (name: string, fn: () => void) => void;
declare const expect: (value: unknown) => {
  toBe: (expected: unknown) => void;
  toEqual: (expected: unknown) => void;
};

describe("会话初始草稿", () => {
  test("只消费一次并保留草稿内容", () => {
    const workspaceId = "draft-test-workspace-once";
    const sessionId = "draft-test-session-once";
    clearSessionDraft(workspaceId, sessionId);
    saveSessionDraft(workspaceId, sessionId, { text: "交给 AI 的任务", mode: "prompt" });

    expect(takeSessionDraft(workspaceId, sessionId)).toEqual({ text: "交给 AI 的任务", mode: "prompt" });
    expect(getSessionDraft(workspaceId, sessionId)).toBe(null);
    expect(takeSessionDraft(workspaceId, sessionId)).toBe(null);
  });

  test("不同会话之间不共享草稿", () => {
    const workspaceId = "draft-test-workspace-scope";
    const firstSessionId = "draft-test-session-first";
    const secondSessionId = "draft-test-session-second";
    clearSessionDraft(workspaceId, firstSessionId);
    clearSessionDraft(workspaceId, secondSessionId);
    saveSessionDraft(workspaceId, firstSessionId, { text: "只给第一个会话", mode: "prompt" });

    expect(takeSessionDraft(workspaceId, secondSessionId)).toBe(null);
    expect(takeSessionDraft(workspaceId, firstSessionId)?.text).toBe("只给第一个会话");
  });
});
