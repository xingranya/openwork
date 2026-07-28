import type {
  OpenworkServerCapabilities,
  OpenworkServerClient,
  OpenworkServerStatus,
} from "@/app/lib/openwork-server";
import type { ResolvedWorkspaceEndpoint } from "@/app/lib/workspace-endpoint";

export const SETTINGS_WORKSPACE_CAPABILITIES: OpenworkServerCapabilities = {
  skills: { read: true, write: true, source: "openwork" },
  plugins: { read: true, write: true },
  mcp: { read: true, write: true },
  commands: { read: true, write: true },
  config: { read: true, write: true },
};

export type SettingsWorkspaceConnection = {
  client: OpenworkServerClient | null;
  runtimeWorkspaceId: string | null;
  status: "connected" | "disconnected";
  capabilities: OpenworkServerCapabilities | null;
};

export function resolveSettingsWorkspaceConnection(
  endpoint: ResolvedWorkspaceEndpoint | null | undefined,
): SettingsWorkspaceConnection {
  if (!endpoint) {
    return {
      client: null,
      runtimeWorkspaceId: null,
      status: "disconnected",
      capabilities: null,
    };
  }

  return {
    client: endpoint.client,
    runtimeWorkspaceId: endpoint.workspaceId,
    status: "connected",
    capabilities: SETTINGS_WORKSPACE_CAPABILITIES,
  };
}

type ServerSnapshotConnectionFields = {
  openworkServerClient: OpenworkServerClient | null;
  openworkServerStatus: OpenworkServerStatus;
  openworkServerCapabilities: OpenworkServerCapabilities | null;
};

export function resolveWorkspaceScopedServerSnapshot<T extends ServerSnapshotConnectionFields>(
  snapshot: T,
  connection: SettingsWorkspaceConnection,
) {
  const ready = connection.status === "connected";
  return {
    ...snapshot,
    openworkServerClient: connection.client,
    openworkServerStatus: connection.status,
    openworkServerCapabilities: connection.capabilities,
    openworkServerReady: ready,
    openworkServerWorkspaceReady: ready && Boolean(connection.runtimeWorkspaceId),
    resolvedOpenworkCapabilities: connection.capabilities,
    openworkServerCanWriteSkills:
      ready && (connection.capabilities?.skills?.write ?? false),
    openworkServerCanWritePlugins:
      ready && (connection.capabilities?.plugins?.write ?? false),
  };
}
