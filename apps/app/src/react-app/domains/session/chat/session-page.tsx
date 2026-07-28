/** @jsxImportSource react */
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePanelRef } from "react-resizable-panels";
import { ArrowLeft, ArrowRight, Cloud, Columns2, FileText, Globe, Mic2, PanelRight, Settings2, Sparkles, TextSearch, X, Zap } from "lucide-react";

import { resolveExtensionIconSrc } from "@/react-app/design-system/extension-icon-src";
import { t } from "../../../../i18n";
import { OPENWORK_EXTENSION_CATALOG } from "../../../../app/constants";
import { buildDenAuthUrl, readDenBootstrapConfig } from "../../../../app/lib/den";
import { type OpenworkServerClient, type OpenworkServerStatus } from "../../../../app/lib/openwork-server";
import { getDisplaySessionTitle } from "../../../../app/lib/session-title";
import { toChineseUserMessage } from "../../../../app/lib/user-facing-error";
import type { BootPhase } from "../../../../app/lib/startup-boot";
import { openDesktopPath, revealDesktopItemInDir, type WorkspaceInfo } from "../../../../app/lib/desktop";
import type {
  PendingPermission,
  PendingQuestion,
  ProviderListItem,
  TodoItem,
  WorkspaceConnectionState,
  WorkspaceSessionGroup,
} from "../../../../app/types";
import type { ShareWorkspaceModalProps } from "../../workspace/types";
import type { PersonalRemoteWorkspaceUiState } from "../../workspace/personal-remote-workspace-status";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { ConfirmModal } from "../../../design-system/modals/confirm-modal";
import { usePlatform } from "../../../kernel/platform";
import { useDenAuth } from "../../cloud/den-auth-provider";
import ProviderAuthModal, { type ProviderAuthModalProps } from "../../connections/provider-auth/provider-auth-modal";
import { RenameSessionModal } from "../modals/rename-session-modal";
import { AppSidebar } from "../sidebar/app-sidebar";
import { useSessionManagementStore } from "../sidebar/session-management-store";
import { SessionSurface, type SessionSurfaceProps } from "../surface/session-surface";
import { useSessionFindStore } from "../surface/find-store";
import { shouldShowDelayedSessionLoading } from "../status/session-readiness";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ShareWorkspaceModal } from "../../workspace/share-workspace-modal";
import { SessionEmptyHero } from "./session-empty-hero";
import type { NewTaskComposerContext } from "./new-task-composer";
import type { SessionCloudMcpMaintenanceState } from "../../connections/use-session-mcp-maintenance";
import { OwDotTicker } from "../../../shell/dot-ticker";
import { NotificationBell } from "../../../shell/notification-center";
import { useReactRenderWatchdog } from "../../../shell/react-render-watchdog";
import { useShellConfig } from "../../../shell/shell-config";
import { type SidePanelItem, useUiStateStore } from "../../../shell/ui-state-store";

import { isElectronRuntime } from "../../../../app/utils";
import { isCollectibleArtifactTarget, isLocalhostBrowserTarget, isOpenableFileTarget, type OpenTarget } from "../artifacts/open-target";
import type { OpenTargetOptions } from "@/lib/target-provider";
import { VoicePanel } from "../voice/voice-panel";
import { SidePanel } from "../panel/side-panel";
import { TerminalDock } from "../terminal/terminal-dock";
import { useActivePanelTab, usePanelTabStore, useSessionPanelState } from "../panel/panel-tab-store";
import { useWorkspaceShellLayout } from "../../../shell/workspace-shell-layout";
import { useControlAction, type OpenworkControlAction } from "../../../shell/control/control-provider";
import { getExtensionId, isOpenWorkExtensionEnabled, OPENWORK_EXTENSION_STATE_CHANGED } from "../../settings/extension-state";
import { cn } from "@/lib/utils";
import {
  canNavigateSelectedConversationHistory,
  createConversationTabHistory,
  navigateConversationTabHistory,
  removeConversationHistoryEntry,
  syncConversationTabHistory,
  type ConversationTabHistory,
  type ConversationHistoryDirection,
} from "./conversation-tab-history";
import { useWorkbenchStore } from "./workbench-store";
import {
  addOpenSessionTab,
  closeAllOpenSessionTabs,
  closeOpenSessionTab,
  closeOtherOpenSessionTabs,
  readOpenSessionTabs,
  reconcileOpenSessionTabs,
  writeOpenSessionTabs,
  type OpenSessionTab,
} from "./session-tab-state";
import { writeLastSessionFor } from "../../../shell/session-memory";

export type { OpenSessionTab } from "./session-tab-state";

const STARTUP_SKELETON_ROWS = [
  { id: "intro", titleWidth: "42%", bodyWidth: "88%" },
  { id: "middle", titleWidth: "56%", bodyWidth: "88%" },
  { id: "final", titleWidth: "36%", bodyWidth: "74%" },
];
const GLOBAL_VOICE_SIDE_PANEL_KEY = "__openwork_voice__";
const EMPTY_TRANSCRIPT_TARGETS: OpenTarget[] = [];
function openSessionTabKey(workspaceId: string, sessionId: string) {
  return `${workspaceId}\u0000${sessionId}`;
}

function hasSameSessionTabs(left: readonly OpenSessionTab[], right: readonly OpenSessionTab[]) {
  return left.length === right.length && left.every((tab, index) => (
    tab.workspaceId === right[index]?.workspaceId && tab.sessionId === right[index]?.sessionId
  ));
}

type PendingConversationHistoryNavigation = {
  history: ConversationTabHistory;
  fromWorkspaceId: string;
  fromSessionId: string | null;
  targetSessionId: string;
  targetSplitSessionId: string | null;
};

/** Live status the route feeds into the sidebar footer account menu. */
type StatusBarOverrides = {
  loading: boolean;
  showSettingsButton: boolean;
  reloadBusy: boolean;
  reloadError: string | null;
  openWorkConnectState: SessionCloudMcpMaintenanceState;
};

export type SessionPageHistoryControls = {
  canUndo: boolean;
  canRedo: boolean;
  busyAction: "undo" | "redo" | null;
  onUndo: () => void | Promise<void>;
  onRedo: () => void | Promise<void>;
};

export type SessionPageSidebarProps = {
  workspaceSessionGroups: WorkspaceSessionGroup[];
  personalRemoteWorkspaceState?: PersonalRemoteWorkspaceUiState | null;
  selectedWorkspaceId: string;
  selectedSessionId: string | null;
  developerMode: boolean;
  sessionStatusById: Record<string, string>;
  connectingWorkspaceId: string | null;
  workspaceConnectionStateById: Record<string, WorkspaceConnectionState>;
  newTaskDisabled: boolean;
  sidebarHydratedFromCache: boolean;
  startupPhase: BootPhase;
  onSelectWorkspace: (workspaceId: string) => Promise<boolean> | boolean | void;
  onOpenSession: (workspaceId: string, sessionId: string | null) => void;
  onPrefetchSession?: (workspaceId: string, sessionId: string) => void;
  onCreateTaskInWorkspace: (workspaceId: string, groupId?: string) => void;
  onCreateTaskWithPrompt?: (workspaceId: string, prompt: string) => void;
  onOpenRenameWorkspace: (workspaceId: string) => void;
  onShareWorkspace: (workspaceId: string) => void;
  onRevealWorkspace: (workspaceId: string) => void;
  onRecoverWorkspace: (workspaceId: string) => Promise<boolean> | boolean | void;
  onTestWorkspaceConnection: (workspaceId: string) => Promise<boolean> | boolean | void;
  onEditWorkspaceConnection: (workspaceId: string) => void;
  onForgetWorkspace: (workspaceId: string) => void;
  onOpenCreateWorkspace: () => void;
  /** Opens the cross-session message search dialog (Cmd/Ctrl+Shift+F). */
  onOpenSessionSearch?: () => void;
  onReorderWorkspaces?: (workspaceIds: string[]) => void;
};

export type SessionPageSurfaceProps = Omit<
  SessionSurfaceProps,
  "client" | "workspaceId" | "sessionId" | "opencodeBaseUrl" | "openworkToken" | "isControlTarget"
>;

export type SessionPageProps = {
  selectedSessionId: string | null;
  selectedWorkspaceId: string;
  selectedWorkspaceDisplay: {
    id?: string;
    name?: string;
    displayName?: string;
    workspaceType?: WorkspaceInfo["workspaceType"];
  };
  selectedWorkspaceRoot: string;
  selectedWorkspaceError?: string | null;
  runtimeWorkspaceId: string | null;
  /**
   * Pre-built OpenCode SDK base URL for the selected workspace's owning
   * server. The parent route resolves this through `resolveWorkspaceEndpoint`
   * so we never compose `<baseUrl>/workspace/<id>/opencode` here.
   */
  opencodeBaseUrl?: string | null;
  workspaces: WorkspaceInfo[];
  clientConnected: boolean;
  openworkServerStatus: OpenworkServerStatus;
  openworkServerClient: OpenworkServerClient | null;
  environmentClient?: OpenworkServerClient | null;
  openworkServerToken?: string | null;
  developerMode: boolean;
  headerStatus: string;
  busyHint: string | null;
  startupPhase: BootPhase;
  providerConnectedIds: string[];
  hasUsableModel?: boolean;
  providers?: ProviderListItem[];
  mcpConnectedCount: number;
  onSendFeedback: () => void;
  onOpenSettings: () => void;
  sidebar: SessionPageSidebarProps;
  surface?: SessionPageSurfaceProps | null;
  history?: SessionPageHistoryControls | null;
  todos: TodoItem[];
  sessionLoadingById: (sessionId: string | null) => boolean;
  shareWorkspaceModal?: ShareWorkspaceModalProps | null;
  providerAuthModal?: ProviderAuthModalProps | null;
  activePermission?: PendingPermission | null;
  permissionReplyBusy?: boolean;
  respondPermission?: (requestID: string, reply: "once" | "always" | "reject") => void;
  safeStringify?: (value: unknown) => string;
  activeQuestion?: PendingQuestion | null;
  questionReplyBusy?: boolean;
  respondQuestion?: (requestID: string, answers: string[][]) => void;
  statusBar?: Partial<StatusBarOverrides>;
  notFoundMessage?: string | null;
  onOpenProviderAuth?: () => void;
  /** Chat-first: create a default workspace and start a task from the empty-state composer. */
  onChatFirstTask?: (prompt: string) => void;
  chatFirstBusy?: boolean;
  /** Workspace-scoped wiring for the empty-state hero's full composer. */
  newTaskComposer?: NewTaskComposerContext | null;
  onRenameSession?: (sessionId: string, title: string) => Promise<void> | void;
  onDeleteSession?: (sessionId: string) => Promise<void> | void;
  onArchiveSession?: (sessionId: string, archived: boolean) => Promise<void> | void;
  onAccessibleTargetsChange?: (targets: OpenTarget[]) => void;
  /** 点击技能入口时在右侧显示的技能页面。 */
  skillsSlot?: React.ReactNode;
  /** 点击扩展入口时在右侧显示的扩展页面。 */
  extensionsSlot?: React.ReactNode;
  terminalOpen?: boolean;
  onTerminalOpenChange?: (open: boolean) => void;
  onSessionTabsChange?: (tabs: OpenSessionTab[]) => void;
};

function getSidebarInitialLoading(props: SessionPageSidebarProps) {
  if (props.workspaceSessionGroups.some((group) => group.sessions.length > 0)) {
    return false;
  }
  if (props.sidebarHydratedFromCache) return false;
  if (
    props.startupPhase !== "sessionIndexReady" &&
    props.startupPhase !== "firstSessionReady" &&
    props.startupPhase !== "ready"
  ) {
    return true;
  }
  return props.workspaceSessionGroups.some(
    (group) => group.status === "loading" || group.status === "idle",
  );
}

function sessionTitleForId(groups: WorkspaceSessionGroup[], id: string | null | undefined) {
  if (!id) return "";
  const sessionsById = new Map(groups.flatMap((group) => group.sessions.map((session) => [session.id, session] as const)));
  const match = sessionsById.get(id);
  return match ? getDisplaySessionTitle(match.title) : "";
}

function isTrackableAccessibleTarget(target: OpenTarget) {
  return isOpenableFileTarget(target) || isLocalhostBrowserTarget(target);
}

function absoluteWorkspacePath(root: string | null | undefined, value: string) {
  const target = value.trim();
  if (!target) return "";
  if (/^file:\/\//i.test(target)) {
    try {
      const pathname = new URL(target).pathname;
      return /^\/[a-zA-Z]:/.test(pathname) ? pathname.slice(1) : pathname;
    } catch {
      return target.replace(/^file:\/\//i, "");
    }
  }
  if (target.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(target)) return target;
  const cleanRoot = root?.trim().replace(/[/\\]+$/, "") ?? "";
  const cleanTarget = target.replace(/^[.][\\/]/, "");
  return cleanRoot ? `${cleanRoot}/${cleanTarget}` : cleanTarget;
}

function hiddenAccessibleTargetsStorageKey(workspaceId: string | null | undefined, sessionId: string | null | undefined) {
  if (!workspaceId || !sessionId) return null;
  return `openwork.session.hiddenAccessibleTargets.v1:${workspaceId}:${sessionId}`;
}

function readHiddenAccessibleTargetIds(workspaceId: string | null | undefined, sessionId: string | null | undefined): Set<string> {
  const key = hiddenAccessibleTargetsStorageKey(workspaceId, sessionId);
  if (!key || typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string" && id.trim().length > 0));
  } catch {
    return new Set();
  }
}

function writeHiddenAccessibleTargetIds(workspaceId: string | null | undefined, sessionId: string | null | undefined, ids: Set<string>) {
  const key = hiddenAccessibleTargetsStorageKey(workspaceId, sessionId);
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(Array.from(ids)));
  } catch {
    // ignore storage failures
  }
}

function controlObjectArg(args: unknown) {
  return args && typeof args === "object" && !Array.isArray(args) ? args : null;
}

function controlStringArg(args: unknown, key: string) {
  const object = controlObjectArg(args);
  const value = object ? Reflect.get(object, key) : null;
  return typeof value === "string" ? value.trim() : "";
}

export function SessionPage(props: SessionPageProps) {
  const { config: shellConfig } = useShellConfig();
  const platform = usePlatform();
  const denAuth = useDenAuth();
  const sidebarOpen = useUiStateStore((state) => state.sidebarOpen);
  const setSidebarOpen = useUiStateStore((state) => state.setSidebarOpen);
  const sessionSidePanel = useUiStateStore((state) => (
    props.selectedSessionId ? state.sidePanelState[props.selectedSessionId] ?? null : null
  ));
  const voiceSidePanelOpen = useUiStateStore((state) => state.sidePanelState[GLOBAL_VOICE_SIDE_PANEL_KEY] === "voice");
  const setSidePanelState = useUiStateStore((state) => state.setSidePanelState);
  const toggleSidePanelState = useUiStateStore((state) => state.toggleSidePanelState);
  const openTab = usePanelTabStore((state) => state.openTab);
  const closeTab = usePanelTabStore((state) => state.closeTab);
  const selectTab = usePanelTabStore((state) => state.selectTab);
  const transcriptTargets = usePanelTabStore((state) => (
    props.selectedSessionId ? state.transcriptArtifactTargets[props.selectedSessionId] ?? EMPTY_TRANSCRIPT_TARGETS : EMPTY_TRANSCRIPT_TARGETS
  ));
  const sessionPanelState = useSessionPanelState(props.selectedSessionId ?? "");
  const activePanelTab = useActivePanelTab(props.selectedSessionId ?? "");
  const [hiddenTargetRevision, setHiddenTargetRevision] = useState(0);
  const [, setExtensionStateVersion] = useState(0);
  const hiddenAccessibleTargetIds = useMemo(
    () => readHiddenAccessibleTargetIds(props.selectedWorkspaceId, props.selectedSessionId),
    [props.selectedSessionId, props.selectedWorkspaceId, hiddenTargetRevision],
  );
  const accessibleTargets = useMemo(
    () => transcriptTargets.filter((target) => isTrackableAccessibleTarget(target) && !hiddenAccessibleTargetIds.has(target.id)),
    [hiddenAccessibleTargetIds, transcriptTargets],
  );
  const artifactFileTargets = useMemo(() => accessibleTargets.filter(isCollectibleArtifactTarget), [accessibleTargets]);
  const artifactTargetCount = artifactFileTargets.length;
  const hasArtifactTargets = artifactTargetCount > 0;
  const activeSidePanel = voiceSidePanelOpen ? "voice" : sessionSidePanel;
  const sidePanelOpen = activeSidePanel !== null;
  const panelRailActive = activeSidePanel === "panel";
  const skillsRailActive = activeSidePanel === "skills";
  const extensionsRailActive = activeSidePanel === "extensions";
  const capabilityRailActive = skillsRailActive || extensionsRailActive;
  const voiceRailActive = activeSidePanel === "voice";
  const voiceExtension = useMemo(
    () => OPENWORK_EXTENSION_CATALOG.find((entry) => getExtensionId(entry) === "openwork-voice") ?? null,
    [],
  );
  const voiceExtensionEnabled = voiceExtension ? isOpenWorkExtensionEnabled(voiceExtension) : false;
  const showCloudSignIn = shellConfig.cloudSignin && !denAuth.isSignedIn && denAuth.status !== "checking";
  const openCloudSignIn = useCallback(() => {
    const baseUrl = readDenBootstrapConfig().baseUrl;
    // Label stays "Sign in"; opens the sign-up tab so new users aren't defaulted into sign-in.
    platform.openLink(buildDenAuthUrl(baseUrl, "sign-up"));
  }, [platform]);

  useReactRenderWatchdog("SessionPage", {
    selectedSessionId: props.selectedSessionId,
    selectedWorkspaceId: props.selectedWorkspaceId,
    clientConnected: props.clientConnected,
    startupPhase: props.startupPhase,
    hasSurface: Boolean(props.surface),
    workspaceCount: props.workspaces.length,
  });

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [sessionActionId, setSessionActionId] = useState<string | null>(null);
  const workbenchWorkspaceId = useWorkbenchStore((state) => state.workspaceId);
  const workbenchSplitSessionId = useWorkbenchStore((state) => state.splitSessionId);
  const focusedWorkbenchPane = useWorkbenchStore((state) => state.focusedPane);
  const syncWorkbench = useWorkbenchStore((state) => state.sync);
  const openWorkbenchTab = useWorkbenchStore((state) => state.openTab);
  const setWorkbenchSplit = useWorkbenchStore((state) => state.setSplit);
  const focusWorkbenchPane = useWorkbenchStore((state) => state.focusPane);
  const splitSessionId = workbenchWorkspaceId === props.selectedWorkspaceId ? workbenchSplitSessionId : null;
  const [sessionTabs, setSessionTabs] = useState<OpenSessionTab[]>(readOpenSessionTabs);
  const sessionTabsRef = useRef(sessionTabs);
  const suppressedSessionTabKeysRef = useRef(new Set<string>());
  const previousSelectedSessionTabKeyRef = useRef(
    props.selectedSessionId
      ? openSessionTabKey(props.selectedWorkspaceId, props.selectedSessionId)
      : "",
  );
  const [conversationHistory, setConversationHistory] = useState(() => (
    createConversationTabHistory(props.selectedWorkspaceId, props.selectedSessionId)
  ));
  const [pendingConversationHistoryNavigation, setPendingConversationHistoryNavigation] = useState<PendingConversationHistoryNavigation | null>(null);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [createGroupLabel, setCreateGroupLabel] = useState("");
  const [createGroupWorkspaceId, setCreateGroupWorkspaceId] = useState<string | null>(null);
  const browserPanelRef = usePanelRef();
  const preserveSidePanelOnPanelOpenRef = useRef(false);

  const commitSessionTabs = useCallback((next: OpenSessionTab[]) => {
    if (hasSameSessionTabs(sessionTabsRef.current, next)) return;
    sessionTabsRef.current = next;
    setSessionTabs(next);
    writeOpenSessionTabs(next);
  }, []);

  const setCurrentSidePanel = useCallback((panel: SidePanelItem | null) => {
    setSidePanelState(GLOBAL_VOICE_SIDE_PANEL_KEY, panel === "voice" ? "voice" : null);
    if (panel === "voice") return;
    setSidePanelState(props.selectedSessionId, panel);
  }, [props.selectedSessionId, setSidePanelState]);

  const toggleCurrentSidePanel = useCallback((panel: SidePanelItem) => {
    if (panel === "voice") {
      toggleSidePanelState(GLOBAL_VOICE_SIDE_PANEL_KEY, "voice");
      return;
    }
    setSidePanelState(GLOBAL_VOICE_SIDE_PANEL_KEY, null);
    toggleSidePanelState(props.selectedSessionId, panel);
  }, [props.selectedSessionId, setSidePanelState, toggleSidePanelState]);

  // When the agent calls a built-in browser tool, the main process opens
  // the WebContentsView and sends panel-opened; when hide_browser is called
  // it sends panel-closed. Without this listener the React UI never knows
  // the panel opened and doesn't render the unified panel chrome.
  useEffect(() => {
    if (!isElectronRuntime()) return;
    const browser = (window as Window).__OPENWORK_ELECTRON__?.browser;
    if (!browser) return;
    const unsubOpen = browser.onPanelOpened?.(() => {
      if (preserveSidePanelOnPanelOpenRef.current) {
        preserveSidePanelOnPanelOpenRef.current = false;
        return;
      }
      setCurrentSidePanel("panel");
    });
    const unsubClose = browser.onPanelClosed?.(() => setCurrentSidePanel(null));
    return () => { unsubOpen?.(); unsubClose?.(); };
  }, [setCurrentSidePanel]);
  const {
    leftSidebarResizing,
    leftSidebarWidth,
    rightSidebarExpandedWidth: browserPanelWidth,
    setRightSidebarExpandedWidth: setBrowserPanelWidth,
    startLeftSidebarResize,
  } = useWorkspaceShellLayout({
    expandedRightWidth: 520,
    minRightWidth: 320,
  });
  const [browserPanelDefaultWidth, setBrowserPanelDefaultWidth] = useState(browserPanelWidth);
  const sidebarProviderStyle: CSSProperties & Record<"--sidebar-width", string> = {
    "--sidebar-width": `${leftSidebarWidth}px`,
  };
  useEffect(() => {
    if (sidePanelOpen) return;
    setBrowserPanelDefaultWidth(browserPanelWidth);
  }, [sidePanelOpen, browserPanelWidth]);
  useEffect(() => {
    props.onAccessibleTargetsChange?.(accessibleTargets);
  }, [accessibleTargets, props.onAccessibleTargetsChange]);
  const commitBrowserPanelWidth = useCallback(() => {
    const size = browserPanelRef.current?.getSize();
    if (size?.inPixels) setBrowserPanelWidth(Math.round(size.inPixels));
  }, [browserPanelRef, setBrowserPanelWidth]);
  const browserUrlForTarget = useCallback((target: OpenTarget) => {
    if (/^wss?:\/\//i.test(target.value)) return target.value.replace(/^ws:/i, "http:").replace(/^wss:/i, "https:");
    return target.value;
  }, []);
  const downloadOpenTarget = useCallback(async (target: OpenTarget) => {
    if (target.kind !== "file" || !props.openworkServerClient || !props.runtimeWorkspaceId) {
      return;
    }

    const result = await props.openworkServerClient.downloadWorkspaceFile(props.runtimeWorkspaceId, target.value);
    const url = URL.createObjectURL(new Blob([result.data], { type: result.contentType ?? "application/octet-stream" }));
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = target.name;
    anchor.click();

    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [props.openworkServerClient, props.runtimeWorkspaceId]);
  const openTarget = useCallback((target: OpenTarget, options?: OpenTargetOptions, sourceSessionId?: string) => {
    if (target.kind === "url" || target.preview === "browser") {
      const url = browserUrlForTarget(target);
      if (isElectronRuntime()) {
        setCurrentSidePanel("panel");
        void window.__OPENWORK_ELECTRON__?.browser?.createTab?.(url);
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
      return;
    }
    if (options?.external && target.kind === "file" && props.selectedWorkspaceDisplay.workspaceType !== "remote") {
      const path = absoluteWorkspacePath(props.selectedWorkspaceRoot, target.value);
      if (path && isElectronRuntime()) {
        void (async () => {
          try {
            if (options.reveal) {
              await revealDesktopItemInDir(path);
            } else {
              await openDesktopPath(path);
            }
          } catch {
            await revealDesktopItemInDir(path).catch(() => undefined);
          }
        })();
      }
      return;
    }

    if (!isCollectibleArtifactTarget(target)) {
      if (isOpenableFileTarget(target)) {
        if (props.selectedWorkspaceDisplay.workspaceType === "remote") {
          void downloadOpenTarget(target).catch(() => undefined);
        } else if (isElectronRuntime()) {
          void openDesktopPath(absoluteWorkspacePath(props.selectedWorkspaceRoot, target.value)).catch(() => undefined);
        }
      }
      return;
    }

    const sessionId = sourceSessionId ?? props.selectedSessionId;
    if (!sessionId) return;
    if (options?.auto && activePanelTab?.id === target.id) return;
    openTab(sessionId, {
      id: target.id,
      type: "artifact",
      label: target.name,
      preview: target.preview,
    });
    preserveSidePanelOnPanelOpenRef.current = true;
    setCurrentSidePanel("panel");
  }, [activePanelTab?.id, browserUrlForTarget, downloadOpenTarget, openTab, props.selectedSessionId, props.selectedWorkspaceDisplay.workspaceType, props.selectedWorkspaceRoot, setCurrentSidePanel]);
  const closeRightPane = useCallback(() => {
    setCurrentSidePanel(null);
  }, [setCurrentSidePanel]);
  const openBrowserRailPane = useCallback(() => {
    // Opening the browser pane should land on a usable page, not an empty
    // panel that forces the user to click "+". If no browser tab exists yet,
    // create one (defaults to the new-tab URL in the main process).
    const opening = !panelRailActive;
    if (opening && isElectronRuntime()) {
      const hasBrowserTab = sessionPanelState.tabs.some((tab) => tab.type === "browser");
      if (!hasBrowserTab) {
        void window.__OPENWORK_ELECTRON__?.browser?.createTab?.();
      }
    }
    toggleCurrentSidePanel("panel");
  }, [panelRailActive, sessionPanelState.tabs, toggleCurrentSidePanel]);
  const openBrowserUrlControlAction = useMemo<OpenworkControlAction>(() => ({
    id: "browser.open_url",
    label: "Open URL in built-in browser",
    description: "Create or select an OpenWork built-in browser tab, navigate it to a URL, and return the CDP handle for browser automation.",
    sideEffect: "navigation",
    requiresArgs: true,
    args: [
      { name: "url", type: "string", required: true, description: "The website URL to open." },
      { name: "provider", type: "string", description: "Browser provider. Use builtin or auto. External is reserved for future support." },
    ],
    previewArgs: { url: "https://example.com", provider: "builtin" },
    disabled: !isElectronRuntime(),
    execute: async (args) => {
      const url = controlStringArg(args, "url");
      if (!url) return { ok: false, error: "Missing URL." };
      const provider = controlStringArg(args, "provider") || "builtin";
      if (provider !== "auto" && provider !== "builtin") {
        return { ok: false, error: `Browser provider is not available yet: ${provider}` };
      }
      setCurrentSidePanel("panel");
      return window.__OPENWORK_ELECTRON__?.browser?.openUrl?.(url, provider);
    },
  }), [setCurrentSidePanel]);
  useControlAction(openBrowserUrlControlAction);
  const setBrowserProxyControlAction = useMemo<OpenworkControlAction>(() => ({
    id: "browser.set_proxy",
    label: "Set built-in browser proxy",
    description: "Route all built-in browser traffic through an HTTP/SOCKS proxy (e.g. to browse from another location). Applies to every built-in browser tab until cleared. Pass an empty proxy to restore system network settings.",
    sideEffect: "mutation",
    args: [
      { name: "proxy", type: "string", description: "Proxy URL like http://user:pass@host:8080 or socks5://host:1080, env:NAME to use the OPENWORK_BROWSER_PROXY_NAME environment variable, or empty to clear." },
    ],
    previewArgs: { proxy: "env:DE" },
    disabled: !isElectronRuntime(),
    execute: async (args) => {
      const proxy = controlStringArg(args, "proxy") || "";
      const setProxy = window.__OPENWORK_ELECTRON__?.browser?.setProxy;
      if (!setProxy) return { ok: false, error: "Built-in browser is not available." };
      return setProxy(proxy);
    },
  }), []);
  useControlAction(setBrowserProxyControlAction);
  const openArtifactRailPane = useCallback(() => {
    if (!hasArtifactTargets || !props.selectedSessionId) return;
    const activeTab = sessionPanelState.tabs.find((tab) => tab.id === sessionPanelState.activeTabId);
    const artifactTargetIds = new Set(artifactFileTargets.map((target) => target.id));
    const currentArtifactTab = activeTab?.type === "artifact" && artifactTargetIds.has(activeTab.id) ? activeTab : null;
    const artifactTab = sessionPanelState.tabs.find((tab) => (
      tab.type === "artifact" && artifactTargetIds.has(tab.id)
    ));
    const firstArtifact = artifactFileTargets[0];
    const tabToSelect = currentArtifactTab?.id ?? artifactTab?.id ?? firstArtifact?.id ?? null;

    for (const target of artifactFileTargets) {
      if (sessionPanelState.tabs.some((tab) => tab.id === target.id)) continue;
      openTab(props.selectedSessionId, {
        id: target.id,
        type: "artifact",
        label: target.name,
        preview: target.preview,
      });
    }

    if (tabToSelect) {
      selectTab(props.selectedSessionId, tabToSelect);
    }

    if (panelRailActive && activeTab?.type === "artifact") {
      toggleCurrentSidePanel("panel");
      return;
    }
    if (!panelRailActive) {
      preserveSidePanelOnPanelOpenRef.current = true;
    }
    if (!panelRailActive) {
      toggleCurrentSidePanel("panel");
    }
  }, [artifactFileTargets, hasArtifactTargets, openTab, panelRailActive, props.selectedSessionId, selectTab, sessionPanelState, toggleCurrentSidePanel]);
  const openExtensionsRailPane = useCallback(() => {
    toggleCurrentSidePanel("extensions");
  }, [toggleCurrentSidePanel]);
  const openSkillsRailPane = useCallback(() => {
    toggleCurrentSidePanel("skills");
  }, [toggleCurrentSidePanel]);
  const openVoiceRailPane = useCallback(() => {
    toggleCurrentSidePanel("voice");
  }, [toggleCurrentSidePanel]);
  const removeAccessibleTarget = useCallback((target: OpenTarget) => {
    const nextHiddenIds = new Set(hiddenAccessibleTargetIds);
    nextHiddenIds.add(target.id);
    writeHiddenAccessibleTargetIds(props.selectedWorkspaceId, props.selectedSessionId, nextHiddenIds);
    setHiddenTargetRevision((value) => value + 1);
    if (props.selectedSessionId) {
      closeTab(props.selectedSessionId, target.id);
    }
  }, [closeTab, hiddenAccessibleTargetIds, props.selectedSessionId, props.selectedWorkspaceId]);
  useEffect(() => {
    const open = (event: Event) => {
      const requested = (event as CustomEvent<OpenTarget>).detail;
      const target = accessibleTargets.find((item) => item.id === requested?.id || item.value === requested?.value) ?? (
        requested?.kind && requested?.value ? requested : null
      );
      if (target) openTarget(target);
    };
    const hide = (event: Event) => {
      const requested = (event as CustomEvent<OpenTarget>).detail;
      const target = accessibleTargets.find((item) => item.id === requested?.id || item.value === requested?.value);
      if (target) removeAccessibleTarget(target);
    };
    window.addEventListener("openwork-open-accessible-target", open);
    window.addEventListener("openwork-hide-accessible-target", hide);
    return () => {
      window.removeEventListener("openwork-open-accessible-target", open);
      window.removeEventListener("openwork-hide-accessible-target", hide);
    };
  }, [accessibleTargets, openTarget, removeAccessibleTarget]);
  useEffect(() => {
    const handler = () => setCurrentSidePanel(null);
    window.addEventListener("openwork-close-right-pane", handler);
    return () => window.removeEventListener("openwork-close-right-pane", handler);
  }, [setCurrentSidePanel]);
  useEffect(() => {
    const refresh = () => setExtensionStateVersion((value) => value + 1);
    window.addEventListener(OPENWORK_EXTENSION_STATE_CHANGED, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(OPENWORK_EXTENSION_STATE_CHANGED, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  useEffect(() => {
    if (activeSidePanel === "voice" && !voiceExtensionEnabled) {
      setCurrentSidePanel(null);
    }
  }, [activeSidePanel, setCurrentSidePanel, voiceExtensionEnabled]);

  const openVoicePanelControlAction = useMemo<OpenworkControlAction | null>(() => (
    voiceExtensionEnabled ? {
      id: "voice.panel.open",
      label: "Open Voice Mode",
      description: "Open the sticky Voice Mode right-side panel.",
      effects: { data: "none", ui: "layout", external: false },
      sideEffect: "none",
      execute: () => {
        setCurrentSidePanel("voice");
        return { open: true };
      },
    } : null
  ), [setCurrentSidePanel, voiceExtensionEnabled]);
  useControlAction(openVoicePanelControlAction);

  const closeVoicePanelControlAction = useMemo<OpenworkControlAction | null>(() => (
    voiceExtensionEnabled && activeSidePanel === "voice" ? {
      id: "voice.panel.close",
      label: "Close Voice Mode",
      description: "Close the Voice Mode right-side panel.",
      effects: { data: "none", ui: "layout", external: false },
      sideEffect: "none",
      execute: () => {
        setCurrentSidePanel(null);
        return { open: false };
      },
    } : null
  ), [activeSidePanel, setCurrentSidePanel, voiceExtensionEnabled]);
  useControlAction(closeVoicePanelControlAction);
  const [sessionLoadingDelayElapsed, setSessionLoadingDelayElapsed] = useState(false);

  const selectedSessionTitle = useMemo(
    () => sessionTitleForId(props.sidebar.workspaceSessionGroups, props.selectedSessionId),
    [props.selectedSessionId, props.sidebar.workspaceSessionGroups],
  );
  const workspaceName =
    props.selectedWorkspaceDisplay.displayName?.trim() ||
    props.selectedWorkspaceDisplay.name?.trim() ||
    t("session.workspace_fallback");
  useEffect(() => {
    if (pendingConversationHistoryNavigation) {
      if (
        pendingConversationHistoryNavigation.history.workspaceId === props.selectedWorkspaceId &&
        pendingConversationHistoryNavigation.targetSessionId === props.selectedSessionId
      ) {
        setConversationHistory(pendingConversationHistoryNavigation.history);
        // Restore the split layout recorded at this history step.
        const targetSplit = pendingConversationHistoryNavigation.targetSplitSessionId;
        if (targetSplit) {
          openWorkbenchTab({
            workspaceId: props.selectedWorkspaceId,
            sessionId: targetSplit,
            title: sessionTitleForId(props.sidebar.workspaceSessionGroups, targetSplit),
          });
        }
        setWorkbenchSplit(targetSplit);
        setPendingConversationHistoryNavigation(null);
        return;
      }
      if (
        pendingConversationHistoryNavigation.fromWorkspaceId === props.selectedWorkspaceId &&
        pendingConversationHistoryNavigation.fromSessionId === props.selectedSessionId
      ) {
        return;
      }
      setPendingConversationHistoryNavigation(null);
    }

    setConversationHistory((current) => syncConversationTabHistory(
      current,
      props.selectedWorkspaceId,
      props.selectedSessionId,
      splitSessionId,
    ));
  }, [
    openWorkbenchTab,
    pendingConversationHistoryNavigation,
    props.selectedSessionId,
    props.selectedWorkspaceId,
    props.sidebar.workspaceSessionGroups,
    setWorkbenchSplit,
    splitSessionId,
  ]);
  useEffect(() => {
    if (!pendingConversationHistoryNavigation) return undefined;
    const id = window.setTimeout(() => {
      setPendingConversationHistoryNavigation((current) => current === pendingConversationHistoryNavigation ? null : current);
    }, 5000);
    return () => window.clearTimeout(id);
  }, [pendingConversationHistoryNavigation]);
  useEffect(() => {
    const selectedTabKey = props.selectedSessionId
      ? openSessionTabKey(props.selectedWorkspaceId, props.selectedSessionId)
      : "";
    const previousSelectedTabKey = previousSelectedSessionTabKeyRef.current;
    if (previousSelectedTabKey && previousSelectedTabKey !== selectedTabKey) {
      suppressedSessionTabKeysRef.current.delete(previousSelectedTabKey);
    }
    previousSelectedSessionTabKeyRef.current = selectedTabKey;

    const next = reconcileOpenSessionTabs(
      sessionTabsRef.current,
      props.sidebar.workspaceSessionGroups.map((group) => ({
        workspaceId: group.workspace.id,
        status: group.status,
        sessionIds: group.sessions.map((session) => session.id),
      })),
      props.selectedWorkspaceId,
      props.selectedSessionId,
      Array.from(suppressedSessionTabKeysRef.current),
    );
    commitSessionTabs(next);
  }, [commitSessionTabs, props.selectedSessionId, props.selectedWorkspaceId, props.sidebar.workspaceSessionGroups]);
  useEffect(() => {
    props.onSessionTabsChange?.(sessionTabs);
  }, [sessionTabs, props.onSessionTabsChange]);
  useEffect(() => {
    const workspaceGroup = props.sidebar.workspaceSessionGroups.find(
      (group) => group.workspace.id === props.selectedWorkspaceId,
    );
    syncWorkbench({
      workspaceId: props.selectedWorkspaceId,
      workspaceTitle: workspaceName,
      primarySessionId: props.selectedSessionId,
      sessionsKnown: workspaceGroup?.status === "ready",
      sessions: (workspaceGroup?.sessions ?? []).map((session) => ({
        workspaceId: props.selectedWorkspaceId,
        sessionId: session.id,
        title: getDisplaySessionTitle(session.title),
      })),
    });
  }, [
    props.selectedSessionId,
    props.selectedWorkspaceId,
    props.sidebar.workspaceSessionGroups,
    syncWorkbench,
    workspaceName,
  ]);
  const sessionActionTitle = useMemo(
    () => sessionTitleForId(props.sidebar.workspaceSessionGroups, sessionActionId),
    [props.sidebar.workspaceSessionGroups, sessionActionId],
  );
  const providerCount = props.hasUsableModel ? 1 : props.providerConnectedIds.length;
  const messageCountVisible = props.selectedSessionId ? 1 : 0;
  const showWorkspaceSetupEmptyState = props.workspaces.length === 0 && !props.selectedSessionId;
  const showStartupSkeleton =
    !props.selectedSessionId &&
    !props.clientConnected &&
    props.startupPhase !== "sessionIndexReady" &&
    props.startupPhase !== "firstSessionReady" &&
    props.startupPhase !== "ready";
  const sidebarInitialLoading = useMemo(() => getSidebarInitialLoading(props.sidebar), [props.sidebar]);
  // Derive the main-pane error from the same data the sidebar uses so the two
  // panes can never disagree. We check (in priority order):
  // 1. selectedWorkspaceError (errorsByWorkspaceId[selectedWorkspaceId])
  // 2. workspaceConnectionStateById[selectedWorkspaceId].message (covers test/recover paths)
  // 3. group.error from workspaceSessionGroups (the same source the sidebar reads)
  const selectedWorkspaceConnectionMessage = (() => {
    const state = props.sidebar.workspaceConnectionStateById[props.selectedWorkspaceId];
    if (state?.status === "error") return state.message?.trim() ?? "";
    return "";
  })();
  const selectedWorkspaceGroupError = (() => {
    const group = props.sidebar.workspaceSessionGroups.find(
      (item) => item.workspace.id === props.selectedWorkspaceId,
    );
    return group?.error?.trim() ?? "";
  })();
  const selectedWorkspaceErrorMessage =
    props.selectedWorkspaceError?.trim() ||
    selectedWorkspaceConnectionMessage ||
    selectedWorkspaceGroupError ||
    "";
  const showSelectedWorkspaceError = Boolean(selectedWorkspaceErrorMessage);
  const isSelectedWorkspaceRemote = props.selectedWorkspaceDisplay.workspaceType === "remote";
  const selectedWorkspaceErrorTitle = isSelectedWorkspaceRemote
    ? "远程工作区暂时不可用"
    : "工作区运行环境暂时不可用";
  const selectedWorkspaceErrorDescription = toChineseUserMessage(
    selectedWorkspaceErrorMessage,
    isSelectedWorkspaceRemote
      ? "无法连接远程工作区，请检查连接地址与访问权限后重试。"
      : "无法连接此工作区，请检查本机服务后重试。",
  );

  const reactSessionBaseUrl = props.opencodeBaseUrl?.trim() ?? "";
  const reactSessionToken =
    props.openworkServerToken?.trim() ||
    props.openworkServerClient?.token?.trim() ||
    "";
  const canRenderReactSurface = Boolean(
    props.selectedSessionId &&
      props.runtimeWorkspaceId &&
      props.openworkServerClient &&
      reactSessionBaseUrl &&
      reactSessionToken &&
      props.surface,
  );
  const canRenderSplitSurface = Boolean(canRenderReactSurface && splitSessionId && splitSessionId !== props.selectedSessionId);
  // Route-level refreshes must only gate the very first paint of a session.
  // Once the surface can mount it owns its own data stream, so replacing a
  // rendered chat with a loading pane (and leaving it there when a refresh
  // hangs) is never correct.
  const showSessionLoadingState =
    Boolean(props.selectedSessionId) &&
    props.sessionLoadingById(props.selectedSessionId) &&
    !showWorkspaceSetupEmptyState &&
    !canRenderReactSurface;
  const showDelayedSessionLoadingState = shouldShowDelayedSessionLoading({
    delayElapsed: sessionLoadingDelayElapsed,
    sessionLoading: showSessionLoadingState,
  });
  const selectedWorkspaceIsRemote = props.workspaces.some(
    (workspace) => workspace.id === props.selectedWorkspaceId && workspace.workspaceType === "remote",
  );
  const findButtonSessionId = props.selectedSessionId;
  const canGoBackInConversationHistory = !pendingConversationHistoryNavigation && canNavigateSelectedConversationHistory(
    conversationHistory,
    props.selectedWorkspaceId,
    props.selectedSessionId,
    "back",
  );
  const canGoForwardInConversationHistory = !pendingConversationHistoryNavigation && canNavigateSelectedConversationHistory(
    conversationHistory,
    props.selectedWorkspaceId,
    props.selectedSessionId,
    "forward",
  );
  const visibleSessionTabs = useMemo(
    () => sessionTabs.filter((tab) => tab.workspaceId === props.selectedWorkspaceId),
    [props.selectedWorkspaceId, sessionTabs],
  );

  const openSessionTab = useCallback((workspaceId: string, sessionId: string) => {
    suppressedSessionTabKeysRef.current.delete(openSessionTabKey(workspaceId, sessionId));
    commitSessionTabs(addOpenSessionTab(sessionTabsRef.current, workspaceId, sessionId));
    props.sidebar.onOpenSession(workspaceId, sessionId);
  }, [commitSessionTabs, props.sidebar]);

  const closeSessionTab = useCallback((sessionId: string) => {
    const result = closeOpenSessionTab(sessionTabsRef.current, props.selectedWorkspaceId, sessionId);
    if (sessionId === props.selectedSessionId) {
      suppressedSessionTabKeysRef.current.add(openSessionTabKey(props.selectedWorkspaceId, sessionId));
    }
    commitSessionTabs(result.tabs);
    if (splitSessionId === sessionId) {
      setWorkbenchSplit(null);
    }
    setPendingConversationHistoryNavigation(null);
    setConversationHistory((current) => removeConversationHistoryEntry(current, props.selectedWorkspaceId, sessionId));
    if (sessionId !== props.selectedSessionId) return;

    if (result.nextTab) {
      writeLastSessionFor(result.nextTab.workspaceId, result.nextTab.sessionId);
      props.sidebar.onOpenSession(result.nextTab.workspaceId, result.nextTab.sessionId);
      return;
    }
    writeLastSessionFor(props.selectedWorkspaceId, null);
    props.sidebar.onOpenSession(props.selectedWorkspaceId, null);
  }, [commitSessionTabs, props.selectedSessionId, props.selectedWorkspaceId, props.sidebar, setWorkbenchSplit, splitSessionId]);

  const closeOtherSessionTabs = useCallback((sessionId: string) => {
    const result = closeOtherOpenSessionTabs(sessionTabsRef.current, props.selectedWorkspaceId, sessionId);
    if (props.selectedSessionId && props.selectedSessionId !== sessionId) {
      suppressedSessionTabKeysRef.current.add(openSessionTabKey(props.selectedWorkspaceId, props.selectedSessionId));
    }
    commitSessionTabs(result.tabs);
    setWorkbenchSplit(null);
    setPendingConversationHistoryNavigation(null);
    writeLastSessionFor(props.selectedWorkspaceId, sessionId);
    if (props.selectedSessionId !== sessionId) {
      props.sidebar.onOpenSession(props.selectedWorkspaceId, sessionId);
    }
  }, [commitSessionTabs, props.selectedSessionId, props.selectedWorkspaceId, props.sidebar, setWorkbenchSplit]);

  const closeAllSessionTabs = useCallback(() => {
    const result = closeAllOpenSessionTabs(sessionTabsRef.current, props.selectedWorkspaceId);
    if (props.selectedSessionId) {
      suppressedSessionTabKeysRef.current.add(openSessionTabKey(props.selectedWorkspaceId, props.selectedSessionId));
    }
    commitSessionTabs(result.tabs);
    setWorkbenchSplit(null);
    setPendingConversationHistoryNavigation(null);
    setConversationHistory(createConversationTabHistory(props.selectedWorkspaceId, null));
    writeLastSessionFor(props.selectedWorkspaceId, null);
    props.sidebar.onOpenSession(props.selectedWorkspaceId, null);
  }, [commitSessionTabs, props.selectedSessionId, props.selectedWorkspaceId, props.sidebar, setWorkbenchSplit]);

  const navigateConversationHistory = useCallback((direction: ConversationHistoryDirection) => {
    if (!canNavigateSelectedConversationHistory(
      conversationHistory,
      props.selectedWorkspaceId,
      props.selectedSessionId,
      direction,
    )) return;
    const next = navigateConversationTabHistory(conversationHistory, direction);
    if (!next.entry) return;
    setPendingConversationHistoryNavigation({
      history: next.history,
      fromWorkspaceId: props.selectedWorkspaceId,
      fromSessionId: props.selectedSessionId,
      targetSessionId: next.entry.sessionId,
      targetSplitSessionId: next.entry.splitSessionId,
    });
    props.sidebar.onOpenSession(next.history.workspaceId, next.entry.sessionId);
  }, [conversationHistory, props.selectedSessionId, props.selectedWorkspaceId, props.sidebar]);

  useEffect(() => {
    if (!showSessionLoadingState) {
      setSessionLoadingDelayElapsed(false);
      return;
    }
    const id = window.setTimeout(() => {
      setSessionLoadingDelayElapsed(true);
    }, 1000);
    return () => window.clearTimeout(id);
  }, [showSessionLoadingState]);

  useEffect(() => {
    setRenameOpen(false);
    setDeleteOpen(false);
    setRenameBusy(false);
    setDeleteBusy(false);
    setSessionActionId(null);
  }, [props.selectedSessionId]);

  const openRenameModal = (sessionId: string) => {
    if (!props.onRenameSession) return;
    setSessionActionId(sessionId);
    setRenameTitle(sessionTitleForId(props.sidebar.workspaceSessionGroups, sessionId));
    setRenameOpen(true);
  };

  const submitRename = async () => {
    const sessionId = sessionActionId;
    const nextTitle = renameTitle.trim();
    if (!sessionId || !props.onRenameSession || !nextTitle || nextTitle === sessionActionTitle.trim()) return;
    setRenameBusy(true);
    try {
      await props.onRenameSession(sessionId, nextTitle);
      setRenameOpen(false);
    } finally {
      setRenameBusy(false);
    }
  };

  const confirmDelete = async () => {
    const sessionId = sessionActionId;
    if (!sessionId || !props.onDeleteSession) return;
    setDeleteBusy(true);
    try {
      await props.onDeleteSession(sessionId);
      setDeleteOpen(false);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[radial-gradient(circle_at_top,rgba(74,111,255,0.12),transparent_42%),var(--app-bg,#0b1020)] text-dls-text mac:bg-transparent">
      <SidebarProvider
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        className={cn(
          "relative min-h-0 flex-1 mac:bg-transparent",
          leftSidebarResizing &&
            "**:data-[slot=sidebar-container]:transition-none **:data-[slot=sidebar-gap]:transition-none",
          !shellConfig.sidebar && "**:data-[slot=sidebar-container]:hidden **:data-[slot=sidebar-gap]:hidden",
        )}
        style={sidebarProviderStyle}
      >
        <AppSidebar
          workspaceSessionGroups={props.sidebar.workspaceSessionGroups}
          personalRemoteWorkspaceState={props.sidebar.personalRemoteWorkspaceState}
          selectedWorkspaceId={props.sidebar.selectedWorkspaceId}
          developerMode={props.sidebar.developerMode}
          selectedSessionId={props.sidebar.selectedSessionId}
          showInitialLoading={sidebarInitialLoading}
          showSessionActions={Boolean(props.onRenameSession || props.onDeleteSession || props.onArchiveSession)}
          sessionStatusById={props.sidebar.sessionStatusById}
          connectingWorkspaceId={props.sidebar.connectingWorkspaceId}
          workspaceConnectionStateById={props.sidebar.workspaceConnectionStateById}
          newTaskDisabled={props.sidebar.newTaskDisabled}
          onSelectWorkspace={props.sidebar.onSelectWorkspace}
          onOpenSession={openSessionTab}
          onPrefetchSession={props.sidebar.onPrefetchSession}
          onCreateTaskInWorkspace={props.sidebar.onCreateTaskInWorkspace}
          onOpenRenameSession={props.onRenameSession ? openRenameModal : undefined}
          onOpenDeleteSession={props.onDeleteSession ? (sessionId) => {
            setSessionActionId(sessionId);
            setDeleteOpen(true);
          } : undefined}
          onArchiveSession={props.onArchiveSession ? (sessionId, archived) => {
            void props.onArchiveSession?.(sessionId, archived);
          } : undefined}
          onOpenCreateGroupModal={(workspaceId) => {
            setCreateGroupWorkspaceId(workspaceId);
            setCreateGroupLabel("");
            setCreateGroupOpen(true);
          }}
          onOpenRenameWorkspace={props.sidebar.onOpenRenameWorkspace}
          onShareWorkspace={props.sidebar.onShareWorkspace}
          onRevealWorkspace={props.sidebar.onRevealWorkspace}
          onRecoverWorkspace={props.sidebar.onRecoverWorkspace}
          onTestWorkspaceConnection={props.sidebar.onTestWorkspaceConnection}
          onEditWorkspaceConnection={props.sidebar.onEditWorkspaceConnection}
          onForgetWorkspace={props.sidebar.onForgetWorkspace}
          onOpenCreateWorkspace={props.sidebar.onOpenCreateWorkspace}
          onOpenSessionSearch={props.sidebar.onOpenSessionSearch}
          conversationHistory={{
            canGoBack: canGoBackInConversationHistory,
            canGoForward: canGoForwardInConversationHistory,
            onNavigate: navigateConversationHistory,
          }}
          onReorderWorkspaces={props.sidebar.onReorderWorkspaces}
          onStartResize={startLeftSidebarResize}
          onOpenAccountSettings={props.onOpenSettings}
          status={{
            clientConnected: props.clientConnected,
            openworkServerStatus: props.openworkServerStatus,
            developerMode: props.developerMode,
            showConnectionStatus: Boolean(props.selectedWorkspaceId),
            providerConnectedIds: props.providerConnectedIds,
            mcpConnectedCount: props.mcpConnectedCount,
            loading: props.statusBar?.loading ?? false,
            showSettingsButton: props.statusBar?.showSettingsButton,
            reloadBusy: props.statusBar?.reloadBusy,
            reloadError: props.statusBar?.reloadError,
            openWorkConnectState: props.statusBar?.openWorkConnectState,
            onSendFeedback: props.onSendFeedback,
          }}
        />
        <SidebarInset className="min-h-0 overflow-hidden bg-sidebar mac:bg-transparent mac:[&_header]:transition-[padding-left] mac:[&_header]:duration-200 mac:[&_header]:ease-linear mac:peer-data-[state=collapsed]:[&_header]:pl-28 mac:max-md:[&_header]:pl-28">
          <div className="flex min-h-0 flex-1 py-2 pl-2">
          <ResizablePanelGroup
            orientation="horizontal"
            onLayoutChanged={sidePanelOpen ? commitBrowserPanelWidth : undefined}
            className="min-h-0 flex-1 rounded-[14px]"
          >
            <ResizablePanel minSize="360px" className="min-w-0">
              <main className="flex h-full min-w-0 flex-col overflow-hidden rounded-[14px] border border-border bg-dls-surface shadow-[0_8px_24px_rgba(15,23,42,0.06)] dark:shadow-[0_10px_30px_rgba(0,0,0,0.45)] mac:bg-dls-surface/85 mac:backdrop-blur-2xl mac:backdrop-saturate-150">
          <header className="z-10 flex h-9 shrink-0 items-center justify-between border-b border-border px-4 md:px-6 mac:titlebar-drag  mac:backdrop-blur-2xl mac:backdrop-saturate-150 @container/titlebar">
            <div className="flex min-w-0 items-center gap-3">
              {shellConfig.sidebar ? <SidebarTrigger className="mac:hidden" /> : null}
              <h1 className="truncate text-[13px] font-medium text-dls-text">
                {showWorkspaceSetupEmptyState
                  ? t("session.create_or_connect_workspace")
                  : selectedSessionTitle || t("session.default_title")}
              </h1>
              {props.developerMode ? (
                <span className="hidden text-[12px] text-dls-secondary lg:inline">
                  {props.headerStatus}
                </span>
              ) : null}
              {props.busyHint ? (
                <span className="hidden text-[12px] text-dls-secondary lg:inline">
                  {props.busyHint}
                </span>
              ) : null}
            </div>

            <div className="flex items-center gap-1.5 text-gray-10 mac:titlebar-no-drag">
              {/* Revert/redo moved to per-message actions */}
              {findButtonSessionId ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="rounded-xl text-gray-10 transition-colors hover:bg-muted hover:text-foreground"
                        aria-label="在对话中查找"
                        onClick={() => useSessionFindStore.getState().openFind({ sessionId: findButtonSessionId })}
                      >
                        <TextSearch size={16} />
                      </Button>
                    }
                  />
                  <TooltipContent>在对话中查找（⌘F）</TooltipContent>
                </Tooltip>
              ) : null}
              <NotificationBell />
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className={cn(
                        "rounded-xl text-gray-10 transition-colors hover:bg-muted hover:text-foreground",
                        sidePanelOpen && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
                      )}
                      aria-label={sidePanelOpen ? "关闭侧边面板" : "打开侧边面板"}
                      aria-pressed={sidePanelOpen}
                      onClick={() => {
                        if (sidePanelOpen) {
                          closeRightPane();
                        } else {
                          openBrowserRailPane();
                        }
                      }}
                    >
                      <PanelRight size={16} />
                    </Button>
                  }
                />
                <TooltipContent>{sidePanelOpen ? "关闭侧边面板" : "打开侧边面板"}</TooltipContent>
              </Tooltip>
              {showCloudSignIn ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={openCloudSignIn}
                  title={t("den.signin_title")}
                  aria-label={t("den.signin_title")}
                >
                  <Cloud className="size-3.5" />
                  <span>{t("den.signin_button")}</span>
                </Button>
              ) : null}
              {props.developerMode ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    try {
                      window.localStorage.removeItem("openwork.acknowledgedProviders");
                      window.localStorage.removeItem("openwork.orgOnboardingSeen");
                    } catch {}
                  }}
                  title="清除已确认的模型服务和公司引导状态，以便重新触发"
                >
                  重置通知
                </Button>
              ) : null}
            </div>
          </header>

          <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1 overflow-hidden">
            <ResizablePanel minSize="180px" className="min-h-0">
            <div className="relative h-full min-w-0 overflow-hidden bg-dls-surface mac:bg-dls-surface/85 mac:backdrop-blur-2xl mac:backdrop-saturate-150">
              {showStartupSkeleton ? (
                <div className="px-6 py-14" role="status" aria-live="polite">
                  <div className="mx-auto max-w-2xl space-y-6">
                    <div className="space-y-2">
                      <div className="h-4 w-32 animate-pulse rounded-full bg-dls-hover/80" />
                      <div className="h-3 w-64 animate-pulse rounded-full bg-dls-hover/60" />
                    </div>
                    <div className="space-y-3">
                      {STARTUP_SKELETON_ROWS.map((row) => (
                        <div key={row.id} className="rounded-2xl border border-dls-border bg-dls-hover/40 p-4">
                          <div
                            className="mb-3 h-3 animate-pulse rounded-full bg-dls-hover/80"
                            style={{ width: row.titleWidth }}
                          />
                          <div className="space-y-2">
                            <div className="h-2.5 animate-pulse rounded-full bg-dls-hover/70" />
                            <div
                              className="h-2.5 animate-pulse rounded-full bg-dls-hover/60"
                              style={{ width: row.bodyWidth }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {showDelayedSessionLoadingState ? (
                selectedWorkspaceIsRemote ? (
                  // Cloud workers sync over the network all the time; the full
                  // loading pane reads as "something is wrong". Keep it to a
                  // quiet text shimmer.
                  <div className="px-6 py-16 text-center" role="status" aria-live="polite">
                    <span className="ow-text-shimmer text-[12px] leading-5">
                      {t("session.loading_detail")}
                    </span>
                  </div>
                ) : (
                  <div className="px-6 py-16">
                    <div
                      className="mx-auto flex max-w-[320px] flex-col items-center gap-3 text-center"
                      role="status"
                      aria-live="polite"
                    >
                      <OwDotTicker size="md" />
                      <div className="text-[12px] leading-5 text-dls-secondary">
                        {t("session.loading_detail")}
                      </div>
                    </div>
                  </div>
                )
              ) : null}

              {!showDelayedSessionLoadingState && canRenderReactSurface ? (
                <div className="flex h-full min-h-0 flex-col">
                  {visibleSessionTabs.length > 0 ? (
                    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-background/80 px-2 mac:backdrop-blur-xl">
                      <div className="flex shrink-0 items-center gap-0.5 pr-1" role="group" aria-label="对话历史导航">
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                className="rounded-lg text-dls-secondary transition-colors hover:bg-dls-hover hover:text-dls-text disabled:opacity-40"
                                aria-label="返回上一条对话历史"
                                title="返回上一条对话历史"
                                data-conversation-history-control="back"
                                disabled={!canGoBackInConversationHistory}
                                onClick={() => navigateConversationHistory("back")}
                              >
                                <ArrowLeft size={14} />
                              </Button>
                            }
                          />
                          <TooltipContent>返回上一条对话历史</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                className="rounded-lg text-dls-secondary transition-colors hover:bg-dls-hover hover:text-dls-text disabled:opacity-40"
                                aria-label="前往下一条对话历史"
                                title="前往下一条对话历史"
                                data-conversation-history-control="forward"
                                disabled={!canGoForwardInConversationHistory}
                                onClick={() => navigateConversationHistory("forward")}
                              >
                                <ArrowRight size={14} />
                              </Button>
                            }
                          />
                          <TooltipContent>前往下一条对话历史</TooltipContent>
                        </Tooltip>
                      </div>
                      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
                        {visibleSessionTabs.map((tab) => {
                          const title = sessionTitleForId(props.sidebar.workspaceSessionGroups, tab.sessionId) || t("session.default_title");
                          const active = tab.sessionId === props.selectedSessionId;
                          const split = tab.sessionId === splitSessionId;
                          return (
                            <ContextMenu key={`${tab.workspaceId}:${tab.sessionId}`}>
                              <ContextMenuTrigger
                                render={
                                  <div
                                    data-session-tab-id={tab.sessionId}
                                    data-session-tab-active={active ? "true" : undefined}
                                    className={cn(
                                      "group flex max-w-56 shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-xs transition-colors",
                                      active
                                        ? "border-border bg-dls-surface text-dls-text"
                                        : "border-transparent text-dls-secondary hover:bg-dls-hover hover:text-dls-text",
                                      split && "border-primary/30 bg-primary/10 text-primary",
                                    )}
                                  >
                                    <button
                                      type="button"
                                      className="min-w-0 flex-1 truncate text-left"
                                      onClick={() => props.sidebar.onOpenSession(tab.workspaceId, tab.sessionId)}
                                      title={title}
                                    >
                                      {title}
                                    </button>
                                    <button
                                      type="button"
                                      className="rounded p-0.5 text-dls-secondary hover:bg-dls-hover hover:text-dls-text disabled:pointer-events-none disabled:opacity-40"
                                      onClick={() => setWorkbenchSplit(split ? null : tab.sessionId)}
                                      disabled={active}
                                      title={split ? "关闭分屏" : "在分屏中打开"}
                                      aria-label={split ? "关闭分屏" : "在分屏中打开"}
                                    >
                                      <Columns2 size={13} />
                                    </button>
                                    <button
                                      type="button"
                                      className="rounded p-0.5 text-dls-secondary opacity-80 hover:bg-dls-hover hover:text-dls-text group-hover:opacity-100"
                                      onClick={() => closeSessionTab(tab.sessionId)}
                                      title="关闭标签页"
                                      aria-label="关闭标签页"
                                    >
                                      <X size={13} />
                                    </button>
                                  </div>
                                }
                              />
                              <ContextMenuContent className="w-48">
                                <ContextMenuItem onClick={() => closeSessionTab(tab.sessionId)}>
                                  关闭标签页
                                </ContextMenuItem>
                                <ContextMenuItem
                                  disabled={visibleSessionTabs.length <= 1}
                                  onClick={() => closeOtherSessionTabs(tab.sessionId)}
                                >
                                  关闭其他标签页
                                </ContextMenuItem>
                                <ContextMenuItem onClick={closeAllSessionTabs}>
                                  关闭全部标签页
                                </ContextMenuItem>
                              </ContextMenuContent>
                            </ContextMenu>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                  <ResizablePanelGroup
                    key={canRenderSplitSurface ? "workbench-split" : "workbench-single"}
                    orientation="horizontal"
                    className="min-h-0 flex-1"
                  >
                    <ResizablePanel
                      minSize="320px"
                      className="min-h-0 min-w-0"
                      data-workbench-pane="primary"
                      data-workbench-pane-focused={focusedWorkbenchPane === "primary" ? "true" : undefined}
                      onPointerDown={() => focusWorkbenchPane("primary")}
                      onFocusCapture={() => focusWorkbenchPane("primary")}
                    >
                      <SessionSurface
                        // Spread `surface` first so the explicit per-workspace
                        // routing props below CAN'T be silently overridden by
                        // anything that leaks into `surface`. SessionSurface's
                        // server target (client/workspaceId/sessionId/opencodeBaseUrl/openworkToken)
                        // must come from the resolved workspace endpoint passed by
                        // SessionRoute, not from anything in `surface`.
                        {...props.surface!}
                        client={props.openworkServerClient!}
                        environmentClient={props.environmentClient}
                        workspaceId={props.runtimeWorkspaceId!}
                        sessionId={props.selectedSessionId!}
                        isControlTarget={focusedWorkbenchPane === "primary"}
                        opencodeBaseUrl={reactSessionBaseUrl}
                        openworkToken={reactSessionToken}
                        todos={props.todos}
                        activePermission={props.activePermission}
                        permissionReplyBusy={props.permissionReplyBusy}
                        respondPermission={props.respondPermission}
                        activeQuestion={props.activeQuestion}
                        questionReplyBusy={props.questionReplyBusy}
                        respondQuestion={props.respondQuestion}
                        safeStringify={props.safeStringify}
                        onOpenTarget={openTarget}
                      />
                    </ResizablePanel>
                    {canRenderSplitSurface ? (
                      <>
                        <ResizableHandle />
                        <ResizablePanel
                          minSize="320px"
                          className="min-h-0 min-w-0"
                          data-workbench-pane="secondary"
                          data-workbench-pane-focused={focusedWorkbenchPane === "secondary" ? "true" : undefined}
                          onPointerDown={() => focusWorkbenchPane("secondary")}
                          onFocusCapture={() => focusWorkbenchPane("secondary")}
                        >
                          <SessionSurface
                            {...props.surface!}
                            client={props.openworkServerClient!}
                            environmentClient={props.environmentClient}
                            workspaceId={props.runtimeWorkspaceId!}
                            sessionId={splitSessionId!}
                            isControlTarget={focusedWorkbenchPane === "secondary"}
                            opencodeBaseUrl={reactSessionBaseUrl}
                            openworkToken={reactSessionToken}
                            todos={[]}
                            onOpenTarget={openTarget}
                          />
                        </ResizablePanel>
                      </>
                    ) : null}
                  </ResizablePanelGroup>
                </div>
              ) : null}

              {!showDelayedSessionLoadingState && !canRenderReactSurface && !showStartupSkeleton ? (
                <div className={`mx-auto max-w-[800px] px-6 ${showWorkspaceSetupEmptyState ? "pt-20" : "pt-10"}`}>
                  {props.notFoundMessage ? (
                    <div className="px-6 py-16 text-center">
                      <div className="mx-auto max-w-md rounded-2xl border border-dls-border bg-dls-card px-5 py-6 shadow-[var(--dls-card-shadow)]">
                        <h3 className="text-base font-medium text-dls-text">找不到工作区或会话</h3>
                        <p className="mt-2 text-sm leading-6 text-dls-secondary">
                          {toChineseUserMessage(props.notFoundMessage, "此工作区或会话已不存在，请返回后重新选择。")}
                        </p>
                      </div>
                    </div>
                  ) : showWorkspaceSetupEmptyState ? (
                    // Chat-first: no workspace yet — the composer creates a
                    // default chat workspace instead of asking where to put it.
                    <SessionEmptyHero
                      providerCount={providerCount}
                      busy={props.chatFirstBusy}
                      onRunTask={(prompt) => props.onChatFirstTask?.(prompt)}
                      onOpenProviderAuth={props.onOpenProviderAuth}
                      composer={props.newTaskComposer}
                    />
                  ) : showSelectedWorkspaceError ? (
                    <div className="px-6 py-16">
                      <div className="mx-auto max-w-lg rounded-2xl border border-red-7/35 bg-red-1/40 p-5 text-left shadow-[var(--dls-card-shadow)]">
                        <div className="text-sm font-medium text-red-11">{selectedWorkspaceErrorTitle}</div>
                        <p className="mt-2 whitespace-pre-wrap wrap-anywhere text-sm leading-6 text-red-11/90">
                          {selectedWorkspaceErrorDescription}
                        </p>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => props.sidebar.onCreateTaskInWorkspace(props.selectedWorkspaceId)}
                          >
                            重试
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void Promise.resolve(props.sidebar.onTestWorkspaceConnection(props.selectedWorkspaceId))}
                          >
                            {t("workspace_list.test_connection")}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => props.sidebar.onEditWorkspaceConnection(props.selectedWorkspaceId)}
                          >
                            {t("workspace_list.edit_connection")}
                          </Button>
                          {props.sidebar.workspaceConnectionStateById[props.selectedWorkspaceId]?.status === "error" ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void Promise.resolve(props.sidebar.onRecoverWorkspace(props.selectedWorkspaceId))}
                            >
                              {t("workspace_list.recover")}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : props.selectedSessionId ? (
                    <div className="px-6 py-16 text-center text-sm text-dls-secondary">
                      {t("session.loading_detail")}
                    </div>
                  ) : (
                    <div className="flex flex-1 items-center justify-center px-6 py-16">
                      <div className="w-full max-w-md space-y-6">
                        <div className="space-y-1 text-center">
                          <h2 className="text-lg font-semibold text-dls-text">
                            {providerCount === 0
                              ? t("session.connect_model_to_start")
                              : t("session.select_or_create_session")}
                          </h2>
                          <p className="text-xs text-dls-secondary">
                            {providerCount === 0
                              ? "连接 AI 模型后即可运行任务。"
                              : "可以从下面的任务开始："}
                          </p>
                        </div>
                        <div className="space-y-2">
                          {providerCount === 0 ? (
                            <button
                              type="button"
                              className="flex w-full items-start gap-3 rounded-xl border border-blue-7/50 bg-blue-2/40 p-3.5 text-left transition-colors hover:bg-blue-3/50"
                              onClick={() => props.onOpenProviderAuth?.()}
                            >
                              <Zap className="mt-0.5 size-5 shrink-0 text-blue-10" />
                              <div>
                                <div className="text-[13px] font-medium text-dls-text">连接模型服务</div>
                                <div className="mt-0.5 text-[11px] text-dls-secondary">
                                  添加 Anthropic、OpenAI、Google 或其他服务的 API 密钥
                                </div>
                              </div>
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="flex w-full items-start gap-3 rounded-xl border border-dls-border bg-dls-surface p-3.5 text-left transition-colors hover:bg-dls-hover"
                            onClick={() => {
                              props.sidebar.onCreateTaskWithPrompt?.(
                                props.selectedWorkspaceId,
                                "创建一个包含 20 行虚拟客户数据的 CSV 文件，字段包括姓名、邮箱、公司和收入，然后汇总这份数据。",
                              );
                            }}
                          >
                            <img src="https://cdn.simpleicons.org/googlesheets" alt="" width={20} height={20} className="mt-0.5 shrink-0" />
                            <div>
                              <div className="text-[13px] font-medium text-dls-text">编辑 CSV</div>
                              <div className="mt-0.5 text-[11px] text-dls-secondary">创建一份客户数据示例表格</div>
                            </div>
                          </button>
                          <button
                            type="button"
                            className="flex w-full items-start gap-3 rounded-xl border border-dls-border bg-dls-surface p-3.5 text-left transition-colors hover:bg-dls-hover"
                            onClick={() => {
                              props.sidebar.onCreateTaskWithPrompt?.(
                                props.selectedWorkspaceId,
                                "在浏览器中打开 craigslist.org，搜索正在出售的沙发，并列出价格靠前的 5 条结果。",
                              );
                            }}
                          >
                            <img src={resolveExtensionIconSrc("/openwork-mark.svg")} alt="" width={20} height={20} className="mt-0.5 shrink-0" />
                            <div>
                              <div className="text-[13px] font-medium text-dls-text">浏览网页</div>
                              <div className="mt-0.5 text-[11px] text-dls-secondary">搜索商品并整理结果</div>
                            </div>
                          </button>
                          <button
                            type="button"
                            className="flex w-full items-start gap-3 rounded-xl border border-dls-border bg-dls-surface p-3.5 text-left transition-colors hover:bg-dls-hover"
                            onClick={() => {
                              props.onOpenSettings?.();
                            }}
                          >
                            <img src="https://cdn.simpleicons.org/hackthebox" alt="" width={20} height={20} className="mt-0.5 shrink-0" />
                            <div>
                              <div className="text-[13px] font-medium text-dls-text">连接扩展</div>
                              <div className="mt-0.5 text-[11px] text-dls-secondary">添加 MCP 服务、插件和集成</div>
                            </div>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
            </ResizablePanel>
            {props.terminalOpen ? (
              <>
                <ResizableHandle />
                <ResizablePanel defaultSize="280px" minSize="160px" maxSize="55%" className="min-h-0">
                  <TerminalDock
                    workspaceRoot={props.selectedWorkspaceRoot}
                    isRemoteWorkspace={props.selectedWorkspaceDisplay.workspaceType === "remote"}
                    onClose={() => props.onTerminalOpenChange?.(false)}
                  />
                </ResizablePanel>
              </>
            ) : null}
          </ResizablePanelGroup>

              </main>
            </ResizablePanel>
              {sidePanelOpen ? (
              <>
                <ResizableHandle className="hidden bg-transparent lg:flex" />
                <ResizablePanel
                  panelRef={browserPanelRef}
                  defaultSize={`${capabilityRailActive ? Math.max(browserPanelDefaultWidth, 480) : browserPanelDefaultWidth}px`}
                  minSize={capabilityRailActive ? "420px" : "320px"}
                  maxSize="70%"
                  className="min-h-0 overflow-hidden pl-2 lg:flex lg:flex-col"
                >
                  <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-border bg-dls-surface shadow-[0_8px_24px_rgba(15,23,42,0.06)] dark:shadow-[0_10px_30px_rgba(0,0,0,0.45)] mac:bg-dls-surface/85 mac:backdrop-blur-2xl mac:backdrop-saturate-150">
                  {activeSidePanel === "skills" && props.skillsSlot ? (
                    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background">
                      {props.skillsSlot}
                    </div>
                  ) : activeSidePanel === "extensions" && props.extensionsSlot ? (
                    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background">
                      {props.extensionsSlot}
                    </div>
                  ) : activeSidePanel === "voice" ? (
                    <VoicePanel
                      client={props.openworkServerClient}
                      workspaceId={props.runtimeWorkspaceId}
                      sessionId={props.selectedSessionId}
                      onClose={closeRightPane}
                    />
                  ) : activeSidePanel === "panel" && props.selectedSessionId ? (
                    <SidePanel
                      sessionId={props.selectedSessionId}
                      client={props.openworkServerClient}
                      workspaceId={props.runtimeWorkspaceId}
                      workspaceRoot={props.selectedWorkspaceRoot}
                      isRemoteWorkspace={props.surface?.isRemoteWorkspace ?? false}
                      onClose={closeRightPane}
                    />
                  ) : null}
                  </div>
                </ResizablePanel>
              </>
            ) : null}
          </ResizablePanelGroup>
          <aside className="flex w-9 shrink-0 flex-col items-center gap-1 px-0.5 py-2 text-muted-foreground mac:titlebar-no-drag">
            {isElectronRuntime() ? (
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn(
                  "rounded-xl transition-colors hover:bg-muted hover:text-foreground",
                  panelRailActive && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
                )}
                onClick={openBrowserRailPane}
                title="浏览器"
                aria-label="浏览器"
                aria-pressed={panelRailActive}
              >
                <Globe size={15} />
              </Button>
            ) : null}
            {voiceExtensionEnabled ? (
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn(
                  "rounded-xl transition-colors hover:bg-muted hover:text-foreground",
                  voiceRailActive && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
                )}
                onClick={openVoiceRailPane}
                title="语音模式"
                aria-label="语音模式"
                aria-pressed={voiceRailActive}
              >
                <Mic2 size={15} />
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                "rounded-xl transition-colors hover:bg-muted hover:text-foreground",
                panelRailActive && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
              )}
              onClick={openArtifactRailPane}
              title={hasArtifactTargets ? `资料（${artifactTargetCount}）` : "暂无资料"}
              aria-label={hasArtifactTargets ? `资料（${artifactTargetCount}）` : "暂无资料"}
              aria-pressed={panelRailActive}
              disabled={!hasArtifactTargets}
            >
              <FileText size={15} />
              {artifactTargetCount > 0 ? (
                <span className="absolute right-0 top-0 flex min-w-3.5 translate-x-1 -translate-y-1 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold leading-3 text-primary-foreground">
                  {artifactTargetCount > 9 ? "9+" : artifactTargetCount}
                </span>
              ) : null}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                "rounded-xl transition-colors hover:bg-muted hover:text-foreground",
                skillsRailActive && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
              )}
              onClick={props.skillsSlot ? openSkillsRailPane : props.onOpenSettings}
              title="技能"
              aria-label="技能"
              aria-pressed={skillsRailActive}
            >
              <Sparkles size={17} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                "rounded-xl transition-colors hover:bg-muted hover:text-foreground",
                extensionsRailActive && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
              )}
              onClick={props.extensionsSlot ? openExtensionsRailPane : props.onOpenSettings}
              title="扩展"
              aria-label="扩展"
              aria-pressed={extensionsRailActive}
            >
              <Settings2 size={15} />
            </Button>
          </aside>
          </div>
        </SidebarInset>
        {shellConfig.sidebar ? <SidebarTrigger className="hidden mac:absolute mac:left-[64px] top-[3px] z-50 mac:flex titlebar-no-drag" /> : null}
      </SidebarProvider>

      {props.providerAuthModal ? <ProviderAuthModal {...props.providerAuthModal} /> : null}

      {props.onRenameSession ? (
        <RenameSessionModal
          open={renameOpen}
          title={renameTitle}
          busy={renameBusy}
          canSave={renameTitle.trim().length > 0 && renameTitle.trim() !== sessionActionTitle.trim()}
          onClose={() => {
            if (!renameBusy) setRenameOpen(false);
          }}
          onSave={() => void submitRename()}
          onTitleChange={setRenameTitle}
        />
      ) : null}

      {props.onDeleteSession ? (
        <ConfirmModal
          open={deleteOpen}
          title={t("session.delete_session_title")}
          message={
            sessionActionTitle.trim()
              ? t("session.delete_named_session_message", { title: sessionActionTitle.trim() })
              : t("session.delete_session_generic")
          }
          confirmLabel={deleteBusy ? t("session.deleting") : t("session.delete")}
          cancelLabel={t("common.cancel")}
          variant="danger"
          onConfirm={() => void confirmDelete()}
          onCancel={() => {
            if (!deleteBusy) setDeleteOpen(false);
          }}
        />
      ) : null}

      <Dialog open={createGroupOpen} onOpenChange={(open) => { if (!open) setCreateGroupOpen(false); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("session_management.new_group")}</DialogTitle>
          </DialogHeader>
          <Input
            type="text"
            value={createGroupLabel}
            onChange={(e) => setCreateGroupLabel(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && createGroupLabel.trim()) {
                if (createGroupWorkspaceId) useSessionManagementStore.getState().createGroup(createGroupWorkspaceId, createGroupLabel.trim());
                setCreateGroupOpen(false);
              }
            }}
            placeholder={t("session_management.new_group_prompt")}
          />
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>{t("common.cancel")}</DialogClose>
            <Button
              type="button"
              disabled={!createGroupLabel.trim()}
              onClick={() => {
                if (createGroupWorkspaceId) useSessionManagementStore.getState().createGroup(createGroupWorkspaceId, createGroupLabel.trim());
                setCreateGroupOpen(false);
              }}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {props.shareWorkspaceModal ? <ShareWorkspaceModal {...props.shareWorkspaceModal} /> : null}

      {/* Cloud provider notifications are now handled globally by CloudProvidersToast in app-root.tsx */}
    </div>
  );
}
