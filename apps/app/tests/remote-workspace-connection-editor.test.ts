import { describe, expect, test } from "bun:test";

import {
  resolveRemoteWorkspaceConnectionCredentials,
} from "../src/react-app/domains/workspace/use-remote-workspace-connection-editor";

describe("其他远程工作区连接编辑", () => {
  test("编辑连接时保留独立的模型配置管理令牌，不把会话令牌当作主机令牌", () => {
    const credentials = resolveRemoteWorkspaceConnectionCredentials(
      {
        openworkToken: "session-token",
        openworkHostToken: "workspace-host-token",
      },
      { openworkToken: "new-session-token" },
    );

    expect(credentials).toEqual({
      openworkToken: "new-session-token",
      openworkHostToken: "workspace-host-token",
    });
  });
});
