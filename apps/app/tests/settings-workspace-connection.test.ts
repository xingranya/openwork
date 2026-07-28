import { describe, expect, test } from "bun:test";

import type { OpenworkServerClient } from "../src/app/lib/openwork-server";
import type { ResolvedWorkspaceEndpoint } from "../src/app/lib/workspace-endpoint";
import {
  resolveSettingsWorkspaceConnection,
  resolveWorkspaceScopedServerSnapshot,
} from "../src/react-app/shell/settings-workspace-connection";

function client(baseUrl: string): OpenworkServerClient {
  return { baseUrl } as OpenworkServerClient;
}

describe("设置面板工作区服务归属", () => {
  test("远程工作区的模型、MCP 和 Skill 使用远程服务及服务器工作区 ID", () => {
    const localClient = client("http://127.0.0.1:53232");
    const remoteClient = client("http://127.0.0.1:8795");
    const endpoint = {
      client: remoteClient,
      workspaceId: "ws_remote_employee",
      isRemote: true,
    } as ResolvedWorkspaceEndpoint;

    const connection = resolveSettingsWorkspaceConnection(endpoint);
    const snapshot = resolveWorkspaceScopedServerSnapshot(
      {
        openworkServerClient: localClient,
        openworkServerStatus: "connected",
        openworkServerCapabilities: null,
      },
      connection,
    );

    expect(connection.runtimeWorkspaceId).toBe("ws_remote_employee");
    expect(snapshot.openworkServerClient).toBe(remoteClient);
    expect(snapshot.openworkServerClient?.baseUrl).toBe("http://127.0.0.1:8795");
    expect(snapshot.openworkServerStatus).toBe("connected");
    expect(snapshot.openworkServerCapabilities?.config?.read).toBe(true);
  });

  test("工作区端点未就绪时不把远程工作区 ID 交给本机服务", () => {
    const localClient = client("http://127.0.0.1:53232");
    const connection = resolveSettingsWorkspaceConnection(null);
    const snapshot = resolveWorkspaceScopedServerSnapshot(
      {
        openworkServerClient: localClient,
        openworkServerStatus: "connected",
        openworkServerCapabilities: null,
      },
      connection,
    );

    expect(connection.runtimeWorkspaceId).toBeNull();
    expect(snapshot.openworkServerClient).toBeNull();
    expect(snapshot.openworkServerStatus).toBe("disconnected");
  });
});
