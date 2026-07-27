/** @jsxImportSource react */
import { useCallback, useEffect, useReducer, useState } from "react";
import { useNavigate } from "react-router-dom";

import { t } from "../../i18n";
import {
  pickDirectory,
  resolveWorkspaceListSelectedId,
  workspaceCreateRemote,
  workspaceSetRuntimeActive,
  workspaceSetSelected,
  type WorkspaceInfo,
  type WorkspaceList,
} from "../../app/lib/desktop";
import { isDesktopRuntime } from "../../app/utils";
import { createClient, unwrap } from "../../app/lib/opencode";
import { useLocal } from "../kernel/local-provider";
import { usePlatform } from "../kernel/platform";
import { WelcomePage } from "../domains/onboarding/welcome-page";
import { ProviderSelectionStep } from "../domains/onboarding/provider-selection-step";
import { CreateWorkspaceModal } from "../domains/workspace/create-workspace-modal";
import type { CreateWorkspaceOptions } from "../domains/workspace/types";
import {
  getOpenWorkModelsActionUrl,
  hideOpenWorkModelsPromo,
  useOpenWorkModelsPromoEligibility,
  markOpenWorkModelsStartupPromoShown,
} from "../domains/cloud/openwork-models-promo";
import { useDenAuth, type DenAuthStatus } from "../domains/cloud/den-auth-provider";
import { resolveOpenworkConnection } from "./openwork-connection";
import { buildOpenworkWorkspaceBaseUrl, createOpenworkServerClient } from "../../app/lib/openwork-server";
import { captureAnalyticsEvent } from "../../app/lib/analytics";
import {
  buildDenAuthUrl,
  clearDenSession,
  DEFAULT_DEN_BASE_URL,
  normalizeDenBaseUrl,
  readDenSettings,
} from "../../app/lib/den";
import { toChineseUserMessage } from "../../app/lib/user-facing-error";
import {
  denSettingsChangedEvent,
  dispatchDenSessionUpdated,
} from "../../app/lib/den-session-events";
import { writeActiveWorkspaceId, writeLastSessionFor, writeWorkspaceProjectDimension } from "./session-memory";
import { workspaceSessionRoute } from "./workspace-routes";
import { ensureDesktopLocalOpenworkConnection } from "./desktop-local-openwork";
import { saveControlPlaneUrl } from "../domains/settings/cloud/control-plane-url";

function folderNameFromPath(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "workspace";
}

function focusPromptSoon() {
  if (typeof window === "undefined") return;
  const focus = () => window.dispatchEvent(new Event("openwork:focusPrompt"));
  [0, 80, 240, 600].forEach((delay) => window.setTimeout(focus, delay));
}

type WelcomeState = {
  modalOpen: boolean;
  createBusy: boolean;
  createError: string | null;
  remoteBusy: boolean;
  remoteError: string | null;
  providerStep: boolean;
  pendingRoute: string | null;
  pendingWorkspaceId: string | null;
  pendingSessionId: string | null;
};

type WelcomeAction =
  | { type: "open" }
  | { type: "close" }
  | { type: "create:start" }
  | { type: "create:error"; error: string }
  | { type: "create:finish" }
  | { type: "remote:start" }
  | { type: "remote:error"; error: string }
  | { type: "remote:finish" }
  | { type: "provider-step"; workspaceId: string; sessionId: string | null };

const initialWelcomeState: WelcomeState = {
  modalOpen: false,
  createBusy: false,
  createError: null,
  remoteBusy: false,
  remoteError: null,
  providerStep: false,
  pendingRoute: null,
  pendingWorkspaceId: null,
  pendingSessionId: null,
};

export type WelcomePrimaryAction =
  | "configure_company"
  | "sign_in"
  | "wait_for_company"
  | "choose_workspace";

export function resolveWelcomePrimaryAction(
  organizationServerUrl: string,
  authStatus: DenAuthStatus,
): WelcomePrimaryAction {
  if (!normalizeDenBaseUrl(organizationServerUrl)) return "configure_company";
  if (authStatus === "signed_in") return "choose_workspace";
  if (authStatus === "signed_out") return "sign_in";
  return "wait_for_company";
}

function welcomeReducer(state: WelcomeState, action: WelcomeAction): WelcomeState {
  switch (action.type) {
    case "open":
      return { ...state, modalOpen: true };
    case "close":
      return { ...state, modalOpen: false, createError: null, remoteError: null };
    case "create:start":
      return { ...state, createBusy: true, createError: null };
    case "create:error":
      return { ...state, createError: action.error };
    case "create:finish":
      return { ...state, createBusy: false };
    case "remote:start":
      return { ...state, remoteBusy: true, remoteError: null };
    case "remote:error":
      return { ...state, remoteError: action.error };
    case "remote:finish":
      return { ...state, remoteBusy: false };
    case "provider-step":
      return { ...state, providerStep: true, pendingWorkspaceId: action.workspaceId, pendingSessionId: action.sessionId };
  }
}

/**
 * 首次启动且尚无工作区时显示欢迎页。工作区创建后只保留模型选择，
 * 不再展示上游推广问卷，完成选择后直接进入会话。
 */
export function WelcomeRoute() {
  const navigate = useNavigate();
  const local = useLocal();
  const platform = usePlatform();
  const denAuth = useDenAuth();
  const [state, dispatch] = useReducer(welcomeReducer, initialWelcomeState);
  const [manualFolder, setManualFolder] = useState("");
  const [organizationServerUrl, setOrganizationServerUrl] = useState(() => readDenSettings().baseUrl);
  const [organizationServerBusy, setOrganizationServerBusy] = useState(false);
  const [organizationServerError, setOrganizationServerError] = useState<string | null>(null);
  const showOpenWorkModelsPromo = useOpenWorkModelsPromoEligibility();

  // If user already completed onboarding, redirect away immediately.
  useEffect(() => {
    if (local.prefs.hasCompletedOnboarding) {
      navigate("/session", { replace: true });
    }
  }, [local.prefs.hasCompletedOnboarding, navigate]);

  const markOnboardingComplete = useCallback(() => {
    local.setPrefs((prev) => ({ ...prev, hasCompletedOnboarding: true }));
  }, [local]);

  useEffect(() => {
    const handleDenSettingsChanged = () => setOrganizationServerUrl(readDenSettings().baseUrl);
    window.addEventListener(denSettingsChangedEvent, handleDenSettingsChanged);
    return () => window.removeEventListener(denSettingsChangedEvent, handleDenSettingsChanged);
  }, []);

  const handleOrganizationServerSave = useCallback(async (url: string) => {
    setOrganizationServerBusy(true);
    setOrganizationServerError(null);
    try {
      const persisted = await saveControlPlaneUrl(url);
      if (!persisted) {
        setOrganizationServerError(t("welcome.organization_server_error"));
        return false;
      }
      clearDenSession({ includeBaseUrls: false });
      dispatchDenSessionUpdated({ status: "signed_out", baseUrl: persisted.baseUrl });
      setOrganizationServerUrl(persisted.baseUrl);
      platform.openLink(buildDenAuthUrl(persisted.baseUrl, "sign-in"));
      return true;
    } catch (error) {
      setOrganizationServerError(
        toChineseUserMessage(error, t("welcome.organization_server_error")),
      );
      return false;
    } finally {
      setOrganizationServerBusy(false);
    }
  }, [platform]);

  const handleCreateWorkspace = useCallback(
    async (_preset: string, folder: string | null, options?: CreateWorkspaceOptions) => {
      if (!folder) return;
      const projectLabel = options?.projectLabel?.trim() ?? "";
      dispatch({ type: "create:start" });
      try {
        const workspaceName = folderNameFromPath(folder);
        let list: WorkspaceList | null = null;
        let sessionBaseUrl = "";
        let sessionToken = "";
        try {
          const { normalizedBaseUrl, resolvedToken, resolvedHostToken } =
            await resolveOpenworkConnection();
          if (normalizedBaseUrl && (resolvedToken || resolvedHostToken)) {
            const openworkClient = createOpenworkServerClient({
              baseUrl: normalizedBaseUrl,
              token: resolvedToken || undefined,
              hostToken: resolvedHostToken || undefined,
            });
            list = await openworkClient.createLocalWorkspace({
              folderPath: folder,
              name: workspaceName,
              preset: "starter",
            });
            sessionBaseUrl = normalizedBaseUrl;
            sessionToken = resolvedToken;
          }
        } catch {
          list = null;
        }
        if (!list) {
          throw new Error("FoxWork 服务暂时不可用，请重新连接后再创建工作区。");
        }
        const createdId =
          resolveWorkspaceListSelectedId(list) ||
          list.workspaces[list.workspaces.length - 1]?.id ||
          "";
        let targetWorkspaceId = createdId;
        let targetWorkspace = list.workspaces.find((workspace: WorkspaceInfo) => workspace.id === createdId) ?? null;
        let targetSessionId: string | null = null;
        if (createdId) {
          await workspaceSetSelected(createdId).catch(() => undefined);
          await workspaceSetRuntimeActive(createdId).catch(() => undefined);
          writeActiveWorkspaceId(createdId);
        }
        if (targetWorkspace) {
          await ensureDesktopLocalOpenworkConnection({
            route: "session",
            workspace: targetWorkspace,
            allWorkspaces: list.workspaces,
          }).catch(() => undefined);
          const fresh = await resolveOpenworkConnection().catch(() => null);
          if (fresh?.normalizedBaseUrl && fresh.resolvedToken) {
            sessionBaseUrl = fresh.normalizedBaseUrl;
            sessionToken = fresh.resolvedToken;
          }
        }
        if (targetWorkspaceId && sessionBaseUrl && sessionToken) {
          try {
            const workspacePath = targetWorkspace?.path?.trim() || folder;
            const session = unwrap(await createClient(
              `${(buildOpenworkWorkspaceBaseUrl(sessionBaseUrl, targetWorkspaceId) ?? sessionBaseUrl).replace(/\/+$/, "")}/opencode`,
              workspacePath || undefined,
              { token: sessionToken, mode: "openwork" },
            ).session.create({ directory: workspacePath || undefined }));
            targetSessionId = session.id;
            captureAnalyticsEvent("task_created", { source: "onboarding", workspace_type: "local" });
          } catch {
            // Best-effort first task creation.
          }
        }
        if (targetWorkspaceId) {
          writeActiveWorkspaceId(targetWorkspaceId);
          if (projectLabel) {
            writeWorkspaceProjectDimension(targetWorkspaceId, {
              label: projectLabel,
            });
          }
          if (targetSessionId) writeLastSessionFor(targetWorkspaceId, targetSessionId);
        }
        dispatch({ type: "close" });
        // Show the provider selection step before navigating to the session.
        dispatch({ type: "provider-step", workspaceId: targetWorkspaceId, sessionId: targetSessionId });

      } catch (error) {
        dispatch({
          type: "create:error",
          error: toChineseUserMessage(error, "无法创建工作区，请稍后重试。"),
        });
      } finally {
        dispatch({ type: "create:finish" });
      }
    },
    [],
  );

  const handleCreateRemote = useCallback(
    async (input: {
      openworkHostUrl?: string | null;
      openworkToken?: string | null;
      directory?: string | null;
      displayName?: string | null;
    }) => {
      const baseUrlValue = input.openworkHostUrl?.trim() ?? "";
      if (!baseUrlValue) return false;
      dispatch({ type: "remote:start" });
      try {
        const remoteType: "openwork" = "openwork";
        const payload = {
          baseUrl: baseUrlValue,
          openworkHostUrl: baseUrlValue,
          openworkToken: input.openworkToken?.trim() || null,
          displayName: input.displayName?.trim() || null,
          directory: input.directory?.trim() || null,
          remoteType,
        };
        let list: WorkspaceList | null = null;
        if (isDesktopRuntime()) {
          list = await workspaceCreateRemote(payload);
        } else {
          try {
            const { normalizedBaseUrl, resolvedToken, resolvedHostToken } =
              await resolveOpenworkConnection();
            if (normalizedBaseUrl && (resolvedToken || resolvedHostToken)) {
              list = await createOpenworkServerClient({
                baseUrl: normalizedBaseUrl,
                token: resolvedToken || undefined,
                hostToken: resolvedHostToken || undefined,
              }).createRemoteWorkspace(payload);
            }
          } catch {
            list = null;
          }
        }
        if (!list) {
          throw new Error("FoxWork 服务暂时不可用，请重新连接后再添加远程工作区。");
        }
        const createdId =
          resolveWorkspaceListSelectedId(list) ||
          list.workspaces[list.workspaces.length - 1]?.id ||
          "";
        if (createdId) {
          await workspaceSetSelected(createdId).catch(() => undefined);
          await workspaceSetRuntimeActive(createdId).catch(() => undefined);
          writeActiveWorkspaceId(createdId);
        }
        markOnboardingComplete();
        dispatch({ type: "close" });
        navigate(createdId ? workspaceSessionRoute(createdId) : "/session", { replace: true });
        return true;
      } catch (error) {
        dispatch({
          type: "remote:error",
          error: toChineseUserMessage(error, "无法连接远程工作区，请检查连接地址与访问权限后重试。"),
        });
        return false;
      } finally {
        dispatch({ type: "remote:finish" });
      }
    },
    [markOnboardingComplete, navigate],
  );

  const handleGetStarted = useCallback(async () => {
    if (!isDesktopRuntime()) {
      // Non-desktop: fall back to the modal for remote workspace creation.
      dispatch({ type: "open" });
      return;
    }
    const picked = await pickDirectory({ title: t("onboarding.authorize_folder") });
    const folder = typeof picked === "string" ? picked : null;
    if (!folder) return;
    await handleCreateWorkspace("starter", folder);
  }, [handleCreateWorkspace]);

  const handleUseManualFolder = useCallback(async () => {
    const folder = manualFolder.trim();
    if (!folder) return;
    await handleCreateWorkspace("starter", folder);
  }, [handleCreateWorkspace, manualFolder]);

  const handleTeamSignIn = useCallback(() => {
    const settings = readDenSettings();
    platform.openLink(buildDenAuthUrl(settings.baseUrl || DEFAULT_DEN_BASE_URL, "sign-in"));
  }, [platform]);

  const welcomePrimaryAction = resolveWelcomePrimaryAction(
    organizationServerUrl,
    denAuth.status,
  );
  const handleWelcomePrimaryAction = welcomePrimaryAction === "choose_workspace"
    ? handleGetStarted
    : welcomePrimaryAction === "sign_in"
      ? handleTeamSignIn
      : () => undefined;
  const welcomePrimaryLabel = welcomePrimaryAction === "configure_company"
    ? "请先连接公司服务器"
    : welcomePrimaryAction === "sign_in"
      ? "登录公司账号"
      : welcomePrimaryAction === "wait_for_company"
        ? "正在检查公司连接"
        : t("welcome.pick_folder");

  const finishOnboarding = useCallback((route?: string) => {
    markOnboardingComplete();
    navigate(route ?? state.pendingRoute ?? "/session", { replace: true });
    if (state.pendingSessionId) focusPromptSoon();
  }, [markOnboardingComplete, navigate, state.pendingRoute, state.pendingSessionId]);

  return (
    <>
      <WelcomePage
        onGetStarted={handleWelcomePrimaryAction}
        getStartedLabel={welcomePrimaryLabel}
        getStartedDisabled={welcomePrimaryAction === "configure_company" || welcomePrimaryAction === "wait_for_company"}
        busy={state.createBusy}
        error={state.createError}
        manualFolder={manualFolder}
        onManualFolderChange={setManualFolder}
        onUseManualFolder={handleUseManualFolder}
        showManualFolder={import.meta.env.DEV && isDesktopRuntime()}
        companyConfigured={welcomePrimaryAction !== "configure_company"}
        companySignedIn={denAuth.status === "signed_in"}
        organizationServerBusy={organizationServerBusy}
        organizationServerError={organizationServerError}
        organizationServerUrl={organizationServerUrl}
        onOrganizationServerSave={handleOrganizationServerSave}
      />
      <CreateWorkspaceModal
        open={state.modalOpen}
        onClose={() => dispatch({ type: "close" })}
        onConfirm={handleCreateWorkspace}
        onConfirmRemote={handleCreateRemote}
        onPickFolder={() =>
          pickDirectory({ title: t("onboarding.authorize_folder") }) as Promise<
            string | null
          >
        }
        submitting={state.createBusy}
        localError={state.createError}
        remoteSubmitting={state.remoteBusy}
        remoteError={state.remoteError}
        localDisabled={!isDesktopRuntime()}
        localDisabledReason={
          isDesktopRuntime()
            ? undefined
            : t("app.local_disabled_reason")
        }
      />
      {state.providerStep ? (
        <ProviderSelectionStep
          showOpenWorkModels={showOpenWorkModelsPromo}
          onOpenWorkModels={() => {
            platform.openLink(getOpenWorkModelsActionUrl(denAuth.isSignedIn, "sign-up"));
            const route = state.pendingWorkspaceId
              ? workspaceSessionRoute(state.pendingWorkspaceId, state.pendingSessionId)
              : "/session";
            finishOnboarding(route);
          }}
          onBringYourOwn={() => {
            markOpenWorkModelsStartupPromoShown();
            hideOpenWorkModelsPromo();
            const route = state.pendingWorkspaceId
              ? workspaceSessionRoute(state.pendingWorkspaceId, state.pendingSessionId)
              : "/session";
            finishOnboarding(`${route}?onboarding=1`);
          }}
          onSkip={() => {
            const route = state.pendingWorkspaceId
              ? workspaceSessionRoute(state.pendingWorkspaceId, state.pendingSessionId)
              : "/session";
            finishOnboarding(route);
          }}
        />
      ) : null}
    </>
  );
}
