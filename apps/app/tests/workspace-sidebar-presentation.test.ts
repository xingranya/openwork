import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const sidebarSource = readFileSync(
  fileURLToPath(new URL("../src/react-app/domains/session/sidebar/app-sidebar.tsx", import.meta.url)),
  "utf8",
);
const sessionPageSource = readFileSync(
  fileURLToPath(new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url)),
  "utf8",
);

describe("工作区侧栏呈现", () => {
  test("工作区名称和连接状态保持单行并可查看完整内容", () => {
    expect(sidebarSource).toContain('className="block truncate" title={workspaceLabel(workspace)}');
    expect(sidebarSource).toContain('className={cn("block truncate text-xs"');
    expect(sidebarSource).toContain("title={statusLabel}");
  });

  test("会话加载提示只在当前会话仍处于加载状态时显示", () => {
    expect(sessionPageSource).toContain("shouldShowDelayedSessionLoading({");
    expect(sessionPageSource).toContain("sessionLoading: showSessionLoadingState");
  });
});
