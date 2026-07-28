import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { RemoteWorkspaceFields } from "../src/react-app/domains/workspace/remote-workspace-fields";

describe("其他远程工作区连接表单", () => {
  test("明确区分会话访问令牌和可选的模型配置管理令牌", () => {
    const markup = renderToStaticMarkup(createElement(RemoteWorkspaceFields, {
      hostUrl: "https://worker.example.test",
      onHostUrlInput: () => {},
      token: "client-token",
      tokenVisible: false,
      onTokenInput: () => {},
      onToggleTokenVisible: () => {},
      hostToken: "host-token",
      hostTokenVisible: false,
      onHostTokenInput: () => {},
      onToggleHostTokenVisible: () => {},
      displayName: "设计工作区",
      onDisplayNameInput: () => {},
      title: "远程服务器信息",
      description: "连接已获授权的远程工作区。",
    } as never));

    expect(markup).toContain("模型配置管理令牌");
    expect(markup).toContain("普通访问令牌不能替代它");
  });
});
