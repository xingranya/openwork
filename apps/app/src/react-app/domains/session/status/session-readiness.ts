export type SessionReadinessState = "loading" | "connected" | "model_required";

export function canRenderSessionSurface(input: {
  selectedWorkspaceId: string;
  selectedSessionId: string | null;
  workspaceEndpointAvailable: boolean;
  opencodeBaseUrl: string;
  workspaceToken: string;
  opencodeClientAvailable: boolean;
}) {
  return Boolean(
    input.selectedWorkspaceId &&
      input.selectedSessionId &&
      input.workspaceEndpointAvailable &&
      input.opencodeBaseUrl &&
      input.workspaceToken &&
      input.opencodeClientAvailable,
  );
}

export function isSessionOwnedByOtherWorkspace(input: {
  selectedWorkspaceId: string;
  selectedSessionId: string | null;
  sessionsByWorkspaceId: Record<string, Array<{ id?: string | null }>>;
}) {
  const sessionId = input.selectedSessionId?.trim() ?? "";
  if (!sessionId) return false;

  const selectedWorkspaceSessions = input.sessionsByWorkspaceId[input.selectedWorkspaceId] ?? [];
  if (selectedWorkspaceSessions.some((session) => session?.id === sessionId)) {
    return false;
  }

  return Object.entries(input.sessionsByWorkspaceId).some(([workspaceId, sessions]) => (
    workspaceId !== input.selectedWorkspaceId &&
    sessions.some((session) => session?.id === sessionId)
  ));
}

export function deriveSessionReadiness(input: {
  routeLoading: boolean;
  workspaceConnected: boolean;
  modelUsable: boolean;
}) {
  const workspaceReady = input.workspaceConnected && !input.routeLoading;
  const canCreateTask = workspaceReady && input.modelUsable;
  const state: SessionReadinessState = !workspaceReady
    ? "loading"
    : input.modelUsable
      ? "connected"
      : "model_required";

  return {
    canCreateTask,
    state,
    statusBarLoading: !workspaceReady,
    workspaceReady,
  };
}

export function shouldShowDelayedSessionLoading(input: {
  delayElapsed: boolean;
  sessionLoading: boolean;
}) {
  return input.delayElapsed && input.sessionLoading;
}
