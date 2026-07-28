import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { remoteAccessStatusForPhase } from "../src/react-app/domains/workspace/remote-access-restart";
import { describeWorkspaceCreateError } from "../src/react-app/shell/route-workspaces";

const SOURCE_ROOT = fileURLToPath(new URL("../src", import.meta.url));
const RUNTIME_ERROR_FILES = [
  "react-app/domains/connections/store.ts",
  "react-app/domains/connections/provider-auth/store.ts",
  "react-app/domains/session/chat/session-page.tsx",
  "react-app/domains/session/control/session-control-actions.ts",
  "react-app/domains/session/sync/attachment-file-part.ts",
  "react-app/shell/session-route.tsx",
  "react-app/shell/settings-route.tsx",
  "react-app/shell/use-workspace-route-state.ts",
  "react-app/shell/welcome-route.tsx",
  "react-app/domains/settings/state/extensions-store.ts",
];

const FORBIDDEN_VISIBLE_LITERALS = [
  '"OpenWork server',
  '"OpenCode client',
  '"Remote workspace unavailable',
  '"OpenCode unavailable',
  '"Failed to create workspace',
  '"Connection failed',
  '"Remote worker connection failed',
  '"Workspace was not found',
  '"Session was not found',
  '"Session could not be loaded',
  '"Agent diagnostics require',
  '"Debug deep links',
  '"Select a workspace',
  '"Selected model is unavailable',
  '"Workspace endpoint is unavailable',
  '"Workspace path is unavailable',
  '"Failed to load MCP servers',
];

describe("SeeWayWork 工作区运行错误中文化", () => {
  test("远程访问状态全部使用中文", () => {
    const statuses = [
      remoteAccessStatusForPhase("idle", true),
      remoteAccessStatusForPhase("idle", false),
      remoteAccessStatusForPhase("restarting", true),
      remoteAccessStatusForPhase("reconnecting", true),
      remoteAccessStatusForPhase("failed", true),
      remoteAccessStatusForPhase("failed", false),
    ];

    for (const status of statuses) {
      expect(status).toMatch(/[\u3400-\u9fff]/);
      expect(status).not.toMatch(/\b(?:OpenWork|OpenCode|failed|unavailable)\b/i);
    }
  });

  test("工作区创建错误不暴露英文和内部品牌", () => {
    expect(describeWorkspaceCreateError(new Error("request failed: ECONNRESET")))
      .toBe("无法创建工作区，请稍后重试。");
    expect(describeWorkspaceCreateError(new Error("operation timed out: os error 60")))
      .toContain("读取工作区配置超时");
  });

  test("关键运行路径不再包含已知英文界面错误", () => {
    const violations = RUNTIME_ERROR_FILES.flatMap((relativePath) => {
      const source = readFileSync(`${SOURCE_ROOT}/${relativePath}`, "utf8");
      return FORBIDDEN_VISIBLE_LITERALS.flatMap((literal) => (
        source.includes(literal) ? [`${relativePath}: ${literal}`] : []
      ));
    });

    expect(violations).toEqual([]);
  });
});
