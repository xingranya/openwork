/** @jsxImportSource react */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import { WorkspaceIcon } from "../src/react-app/design-system/workspace-icon";
import { PersonalRemoteWorkspaceStatusItem } from "../src/react-app/domains/workspace/personal-remote-workspace-status";

const sidebarSource = readFileSync(
  fileURLToPath(new URL("../src/react-app/domains/session/sidebar/app-sidebar.tsx", import.meta.url)),
  "utf8",
);

describe("工作区侧栏展示", () => {
  test("本地和远程工作区都显示稳定的工作区图标", () => {
    const markup = renderToStaticMarkup(<WorkspaceIcon workspaceId="ws_company" />);

    expect(markup).toContain("data-workspace-icon");
    expect(markup).toContain("aria-hidden=\"true\"");
    expect(sidebarSource).toContain("<WorkspaceIcon workspaceId={workspace.id}");
  });

  test("公司个人远程工作区准备期间仍显示在工作区列表", () => {
    const markup = renderToStaticMarkup(
      <PersonalRemoteWorkspaceStatusItem
        state={{
          status: "provisioning",
          message: "公司正在为你准备远程工作区",
        }}
      />,
    );

    expect(markup).toContain("data-personal-remote-workspace-status=\"provisioning\"");
    expect(markup).toContain("我的远程工作区");
    expect(markup).toContain("公司正在为你准备远程工作区");
    expect(sidebarSource).toContain("<PersonalRemoteWorkspaceStatusItem");
  });
});
