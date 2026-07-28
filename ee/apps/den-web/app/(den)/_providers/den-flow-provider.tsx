"use client";

import { createContext, createElement, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  AUTH_TOKEN_STORAGE_KEY,
  DEFAULT_AUTH_NAME,
  DEFAULT_WORKER_NAME,
  LAST_WORKER_STORAGE_KEY,
  ONBOARDING_INTENT_STORAGE_KEY,
  PENDING_SOCIAL_SIGNUP_STORAGE_KEY,
  WORKER_STATUS_POLL_MS,
  type AuthMethod,
  type AuthMode,
  type AuthUser,
  type BillingSummary,
  type LaunchEvent,
  type OnboardingIntent,
  type OrgLimitError,
  type RuntimeServiceName,
  type SocialAuthProvider,
  type WorkerLaunch,
  type WorkerListItem,
  type WorkerRuntimeSnapshot,
  type WorkerSummary,
  type WorkerStatusBucket,
  buildOpenworkAppConnectUrl,
  buildOpenworkDeepLink,
  deriveOnboardingWorkerName,
  getAuthInfoForMode,
  getBillingSummary,
  getEmailDomain,
  getErrorMessage,
  getOrgLimitError,
  getRuntimeServiceLabel,
  getSocialCallbackUrl,
  getSocialProviderLabel,
  getToken,
  getUser,
  getWorker,
  getWorkerRuntimeSnapshot,
  getWorkerStatusCopy,
  getWorkerStatusMeta,
  getWorkerSummary,
  getWorkerTokens,
  getWorkersList,
  identifyPosthogUser,
  isWorkerLaunch,
  listItemToWorker,
  normalizeAuthIntentParam,
  normalizeAuthModeParam,
  PENDING_AUTH_INTENT_STORAGE_KEY,
  parseWorkspaceIdFromUrl,
  requestJson,
  resetPosthogUser,
  resolveOpenworkWorkspaceUrl,
  trackPosthogEvent
} from "../_lib/den-flow";
import { EMPTY_RUNTIME_CONFIG, getRuntimeConfig, type DenWebRuntimeConfig } from "../_lib/runtime-config";
import {
  getDesktopHandoffGrant,
  getDesktopHandoffOpenworkUrl,
  rememberDesktopHandoffGrant,
} from "../_lib/desktop-handoff";
import {
  PENDING_ORG_INVITATION_STORAGE_KEY,
  PENDING_ORG_SELECTION_STORAGE_KEY,
  PENDING_WORKSPACE_CLAIM_STORAGE_KEY,
  getInferenceRoute,
  getJoinOrgRoute,
  getOrgDashboardRoute,
  getWorkspaceClaimRoute,
  parseOrgListPayload,
  shouldOfferOrgSelection,
} from "../_lib/den-org";
import { FOXWORK_DESKTOP_SCHEME, normalizeFoxWorkDesktopScheme } from "../_lib/foxwork-brand";

type LaunchWorkerResult = "success" | "limit" | "error";
type AuthNavigationResult = "dashboard" | "join-org" | null;

type DenFlowContextValue = {
  authMode: AuthMode;
  setAuthMode: (mode: AuthMode) => void;
  email: string;
  setEmail: (value: string) => void;
  authName: string;
  setAuthName: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  verificationCode: string;
  setVerificationCode: (value: string) => void;
  verificationRequired: boolean;
  authBusy: boolean;
  authInfo: string;
  authError: string | null;
  user: AuthUser | null;
  sessionHydrated: boolean;
  desktopAuthRequested: boolean;
  desktopAuthScheme: string;
  webAuthRequested: boolean;
  desktopRedirectUrl: string | null;
  desktopRedirectBusy: boolean;
  showAuthFeedback: boolean;
  submitAuth: (event: FormEvent<HTMLFormElement>) => Promise<AuthNavigationResult>;
  submitVerificationCode: (event: FormEvent<HTMLFormElement>) => Promise<AuthNavigationResult>;
  resendVerificationCode: () => Promise<void>;
  cancelVerification: () => void;
  beginSocialAuth: (provider: SocialAuthProvider) => Promise<void>;
  signOut: () => Promise<void>;
  updateUserProfile: (input: { firstName: string; lastName: string }) => Promise<AuthUser>;
  resolveUserLandingRoute: () => Promise<string | null>;
  billingSummary: BillingSummary | null;
  billingBusy: boolean;
  billingError: string | null;
  orgLimitError: OrgLimitError | null;
  clearOrgLimitError: () => void;
  refreshBilling: (options?: { quiet?: boolean }) => Promise<BillingSummary | null>;
  onboardingPending: boolean;
  onboardingDecisionBusy: boolean;
  workers: WorkerListItem[];
  filteredWorkers: WorkerListItem[];
  workersBusy: boolean;
  workersLoadedOnce: boolean;
  workersError: string | null;
  workerQuery: string;
  setWorkerQuery: (value: string) => void;
  workerStatusFilter: WorkerStatusBucket | "all";
  setWorkerStatusFilter: (value: WorkerStatusBucket | "all") => void;
  selectedWorker: WorkerListItem | null;
  activeWorker: WorkerLaunch | null;
  selectWorker: (item: WorkerListItem) => void;
  workerName: string;
  setWorkerName: (value: string) => void;
  launchBusy: boolean;
  launchStatus: string;
  launchError: string | null;
  actionBusy: "status" | "token" | null;
  deleteBusyWorkerId: string | null;
  redeployBusyWorkerId: string | null;
  renameBusyWorkerId: string | null;
  runtimeSnapshot: WorkerRuntimeSnapshot | null;
  runtimeBusy: boolean;
  runtimeError: string | null;
  runtimeUpgradeBusy: boolean;
  copiedField: string | null;
  events: LaunchEvent[];
  runtimeConfig: DenWebRuntimeConfig;
  runtimeConfigLoaded: boolean;
  openworkDeepLink: string | null;
  openworkAppConnectUrl: string | null;
  hasWorkspaceScopedUrl: boolean;
  additionalWorkerNeedsPlan: boolean;
  selectedStatusMeta: { label: string; bucket: WorkerStatusBucket };
  isSelectedWorkerFailed: boolean;
  ownedWorkerCount: number;
  refreshWorkers: (options?: { keepSelection?: boolean; quiet?: boolean }) => Promise<void>;
  launchWorker: (options?: { source?: "manual" | "signup_auto"; workerNameOverride?: string }) => Promise<LaunchWorkerResult>;
  checkWorkerStatus: (options?: { workerId?: string; quiet?: boolean; background?: boolean }) => Promise<void>;
  generateWorkerToken: () => Promise<void>;
  renameWorker: (workerId: string, name: string) => Promise<boolean>;
  deleteWorker: (workerId: string) => Promise<void>;
  redeployWorker: (workerId: string) => Promise<void>;
  refreshRuntime: (workerId?: string, options?: { quiet?: boolean }) => Promise<WorkerRuntimeSnapshot | null>;
  upgradeRuntime: () => Promise<void>;
  copyToClipboard: (field: string, value: string | null) => Promise<void>;
  getRuntimeServiceLabel: (name: RuntimeServiceName) => string;
};

const DenFlowContext = createContext<DenFlowContextValue | null>(null);

function getPendingOrgInvitationId() {
  if (typeof window === "undefined") {
    return null;
  }

  const invitationId = window.sessionStorage.getItem(PENDING_ORG_INVITATION_STORAGE_KEY)?.trim() ?? "";
  return invitationId || null;
}

function getPendingWorkspaceClaimToken() {
  if (typeof window === "undefined") {
    return null;
  }

  const token = window.sessionStorage.getItem(PENDING_WORKSPACE_CLAIM_STORAGE_KEY)?.trim() ?? "";
  return token || null;
}

function getPendingAuthIntent() {
  if (typeof window === "undefined") {
    return null;
  }

  return normalizeAuthIntentParam(window.sessionStorage.getItem(PENDING_AUTH_INTENT_STORAGE_KEY));
}

function clearPendingAuthIntent() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(PENDING_AUTH_INTENT_STORAGE_KEY);
}

function getCaughtErrorMessage(error: unknown, fallback: string) {
  return getErrorMessage(error instanceof Error ? error.message : null, fallback);
}

export function DenFlowProvider({ children }: { children: ReactNode }) {
  const [authMode, setAuthModeState] = useState<AuthMode>("sign-up");
  const [email, setEmail] = useState("");
  const [authName, setAuthName] = useState("");
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [verificationRequired, setVerificationRequired] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authInfo, setAuthInfo] = useState(getAuthInfoForMode("sign-up"));
  const [authError, setAuthError] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(() => {
    if (typeof window === "undefined") {
      return null;
    }

    const token = window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
    if (!token || token.trim().length === 0) {
      return null;
    }

    return token;
  });
  const [sessionHydrated, setSessionHydrated] = useState(false);
  const [desktopAuthRequested, setDesktopAuthRequested] = useState(false);
  const [desktopAuthScheme, setDesktopAuthScheme] = useState(FOXWORK_DESKTOP_SCHEME);
  const [webAuthRequested, setWebAuthRequested] = useState(false);
  const [webAuthReturnUrl, setWebAuthReturnUrl] = useState<string | null>(null);
  const [desktopRedirectBusy, setDesktopRedirectBusy] = useState(false);
  const [desktopRedirectUrl, setDesktopRedirectUrl] = useState<string | null>(null);
  const [desktopRedirectAttempted, setDesktopRedirectAttempted] = useState(false);
  const [webRedirectBusy, setWebRedirectBusy] = useState(false);
  const [webRedirectAttempted, setWebRedirectAttempted] = useState(false);
  const [billingSummary, setBillingSummary] = useState<BillingSummary | null>(null);
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [billingLoadedOnce, setBillingLoadedOnce] = useState(false);
  const [orgLimitError, setOrgLimitError] = useState<OrgLimitError | null>(null);

  const [workerName, setWorkerName] = useState(DEFAULT_WORKER_NAME);
  const [worker, setWorker] = useState<WorkerLaunch | null>(null);
  const [workerLookupId, setWorkerLookupId] = useState("");
  const [workers, setWorkers] = useState<WorkerListItem[]>([]);
  const [workersBusy, setWorkersBusy] = useState(false);
  const [workersLoadedOnce, setWorkersLoadedOnce] = useState(false);
  const [workersError, setWorkersError] = useState<string | null>(null);
  const [workerQuery, setWorkerQuery] = useState("");
  const [workerStatusFilter, setWorkerStatusFilter] = useState<WorkerStatusBucket | "all">("all");
  const [launchBusy, setLaunchBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState<"status" | "token" | null>(null);
  const [launchStatus, setLaunchStatus] = useState("请先选择或新建远程工作区。");
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [events, setEvents] = useState<LaunchEvent[]>([]);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [tokenFetchedForWorkerId, setTokenFetchedForWorkerId] = useState<string | null>(null);
  const [deleteBusyWorkerId, setDeleteBusyWorkerId] = useState<string | null>(null);
  const [redeployBusyWorkerId, setRedeployBusyWorkerId] = useState<string | null>(null);
  const [renameBusyWorkerId, setRenameBusyWorkerId] = useState<string | null>(null);
  const [pendingRestoredWorkerId, setPendingRestoredWorkerId] = useState<string | null>(null);
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<WorkerRuntimeSnapshot | null>(null);
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [runtimeUpgradeBusy, setRuntimeUpgradeBusy] = useState(false);
  const [runtimeConfig, setRuntimeConfig] = useState<DenWebRuntimeConfig>(EMPTY_RUNTIME_CONFIG);
  const [runtimeConfigLoaded, setRuntimeConfigLoaded] = useState(false);
  const isSingleOrgMode = runtimeConfigLoaded && runtimeConfig.orgMode === "single_org";

  const [onboardingIntent, setOnboardingIntent] = useState<OnboardingIntent | null>(null);
  const onboardingAutoLaunchKeyRef = useRef<string | null>(null);
  const socialSignupHandledRef = useRef<string | null>(null);
  const pendingWorkersRequestRef = useRef<Promise<{ response: Response; payload: unknown }> | null>(null);

  const selectedWorker = workers.find((item) => item.workerId === workerLookupId) ?? null;
  const activeWorker =
    worker && workerLookupId === worker.workerId
      ? worker
      : selectedWorker
        ? listItemToWorker(selectedWorker, worker)
        : worker;
  const openworkConnectUrl = activeWorker?.openworkUrl ?? activeWorker?.instanceUrl ?? null;
  const preferredOpenworkToken = activeWorker?.clientToken ?? activeWorker?.ownerToken ?? null;
  const hasWorkspaceScopedUrl = Boolean(openworkConnectUrl && /\/w\/[^/?#]+/.test(openworkConnectUrl));
  const openworkDeepLink = buildOpenworkDeepLink(
    openworkConnectUrl,
    preferredOpenworkToken,
    activeWorker?.workerId ?? null,
    activeWorker?.workerName ?? null
  );
  const openworkAppConnectUrl = buildOpenworkAppConnectUrl(
    runtimeConfig.openworkAppConnectUrl,
    openworkConnectUrl,
    preferredOpenworkToken,
    activeWorker?.workerId ?? null,
    activeWorker?.workerName ?? null,
    { autoConnect: true }
  );
  const ownedWorkerCount = workers.filter((item) => item.isMine).length;
  const additionalWorkerNeedsPlan = Boolean(
    user &&
      ownedWorkerCount > 0 &&
      billingSummary?.featureGateEnabled &&
      !billingSummary.hasActivePlan
  );
  const selectedWorkerStatus = activeWorker?.status ?? selectedWorker?.status ?? "unknown";
  const selectedStatusMeta = getWorkerStatusMeta(selectedWorkerStatus);
  const isSelectedWorkerFailed = selectedWorkerStatus.trim().toLowerCase() === "failed";
  const onboardingPending = Boolean(onboardingIntent?.shouldLaunch && !onboardingIntent.completed);
  const onboardingDecisionBusy = onboardingPending && !billingLoadedOnce && (billingBusy || !sessionHydrated);

  const filteredWorkers = workers.filter((item) => {
    const query = workerQuery.trim().toLowerCase();
    const matchesQuery =
      !query ||
      item.workerName.toLowerCase().includes(query) ||
      item.workerId.toLowerCase().includes(query);

    if (!matchesQuery) {
      return false;
    }

    if (workerStatusFilter === "all") {
      return true;
    }

    return getWorkerStatusMeta(item.status).bucket === workerStatusFilter;
  });

  function persistOnboardingIntent(next: OnboardingIntent | null) {
    setOnboardingIntent(next);

    if (typeof window === "undefined") {
      return;
    }

    if (!next) {
      window.localStorage.removeItem(ONBOARDING_INTENT_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(ONBOARDING_INTENT_STORAGE_KEY, JSON.stringify(next));
  }

  function appendEvent(level: LaunchEvent["level"], label: string, detail: string) {
    setEvents((current) => {
      const next: LaunchEvent[] = [
        {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          level,
          label,
          detail,
          at: new Date().toISOString()
        },
        ...current
      ];

      return next.slice(0, 10);
    });
  }

  function markOnboardingComplete() {
    if (!onboardingIntent || onboardingIntent.completed) {
      return;
    }

    persistOnboardingIntent({
      ...onboardingIntent,
      completed: true,
      shouldLaunch: false
    });
  }

  function setAuthMode(mode: AuthMode) {
    setAuthModeState(mode);
    setVerificationRequired(false);
    setVerificationCode("");
    setAuthInfo(getAuthInfoForMode(mode));
    setAuthError(null);
  }

  function openVerificationStep(targetEmail: string, message?: string) {
    setVerificationRequired(true);
    setVerificationCode("");
    setAuthInfo(message ?? `请输入发送到 ${targetEmail} 的 6 位验证码。`);
    setAuthError(null);
  }

  function cancelVerification() {
    setVerificationRequired(false);
    setVerificationCode("");
    setAuthInfo(getAuthInfoForMode(authMode));
    setAuthError(null);
  }

  async function redirectToRequiredSso(trimmedEmail: string) {
    const { response, payload } = await requestJson(`/v1/orgs/sso/resolve?email=${encodeURIComponent(trimmedEmail)}`, { method: "GET" }, 12000);

    if (response.status === 204) {
      return false;
    }

    if (!response.ok) {
      throw new Error(getErrorMessage(payload, `无法查询公司的单点登录信息（${response.status}）。`));
    }

    const signInUrl = typeof (payload as { signInUrl?: unknown } | null)?.signInUrl === "string"
      ? (payload as { signInUrl: string }).signInUrl
      : "";
    if (!signInUrl) {
      return false;
    }

    const nextUrl = new URL(signInUrl, window.location.origin);
    nextUrl.searchParams.set("callbackURL", getSocialCallbackUrl());
    nextUrl.searchParams.set("loginHint", trimmedEmail);
    window.location.assign(nextUrl.toString());
    return true;
  }

  async function finalizeEmailPasswordSignIn(
    nextMode: AuthMode,
    trimmedEmail: string,
    payloadOverride?: unknown,
  ): Promise<AuthNavigationResult> {
    let payload = payloadOverride;

    if (payload === undefined || (!getToken(payload) && nextMode === "sign-up" && Boolean(password))) {
      const signInBody = {
        email: trimmedEmail,
        password,
      };

      const signInResult = await requestJson("/api/auth/sign-in/email", {
        method: "POST",
        body: JSON.stringify(signInBody)
      });

      if (!signInResult.response.ok) {
        setAuthError(getErrorMessage(signInResult.payload, `登录失败（${signInResult.response.status}）。`));
        trackPosthogEvent("den_auth_failed", {
          mode: nextMode,
          method: "email",
          status: signInResult.response.status
        });
        return null;
      }

      payload = signInResult.payload;
    }

    const token = getToken(payload);
    if (token) {
      setAuthToken(token);
    }

    let authenticatedUser: AuthUser | null = null;
    const payloadUser = getUser(payload);
    if (payloadUser) {
      authenticatedUser = payloadUser;
      setUser(payloadUser);
      setAuthInfo(`已使用 ${payloadUser.email} 登录。`);
      appendEvent("success", nextMode === "sign-up" ? "账号已创建" : "登录成功", payloadUser.email);
    } else {
      const refreshed = await refreshSession(true);
      if (refreshed) {
        authenticatedUser = refreshed;
        appendEvent("success", nextMode === "sign-up" ? "账号已创建" : "登录成功", refreshed.email);
      } else {
        setAuthInfo("登录成功，正在同步账号信息。");
      }
    }

    if (authenticatedUser) {
      identifyPosthogUser(authenticatedUser);
      const analyticsPayload = {
        mode: nextMode,
        method: "email",
        email_domain: getEmailDomain(authenticatedUser.email)
      };

      if (nextMode === "sign-up") {
        trackPosthogEvent("den_signup_completed", analyticsPayload);
      } else {
        trackPosthogEvent("den_signin_completed", analyticsPayload);
      }
    }

    if (desktopAuthRequested) {
      setAuthInfo("登录成功，正在返回 SeeWayWork...");
      return null;
    }

    if (webAuthRequested) {
      setAuthInfo("登录成功，正在返回 SeeWayWork...");
      return null;
    }

    if (authenticatedUser && (getPendingWorkspaceClaimToken() || getPendingOrgInvitationId())) {
      return "join-org";
    }

    if (authenticatedUser && nextMode === "sign-up") {
      return await beginSignupOnboarding(authenticatedUser, "email");
    }

    return "dashboard" as const;
  }

  async function resendVerificationCode() {
    if (isSingleOrgMode) {
      setAuthError("公司账号当前不需要邮箱验证码。");
      return;
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setAuthError("请先输入邮箱。");
      return;
    }

    setAuthBusy(true);
    setAuthError(null);
    try {
      const { response, payload } = await requestJson("/api/auth/email-otp/send-verification-otp", {
        method: "POST",
        body: JSON.stringify({
          email: trimmedEmail,
          type: "email-verification"
        })
      });

      if (!response.ok) {
        setAuthError(getErrorMessage(payload, `验证码发送失败（${response.status}）。`));
        return;
      }

      setAuthInfo(`新的验证码已经发送到 ${trimmedEmail}。`);
      appendEvent("info", "验证码已重新发送", trimmedEmail);
      trackPosthogEvent("den_signup_verification_sent", {
        method: "email",
        email_domain: getEmailDomain(trimmedEmail),
      });
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "验证码发送失败，请稍后再试。");
    } finally {
      setAuthBusy(false);
    }
  }

  async function submitVerificationCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSingleOrgMode) {
      setVerificationRequired(false);
      setAuthError("公司账号当前不需要邮箱验证码。");
      return null;
    }

    const trimmedEmail = email.trim();
    const otp = verificationCode.trim();
    if (!trimmedEmail || !otp) {
      setAuthError("请输入邮件中的验证码。");
      return null;
    }

    setAuthBusy(true);
    setAuthError(null);
    try {
      const { response, payload } = await requestJson("/api/auth/email-otp/verify-email", {
        method: "POST",
        body: JSON.stringify({
          email: trimmedEmail,
          otp,
        })
      });

      if (!response.ok) {
        setAuthError(getErrorMessage(payload, `验证码校验失败（${response.status}）。`));
        trackPosthogEvent("den_auth_failed", {
          mode: authMode,
          method: "email",
          status: response.status,
          reason: "verification_failed"
        });
        return null;
      }

      setVerificationRequired(false);
      setVerificationCode("");
      setAuthInfo(`${trimmedEmail} 已通过验证，正在完成登录。`);
      appendEvent("success", "邮箱验证成功", trimmedEmail);
      trackPosthogEvent("den_email_verified", {
        method: "email",
        email_domain: getEmailDomain(trimmedEmail),
      });

      return await finalizeEmailPasswordSignIn(authMode, trimmedEmail, payload);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "验证码校验失败，请重试。");
      return null;
    } finally {
      setAuthBusy(false);
    }
  }

  async function withResolvedOpenworkCredentials(candidate: WorkerLaunch, options: { quiet?: boolean } = {}) {
    const existingConnectUrl = candidate.openworkUrl?.trim() ?? "";
    const existingWorkspaceId = candidate.workspaceId?.trim() ?? "";
    if (existingConnectUrl && existingWorkspaceId) {
      return {
        ...candidate,
        openworkUrl: existingConnectUrl,
        workspaceId: existingWorkspaceId
      };
    }

    const instanceUrl = candidate.instanceUrl?.trim() ?? "";
    if (!instanceUrl) {
      return {
        ...candidate,
        openworkUrl: null,
        workspaceId: null
      };
    }

    const accessToken = candidate.clientToken?.trim() ?? candidate.ownerToken?.trim() ?? "";
    if (!accessToken) {
      const mountedWorkspaceId = parseWorkspaceIdFromUrl(instanceUrl);
      return {
        ...candidate,
        openworkUrl: instanceUrl.trim().replace(/\/+$/, ""),
        workspaceId: mountedWorkspaceId
      };
    }

    try {
      const resolved = await resolveOpenworkWorkspaceUrl(instanceUrl, accessToken);
      if (resolved) {
        return {
          ...candidate,
          openworkUrl: resolved.openworkUrl,
          workspaceId: resolved.workspaceId
        };
      }
    } catch {
      if (!options.quiet) {
        appendEvent("warning", "连接地址提示", "暂时无法获取工作区专用地址，已改用服务器地址。");
      }
    }

    return {
      ...candidate,
      openworkUrl: instanceUrl.trim().replace(/\/+$/, ""),
      workspaceId: parseWorkspaceIdFromUrl(instanceUrl)
    };
  }

  async function refreshWorkers(options: { keepSelection?: boolean; quiet?: boolean } = {}) {
    if (!user) {
      setWorkers([]);
      setWorkersLoadedOnce(false);
      setWorkersError(null);
      return;
    }

    if (!options.quiet) {
      setWorkersBusy(true);
      setWorkersError(null);
    }

    try {
      if (!pendingWorkersRequestRef.current) {
        pendingWorkersRequestRef.current = requestJson("/v1/workers?limit=20", {
          method: "GET",
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined
        });
      }

      const { response, payload } = await pendingWorkersRequestRef.current;

      if (!response.ok) {
        if (!options.quiet) {
          setWorkersError(getErrorMessage(payload, `远程工作区加载失败（${response.status}）。`));
        }
        setWorkersLoadedOnce(true);
        return;
      }

      const nextWorkers = getWorkersList(payload);
      setWorkers(nextWorkers);
      setWorkersLoadedOnce(true);

      const restoredWorkerStillExists =
        pendingRestoredWorkerId && nextWorkers.some((item) => item.workerId === pendingRestoredWorkerId);
      const currentSelection = options.keepSelection ? workerLookupId : "";
      const nextSelectedId =
        currentSelection && nextWorkers.some((item) => item.workerId === currentSelection)
          ? currentSelection
          : nextWorkers[0]?.workerId ?? "";
      const nextSelectedWorker = nextSelectedId
        ? nextWorkers.find((item) => item.workerId === nextSelectedId) ?? null
        : null;

      setWorkerLookupId(nextSelectedId);

      if (!nextSelectedId) {
        setWorker(null);
        setTokenFetchedForWorkerId(null);
        setPendingRestoredWorkerId(null);
        setLaunchStatus("请先选择或新建远程工作区。");
        if (typeof window !== "undefined") {
          window.localStorage.removeItem(LAST_WORKER_STORAGE_KEY);
        }
        return;
      }

      if (restoredWorkerStillExists) {
        setPendingRestoredWorkerId(null);
      }

      if (nextSelectedWorker) {
        setWorker((current) => listItemToWorker(nextSelectedWorker, current));
        if (!launchBusy) {
          setLaunchStatus(getWorkerStatusCopy(nextSelectedWorker.status));
        }
      }
    } catch (error) {
      if (!options.quiet) {
        setWorkersError(getCaughtErrorMessage(error, "无法加载远程工作区，请检查网络后重试。"));
      }
      setWorkersLoadedOnce(true);
    } finally {
      pendingWorkersRequestRef.current = null;
      if (!options.quiet) {
        setWorkersBusy(false);
      }
    }
  }

  function mergeWorkerSummaryIntoList(summary: WorkerSummary) {
    setWorkers((current) => current.map((entry) =>
      entry.workerId === summary.workerId
        ? {
            ...entry,
            workerName: summary.workerName,
            status: summary.status,
            provider: summary.provider,
            instanceUrl: summary.instanceUrl,
            isMine: summary.isMine,
          }
        : entry,
    ));
  }

  async function refreshRuntime(workerId?: string, options: { quiet?: boolean } = {}) {
    const targetWorkerId = workerId ?? activeWorker?.workerId ?? selectedWorker?.workerId ?? null;
    if (!user || !targetWorkerId) {
      setRuntimeSnapshot(null);
      if (!options.quiet) {
        setRuntimeError("请先选择一个远程工作区，再查看运行环境版本。");
      }
      return null;
    }

    setRuntimeBusy(true);
    if (!options.quiet) {
      setRuntimeError(null);
    }

    try {
      const { response, payload } = await requestJson(
        `/v1/workers/${encodeURIComponent(targetWorkerId)}/runtime`,
        {
          method: "GET",
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined
        },
        12000
      );

      if (!response.ok) {
        const message = getErrorMessage(payload, `运行环境检查失败（${response.status}）。`);
        if (!options.quiet) {
          setRuntimeError(message);
        }
        return null;
      }

      const snapshot = getWorkerRuntimeSnapshot(payload);
      if (!snapshot) {
        if (!options.quiet) {
          setRuntimeError("远程工作区没有返回完整的运行环境信息。");
        }
        return null;
      }

      setRuntimeSnapshot(snapshot);
      return snapshot;
    } catch (error) {
      const message = getCaughtErrorMessage(error, "无法检查运行环境，请稍后重试。");
      if (!options.quiet) {
        setRuntimeError(message);
      }
      return null;
    } finally {
      setRuntimeBusy(false);
    }
  }

  async function upgradeRuntime() {
    const targetWorkerId = activeWorker?.workerId ?? selectedWorker?.workerId ?? null;
    if (!user || !targetWorkerId || runtimeUpgradeBusy) {
      return;
    }

    setRuntimeUpgradeBusy(true);
    setRuntimeError(null);

    try {
      const { response, payload } = await requestJson(
        `/v1/workers/${encodeURIComponent(targetWorkerId)}/runtime/upgrade`,
        {
          method: "POST",
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
          body: JSON.stringify({ services: ["openwork-server", "opencode"] })
        },
        12000
      );

      if (!response.ok) {
        const message = getErrorMessage(payload, `运行环境升级失败（${response.status}）。`);
        setRuntimeError(message);
        appendEvent("error", "运行环境升级失败", message);
        return;
      }

      appendEvent("info", "运行环境开始升级", activeWorker?.workerName ?? selectedWorker?.workerName ?? targetWorkerId);
      setRuntimeSnapshot((current) =>
        current
          ? {
              ...current,
              upgrade: {
                ...current.upgrade,
                status: "running",
                startedAt: new Date().toISOString(),
                finishedAt: null,
                error: null
              }
            }
          : current
      );

      window.setTimeout(() => {
        void refreshRuntime(targetWorkerId, { quiet: true });
      }, 4000);
    } catch (error) {
      const message = getCaughtErrorMessage(error, "无法启动运行环境升级，请稍后重试。");
      setRuntimeError(message);
      appendEvent("error", "运行环境升级失败", message);
    } finally {
      setRuntimeUpgradeBusy(false);
    }
  }

  async function refreshBilling(options: { quiet?: boolean } = {}) {
    if (!user) {
      setBillingSummary(null);
      if (!options.quiet) {
        setBillingError("请先登录，再查看服务方案信息。");
      }
      return null;
    }

    const quiet = options.quiet === true;
    setBillingBusy(true);

    if (!quiet) {
      setBillingError(null);
    }

    try {
      const { response, payload } = await requestJson(
        "/v1/billing",
        {
          method: "GET",
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined
        },
        12000
      );

      if (!response.ok) {
        const message = getErrorMessage(payload, `服务方案查询失败（${response.status}）。`);
        if (!quiet) {
          setBillingError(message);
          appendEvent("error", "服务方案检查失败", message);
        }
        return null;
      }

      const summary = getBillingSummary(payload);
      if (!summary) {
        if (!quiet) {
          setBillingError("公司服务没有返回完整的服务方案信息。");
          appendEvent("error", "服务方案检查失败", "服务方案信息不完整");
        }
        return null;
      }

      setBillingSummary(summary);
      setBillingLoadedOnce(true);

      return summary;
    } catch (error) {
      const message = getCaughtErrorMessage(error, "无法查询服务方案，请稍后重试。");
      if (!quiet) {
        setBillingError(message);
        appendEvent("error", "服务方案检查失败", message);
      }
      return null;
    } finally {
      setBillingBusy(false);
    }
  }

  async function copyToClipboard(field: string, value: string | null) {
    if (!value) {
      return;
    }

    await navigator.clipboard.writeText(value);
    setCopiedField(field);
    setTimeout(() => {
      setCopiedField((current) => (current === field ? null : current));
    }, 1800);
  }

  async function refreshSession(quiet = false) {
    const headers = new Headers();
    if (authToken) {
      headers.set("Authorization", `Bearer ${authToken}`);
    }

    const { response, payload } = await requestJson("/v1/me", { method: "GET", headers }, 12000);

    if (!response.ok) {
      setUser(null);
      if (response.status === 401 && authToken) {
        setAuthToken(null);
      }
      if (!quiet) {
        setAuthError("登录状态已经失效，请重新登录。");
      }
      return null;
    }

    const sessionUser = getUser(payload);
    if (!sessionUser) {
      if (!quiet) {
        setAuthError("没有读取到账号信息，请重新登录。");
      }
      return null;
    }

    setUser(sessionUser);
    setAuthInfo(`已使用 ${sessionUser.email} 登录。`);
    return sessionUser;
  }

  async function loadOrgDirectory() {
    const headers = new Headers();
    if (authToken) {
      headers.set("Authorization", `Bearer ${authToken}`);
    }

    const { response, payload } = await requestJson("/v1/me/orgs", { method: "GET", headers }, 12000);
    if (!response.ok) {
      return {
        orgs: [],
        activeOrgId: null,
        activeOrgSlug: null,
      };
    }

    return parseOrgListPayload(payload);
  }

  async function resolveDashboardRoute() {
    const orgDirectory = await loadOrgDirectory();
    if (typeof window !== "undefined" && shouldOfferOrgSelection(orgDirectory.orgs)) {
      window.sessionStorage.setItem(PENDING_ORG_SELECTION_STORAGE_KEY, "1");
    }

    const activeOrgSlug = orgDirectory.activeOrgSlug ?? orgDirectory.orgs[0]?.slug ?? null;
    return activeOrgSlug ? getOrgDashboardRoute(activeOrgSlug) : null;
  }

  async function completeDesktopAuthHandoff() {
    if (!desktopAuthRequested || desktopRedirectBusy) {
      return;
    }

    setDesktopRedirectBusy(true);
    setDesktopRedirectAttempted(true);
    setAuthError(null);

    try {
      const headers = new Headers();
      if (authToken) {
        headers.set("Authorization", `Bearer ${authToken}`);
      }

      const { response, payload } = await requestJson("/v1/auth/desktop-handoff", {
        method: "POST",
        headers,
        body: JSON.stringify({ desktopScheme: desktopAuthScheme })
      });

      if (!response.ok) {
        setAuthError(getErrorMessage(payload, `SeeWayWork 登录交接失败（${response.status}）。`));
        return;
      }

      const openworkUrl = getDesktopHandoffOpenworkUrl(payload) ?? "";
      if (!openworkUrl) {
        setAuthError("登录已经完成，但没有收到 SeeWayWork 打开地址。");
        return;
      }

      rememberDesktopHandoffGrant(getDesktopHandoffGrant(payload, openworkUrl));
      setDesktopRedirectUrl(openworkUrl);
      window.location.assign(openworkUrl);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "无法打开 SeeWayWork。");
    } finally {
      setDesktopRedirectBusy(false);
    }
  }

  function getWebHandoffReturnUrl(payload: unknown) {
    if (typeof payload !== "object" || payload === null || !("returnUrl" in payload)) {
      return null;
    }

    const returnUrl = payload.returnUrl;
    return typeof returnUrl === "string" && returnUrl.trim() ? returnUrl.trim() : null;
  }

  async function completeWebAuthHandoff() {
    if (!webAuthRequested || webRedirectBusy) {
      return;
    }

    setWebRedirectBusy(true);
    setWebRedirectAttempted(true);
    setAuthError(null);

    try {
      if (!webAuthReturnUrl) {
        setAuthError("网页交接失败：没有提供返回地址。");
        return;
      }

      const headers = new Headers();
      if (authToken) {
        headers.set("Authorization", `Bearer ${authToken}`);
      }

      const { response, payload } = await requestJson("/v1/auth/desktop-handoff", {
        method: "POST",
        headers,
        body: JSON.stringify({ returnUrl: webAuthReturnUrl })
      });

      if (!response.ok) {
        setAuthError(getErrorMessage(payload, `Web handoff failed with ${response.status}.`));
        return;
      }

      const grant = getDesktopHandoffGrant(payload, null) ?? "";
      const approvedReturnUrl = getWebHandoffReturnUrl(payload) ?? "";
      if (!grant || !approvedReturnUrl) {
          setAuthError("网页交接已完成，但公司服务没有返回云端工作区地址。");
        return;
      }

      const redirectUrl = new URL(approvedReturnUrl);
      redirectUrl.searchParams.set("grant", grant);
      window.location.replace(redirectUrl.toString());
    } catch (error) {
        setAuthError(error instanceof Error ? error.message : "无法返回云端工作区。");
    } finally {
      setWebRedirectBusy(false);
    }
  }

  async function beginSignupOnboarding(authenticatedUser: AuthUser, _authMethod: AuthMethod) {
    const autoName = deriveOnboardingWorkerName(authenticatedUser);
    setWorkerName(autoName);
    setLaunchError(null);
    setLaunchStatus("账号已就绪，请在 SeeWayWork 中新建本地或远程工作区。");
    persistOnboardingIntent(null);
    return "dashboard" as const;
  }

  async function resolveUserLandingRoute() {
    // 此处有意不检查 desktopAuthRequested：自动跳转由调用方自行限制，
    // 用户主动点击“进入管理后台”时，即使桌面交接正在进行，也必须能够解析目标地址。
    if (!user) {
      return null;
    }

    const pendingClaimToken = getPendingWorkspaceClaimToken();
    if (pendingClaimToken) {
      return getWorkspaceClaimRoute(pendingClaimToken);
    }

    const pendingInvitationId = getPendingOrgInvitationId();
    if (pendingInvitationId) {
      return getJoinOrgRoute(pendingInvitationId);
    }

    const dashboardRoute = await resolveDashboardRoute();

    if (dashboardRoute) {
      if (getPendingAuthIntent() === "models") {
        clearPendingAuthIntent();
        return getInferenceRoute();
      }

      return dashboardRoute;
    }

    return "/organization";
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setAuthBusy(true);
    setAuthError(null);
    const submitMode: AuthMode = isSingleOrgMode && !runtimeConfig.singleOrgAllowPublicSignup && authMode === "sign-up" ? "sign-in" : authMode;
    trackPosthogEvent("den_auth_submitted", {
      mode: submitMode,
      method: "email"
    });

    try {
      const endpoint = submitMode === "sign-up" ? "/api/auth/sign-up/email" : "/api/auth/sign-in/email";
      const trimmedEmail = email.trim();
      if (trimmedEmail && await redirectToRequiredSso(trimmedEmail)) {
        return null;
      }
      const body =
        submitMode === "sign-up"
          ? {
              name: authName.trim() || DEFAULT_AUTH_NAME,
              email: trimmedEmail,
              password
            }
          : {
              email: trimmedEmail,
              password
            };

      const { response, payload } = await requestJson(endpoint, {
        method: "POST",
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        if (response.status === 403 && !isSingleOrgMode) {
          openVerificationStep(trimmedEmail, `请输入发送到 ${trimmedEmail} 的 6 位验证码。`);
        }
        setAuthError(getErrorMessage(payload, `登录失败（${response.status}）。`));
        trackPosthogEvent("den_auth_failed", {
          mode: submitMode,
          method: "email",
          status: response.status
        });
        return null;
      }

      const token = getToken(payload);

      if (submitMode === "sign-up" && !token) {
        setUser(null);
        openVerificationStep(trimmedEmail, `6 位验证码已经发送到 ${trimmedEmail}，输入验证码即可完成注册。`);
        appendEvent("info", "验证码已发送", trimmedEmail);
        trackPosthogEvent("den_signup_verification_sent", {
          method: "email",
          email_domain: getEmailDomain(trimmedEmail),
        });
        return null;
      }
      return await finalizeEmailPasswordSignIn(submitMode, trimmedEmail);
    } catch (error) {
      const message = error instanceof Error ? error.message : "网络连接失败，请稍后再试。";
      setAuthError(message);
      trackPosthogEvent("den_auth_failed", {
        mode: submitMode,
        method: "email",
        reason: "network_error"
      });
      return null;
    } finally {
      setAuthBusy(false);
    }
  }

  async function beginSocialAuth(provider: SocialAuthProvider) {
    if (authBusy || typeof window === "undefined") {
      return;
    }

    const shouldTrackSocialSignup = authMode === "sign-up";
    if (shouldTrackSocialSignup) {
      window.sessionStorage.setItem(PENDING_SOCIAL_SIGNUP_STORAGE_KEY, provider);
    }

    setAuthBusy(true);
    setAuthError(null);
    setAuthInfo(`正在前往 ${getSocialProviderLabel(provider)}...`);
    trackPosthogEvent("den_auth_submitted", {
      mode: authMode,
      method: provider
    });

    try {
      const trimmedEmail = email.trim();
      if (trimmedEmail && await redirectToRequiredSso(trimmedEmail)) {
        if (shouldTrackSocialSignup) {
          window.sessionStorage.removeItem(PENDING_SOCIAL_SIGNUP_STORAGE_KEY);
        }
        return;
      }
      const latestRuntimeConfig = await getRuntimeConfig();
      setRuntimeConfig(latestRuntimeConfig);
      const callbackURL = getSocialCallbackUrl(latestRuntimeConfig.openworkAuthCallbackUrl);
      const { response, payload } = await requestJson("/api/auth/sign-in/social", {
        method: "POST",
        body: JSON.stringify({
          provider,
          callbackURL,
          errorCallbackURL: callbackURL
        })
      });

      if (!response.ok) {
        if (shouldTrackSocialSignup) {
          window.sessionStorage.removeItem(PENDING_SOCIAL_SIGNUP_STORAGE_KEY);
        }
        setAuthInfo(getAuthInfoForMode(authMode));
        setAuthError(getErrorMessage(payload, `${getSocialProviderLabel(provider)} 登录失败（${response.status}）。`));
        setAuthBusy(false);
        return;
      }

      const socialPayload = payload as { url?: unknown } | null;
      const payloadUrl = typeof socialPayload?.url === "string" ? socialPayload.url.trim() : "";
      const headerUrl = response.headers.get("location")?.trim() ?? "";
      const redirectUrl = payloadUrl || headerUrl;

      if (!redirectUrl) {
        if (shouldTrackSocialSignup) {
          window.sessionStorage.removeItem(PENDING_SOCIAL_SIGNUP_STORAGE_KEY);
        }
        setAuthInfo(getAuthInfoForMode(authMode));
        setAuthError(`${getSocialProviderLabel(provider)} 没有返回登录地址。`);
        setAuthBusy(false);
        return;
      }

      window.location.assign(redirectUrl);
    } catch (error) {
      if (shouldTrackSocialSignup) {
        window.sessionStorage.removeItem(PENDING_SOCIAL_SIGNUP_STORAGE_KEY);
      }
      setAuthInfo(getAuthInfoForMode(authMode));
      setAuthError(error instanceof Error ? error.message : "网络连接失败，请稍后再试。");
      setAuthBusy(false);
    }
  }

  async function signOut() {
    if (authBusy) {
      return;
    }

    setAuthBusy(true);
    setAuthError(null);

    try {
      await requestJson("/api/auth/sign-out", {
        method: "POST",
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        body: JSON.stringify({})
      });
    } catch {
      // 即使退出请求未送达，也要清理本地登录状态。
    } finally {
      setAuthBusy(false);
    }

    setUser(null);
    setAuthToken(null);
    setWorker(null);
    setWorkers([]);
    setWorkerLookupId("");
    setWorkersError(null);
    setLaunchError(null);
    setBillingSummary(null);
    setBillingError(null);
    setOrgLimitError(null);
    setBillingBusy(false);
    setBillingLoadedOnce(false);
    setTokenFetchedForWorkerId(null);
    setDeleteBusyWorkerId(null);
    setActionBusy(null);
    setLaunchBusy(false);
    setRuntimeSnapshot(null);
    setRuntimeError(null);
    setRuntimeUpgradeBusy(false);
    setPendingRestoredWorkerId(null);
    setDesktopRedirectUrl(null);
    setDesktopRedirectAttempted(false);
    setAuthMode("sign-up");
    setEmail("");
    setAuthName("");
    setPassword("");
    setAuthInfo(getAuthInfoForMode("sign-up"));
    setLaunchStatus("请先选择或新建远程工作区。");
    setEvents([]);
    setWorkerQuery("");
    setWorkerStatusFilter("all");
    setWorkerName(DEFAULT_WORKER_NAME);
    persistOnboardingIntent(null);
    resetPosthogUser();
    trackPosthogEvent("den_signout_completed", { method: "manual" });

    if (typeof window !== "undefined") {
      window.localStorage.removeItem(LAST_WORKER_STORAGE_KEY);
      window.sessionStorage.removeItem(PENDING_SOCIAL_SIGNUP_STORAGE_KEY);
      window.sessionStorage.removeItem(PENDING_ORG_INVITATION_STORAGE_KEY);
      window.sessionStorage.removeItem(PENDING_WORKSPACE_CLAIM_STORAGE_KEY);
    }
  }

  async function updateUserProfile(input: { firstName: string; lastName: string }) {
    const { response, payload } = await requestJson(
      "/v1/me/profile",
      {
        method: "PATCH",
        body: JSON.stringify(input),
      },
      12000,
    );

    if (!response.ok) {
      throw new Error(getErrorMessage(payload, `个人资料更新失败（${response.status}）。`));
    }

    const nextUser = getUser(payload);
    if (!nextUser) {
      throw new Error("公司服务没有返回更新后的账号信息。");
    }

    setUser(nextUser);
    identifyPosthogUser(nextUser);
    return nextUser;
  }

  async function launchWorker(options: { source?: "manual" | "signup_auto"; workerNameOverride?: string } = {}) {
    if (!user) {
      setAuthError("请先登录，再新建远程工作区。");
      return "error" as const;
    }

    const resolvedLaunchName = options.workerNameOverride?.trim() || workerName.trim() || DEFAULT_WORKER_NAME;

    setLaunchBusy(true);
    setLaunchError(null);
    setOrgLimitError(null);
    setLaunchStatus(options.source === "signup_auto" ? "正在准备第一个远程工作区..." : "正在检查远程工作区创建条件...");
    appendEvent("info", "已提交创建请求", resolvedLaunchName);

    try {
      const { response, payload } = await requestJson(
        "/v1/workers",
        {
          method: "POST",
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
          body: JSON.stringify({
            name: resolvedLaunchName,
            destination: "cloud"
          })
        },
        12000
      );

      const limitError = getOrgLimitError(payload);
      if (limitError) {
        setOrgLimitError(limitError);
        setLaunchStatus(limitError.message);
        setLaunchError(limitError.message);
        appendEvent("warning", "远程工作区数量已达上限", limitError.message);
        return "limit" as const;
      }

      if (response.status === 402) {
        setBillingSummary((current) => {
          if (!current) {
            return current;
          }

          return {
            ...current,
            hasActivePlan: false,
            checkoutRequired: true,
          };
        });
        const message = getErrorMessage(payload, "当前账号暂时不能新建远程工作区，请联系管理员。");
        setLaunchStatus(message);
        setLaunchError(message);
        appendEvent("warning", "暂时无法新建远程工作区", message);
        return "error" as const;
      }

      if (!response.ok) {
        const message = getErrorMessage(payload, `远程工作区创建失败（${response.status}）。`);
        setLaunchError(message);
        setLaunchStatus("创建失败，请处理提示后重试。");
        appendEvent("error", "远程工作区创建失败", message);
        return "error" as const;
      }

      const parsedWorker = getWorker(payload);
      if (!parsedWorker) {
        setLaunchError("公司服务没有返回远程工作区详情。");
        setLaunchStatus("公司服务返回的数据格式异常，请重试。");
        appendEvent("error", "远程工作区创建失败", "远程工作区信息不完整");
        return "error" as const;
      }

      const resolvedWorker = await withResolvedOpenworkCredentials(parsedWorker);
      setWorker(resolvedWorker);
      setWorkerLookupId(parsedWorker.workerId);
      setPendingRestoredWorkerId(null);

      if (resolvedWorker.status === "provisioning") {
        setLaunchStatus("远程工作区正在准备中，系统会自动更新进度。");
        appendEvent("info", "远程工作区开始准备", `工作区 ID：${parsedWorker.workerId}`);
      } else {
        setLaunchStatus(getWorkerStatusCopy(resolvedWorker.status));
        appendEvent("success", "远程工作区创建完成", `工作区 ID：${parsedWorker.workerId}`);
      }

      markOnboardingComplete();
      return "success" as const;
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === "AbortError"
          ? "创建请求耗时较长，后台可能仍在准备远程工作区，请稍后刷新状态。"
          : getCaughtErrorMessage(error, "远程工作区创建请求失败，请稍后重试。");

      setLaunchError(message);
      setLaunchStatus("远程工作区创建请求失败。");
      appendEvent("error", "远程工作区创建失败", message);
      return "error" as const;
    } finally {
      setLaunchBusy(false);
      void refreshWorkers({ keepSelection: true });
    }
  }

  async function checkWorkerStatus(options: { workerId?: string; quiet?: boolean; background?: boolean } = {}) {
    const quiet = options.quiet === true;
    const background = options.background === true;

    if (!user) {
      if (!quiet) {
        setLaunchError("请先登录，再查看远程工作区状态。");
      }
      return;
    }

    const fallbackId = workerLookupId.trim() || worker?.workerId || workers[0]?.workerId || "";
    const id = options.workerId ?? fallbackId;
    if (!id) {
      if (!quiet) {
        setLaunchError("请先选择或新建一个远程工作区。");
      }
      return;
    }

    if (!background) {
      setWorkerLookupId(id);
    }

    if (!background) {
      setActionBusy("status");
    }
    if (!quiet) {
      setLaunchError(null);
    }

    try {
      const { response, payload } = await requestJson(`/v1/workers/${encodeURIComponent(id)}`, {
        method: "GET",
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined
      });

      if (!response.ok) {
        const message = getErrorMessage(payload, `远程工作区状态查询失败（${response.status}）。`);
        if (!quiet) {
          setLaunchError(message);
          appendEvent("error", "状态查询失败", message);
        }
        return;
      }

      const summary = getWorkerSummary(payload);
      if (!summary) {
        if (!quiet) {
          setLaunchError("公司服务没有返回远程工作区状态详情。");
          appendEvent("error", "状态查询失败", "远程工作区状态信息不完整");
        }
        return;
      }

      mergeWorkerSummaryIntoList(summary);

      const previousStatus = worker?.workerId === summary.workerId ? worker.status : null;
      const nextWorker: WorkerLaunch =
        worker && worker.workerId === summary.workerId
          ? {
              ...worker,
              workerName: summary.workerName,
              status: summary.status,
              provider: summary.provider,
              instanceUrl: summary.instanceUrl
            }
          : {
              workerId: summary.workerId,
              workerName: summary.workerName,
              status: summary.status,
              provider: summary.provider,
              instanceUrl: summary.instanceUrl,
              openworkUrl: summary.instanceUrl,
              workspaceId: null,
              clientToken: null,
              ownerToken: null,
              hostToken: null
            };

      const shouldUpdateActiveWorker = worker?.workerId === summary.workerId || (!background && workerLookupId === summary.workerId);
      if (shouldUpdateActiveWorker) {
        const resolvedWorker = await withResolvedOpenworkCredentials(nextWorker, { quiet: true });
        setWorker(resolvedWorker);
        setPendingRestoredWorkerId(null);
        if (!background) {
          setWorkerLookupId(summary.workerId);
        }
      }

      if (!quiet) {
        setLaunchStatus(`${summary.workerName}：${getWorkerStatusCopy(summary.status)}`);
        appendEvent("info", "状态已更新", `${summary.workerName}：${getWorkerStatusCopy(summary.status)}`);
      } else if (previousStatus && previousStatus !== summary.status) {
        setLaunchStatus(getWorkerStatusCopy(summary.status));

        if (summary.status === "healthy") {
          appendEvent("success", "远程工作区准备完成", `${summary.workerName} 已可连接`);
          markOnboardingComplete();
        } else if (summary.status === "failed") {
          appendEvent("error", "远程工作区准备失败", `${summary.workerName} 未能完成准备`);
        } else {
          appendEvent("info", "准备进度已更新", `${summary.workerName}：${getWorkerStatusCopy(summary.status)}`);
        }
      }

    } catch (error) {
      if (!quiet) {
        setLaunchError(getCaughtErrorMessage(error, "无法查询远程工作区状态，请稍后重试。"));
      }
    } finally {
      if (!background) {
        setActionBusy(null);
      }
    }
  }

  async function generateWorkerToken() {
    if (!user) {
      setLaunchError("请先登录，再获取远程工作区连接凭据。");
      return;
    }

    const id = workerLookupId.trim() || worker?.workerId || workers[0]?.workerId || "";
    if (!id) {
      setLaunchError("请先选择或新建一个远程工作区。");
      return;
    }

    setWorkerLookupId(id);
    setActionBusy("token");
    setLaunchError(null);

    try {
      const { response, payload } = await requestJson(`/v1/workers/${encodeURIComponent(id)}/tokens`, {
        method: "POST",
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        body: JSON.stringify({})
      });

      if (!response.ok) {
        const message = getErrorMessage(payload, `连接凭据获取失败（${response.status}）。`);
        setLaunchError(message);
        appendEvent("error", "连接凭据获取失败", message);
        return;
      }

      const tokens = getWorkerTokens(payload);
      if (!tokens) {
        setLaunchError("公司服务没有返回可用的连接凭据。");
        appendEvent("error", "连接凭据获取失败", "连接凭据信息不完整");
        return;
      }

      const nextWorker: WorkerLaunch =
        worker && worker.workerId === id
          ? {
              ...worker,
              openworkUrl: tokens.openworkUrl ?? worker.openworkUrl,
              workspaceId: tokens.workspaceId ?? worker.workspaceId,
              clientToken: tokens.clientToken,
              ownerToken: tokens.ownerToken,
              hostToken: tokens.hostToken
            }
          : {
              workerId: id,
              workerName: "已有远程工作区",
              status: "unknown",
              provider: null,
              instanceUrl: null,
              openworkUrl: tokens.openworkUrl,
              workspaceId: tokens.workspaceId,
              clientToken: tokens.clientToken,
              ownerToken: tokens.ownerToken,
              hostToken: tokens.hostToken
            };

      const resolvedWorker = await withResolvedOpenworkCredentials(nextWorker, { quiet: true });
      setWorker(resolvedWorker);
      setPendingRestoredWorkerId(null);
      setLaunchStatus("远程工作区已可连接。");
      appendEvent("success", "连接凭据已就绪", `工作区 ID：${id}`);
    } catch (error) {
      const message = getCaughtErrorMessage(error, "无法获取连接凭据，请稍后重试。");
      setLaunchError(message);
      appendEvent("error", "连接凭据获取失败", message);
    } finally {
      setActionBusy(null);
    }
  }

  async function renameWorker(workerId: string, name: string) {
    if (!user) {
      setLaunchError("请先登录，再重命名远程工作区。");
      return false;
    }

    const nextName = name.trim();
    if (!nextName) {
      setLaunchError("请输入远程工作区名称。");
      return false;
    }

    setRenameBusyWorkerId(workerId);
    setLaunchError(null);

    try {
      const { response, payload } = await requestJson(`/v1/workers/${encodeURIComponent(workerId)}`, {
        method: "PATCH",
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        body: JSON.stringify({ name: nextName })
      });

      if (!response.ok) {
        const message = getErrorMessage(payload, `重命名失败（${response.status}）。`);
        setLaunchError(message);
        appendEvent("error", "重命名失败", message);
        return false;
      }

      setWorkers((current) => current.map((entry) => entry.workerId === workerId ? { ...entry, workerName: nextName } : entry));
      setWorker((current) => current && current.workerId === workerId ? { ...current, workerName: nextName } : current);
      setLaunchStatus(`远程工作区已重命名为“${nextName}”。`);
      appendEvent("success", "远程工作区已重命名", nextName);
      return true;
    } catch (error) {
      const message = getCaughtErrorMessage(error, "无法重命名远程工作区，请稍后重试。");
      setLaunchError(message);
      appendEvent("error", "重命名失败", message);
      return false;
    } finally {
      setRenameBusyWorkerId(null);
    }
  }

  async function deleteWorker(workerId: string) {
    if (!user) {
      setLaunchError("请先登录，再删除远程工作区。");
      return;
    }

    if (deleteBusyWorkerId || redeployBusyWorkerId || actionBusy !== null || launchBusy) {
      return;
    }

    const target = workers.find((entry) => entry.workerId === workerId) ?? null;
    const workerLabel = target?.workerName ?? "这个远程工作区";

    if (typeof window !== "undefined") {
      const confirmed = window.confirm(`确定删除“${workerLabel}”吗？删除后它将不再出现在远程工作区列表中。`);
      if (!confirmed) {
        return;
      }
    }

    setDeleteBusyWorkerId(workerId);
    setLaunchError(null);

    try {
      const { response, payload } = await requestJson(`/v1/workers/${encodeURIComponent(workerId)}`, {
        method: "DELETE",
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined
      });

      if (response.status !== 204 && !response.ok) {
        const message = getErrorMessage(payload, `删除失败（${response.status}）。`);
        setLaunchError(message);
        appendEvent("error", "远程工作区删除失败", message);
        return;
      }

      setWorkers((current) => current.filter((entry) => entry.workerId !== workerId));
      setWorker((current) => (current && current.workerId === workerId ? null : current));
      setPendingRestoredWorkerId((current) => (current === workerId ? null : current));
      setWorkerLookupId((current) => (current === workerId ? "" : current));

      if (typeof window !== "undefined" && worker?.workerId === workerId) {
        window.localStorage.removeItem(LAST_WORKER_STORAGE_KEY);
      }

      setLaunchStatus(`已删除“${workerLabel}”。`);
      appendEvent("success", "远程工作区已删除", workerLabel);
      await refreshWorkers({ keepSelection: false });
    } catch (error) {
      const message = getCaughtErrorMessage(error, "无法删除远程工作区，请稍后重试。");
      setLaunchError(message);
      appendEvent("error", "远程工作区删除失败", message);
    } finally {
      setDeleteBusyWorkerId(null);
    }
  }

  async function redeployWorker(workerId: string) {
    if (!user) {
      setLaunchError("请先登录，再重新部署远程工作区。");
      return;
    }

    if (redeployBusyWorkerId || deleteBusyWorkerId || actionBusy !== null || launchBusy) {
      return;
    }

    const target = workers.find((entry) => entry.workerId === workerId) ?? null;
    const workerLabel = target?.workerName?.trim() || DEFAULT_WORKER_NAME;

    if (typeof window !== "undefined") {
      const confirmed = window.confirm(`确定重新部署“${workerLabel}”吗？当前实例会被删除，并用相同名称重新创建。`);
      if (!confirmed) {
        return;
      }
    }

    setRedeployBusyWorkerId(workerId);
    setLaunchError(null);
    setLaunchStatus(`正在重新部署“${workerLabel}”...`);
    appendEvent("info", "已提交重新部署请求", workerLabel);

    try {
      const { response: deleteResponse, payload: deletePayload } = await requestJson(`/v1/workers/${encodeURIComponent(workerId)}`, {
        method: "DELETE",
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined
      });

      if (deleteResponse.status !== 204 && !deleteResponse.ok) {
        const message = getErrorMessage(deletePayload, `重新部署时删除旧实例失败（${deleteResponse.status}）。`);
        setLaunchError(message);
        appendEvent("error", "重新部署失败", message);
        return;
      }

      const outcome = await launchWorker({ source: "manual", workerNameOverride: workerLabel });
      if (outcome === "success") {
        appendEvent("success", "远程工作区已重新部署", workerLabel);
      }
    } finally {
      setRedeployBusyWorkerId(null);
      void refreshWorkers({ keepSelection: true });
    }
  }

  function selectWorker(item: WorkerListItem) {
    setWorkerLookupId(item.workerId);
    setWorker((current) => listItemToWorker(item, current));
  }

  useEffect(() => {
    let cancelled = false;

    void getRuntimeConfig().then((config) => {
      if (!cancelled) {
        setRuntimeConfig(config);
        setRuntimeConfigLoaded(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const requestedMode = normalizeAuthModeParam(params.get("mode"));
    if (requestedMode) {
      setAuthMode(requestedMode);
    }

    setDesktopAuthRequested(params.get("desktopAuth") === "1");
    const requestedScheme = params.get("desktopScheme")?.trim() ?? "";
    setDesktopAuthScheme(normalizeFoxWorkDesktopScheme(requestedScheme));
    setWebAuthRequested(params.get("webAuth") === "1");
    const requestedWebReturnUrl = params.get("webAuthReturn")?.trim() ?? "";
    setWebAuthReturnUrl(requestedWebReturnUrl || null);

    const invitationId = params.get("invite")?.trim() ?? "";
    if (invitationId) {
      window.sessionStorage.setItem(PENDING_ORG_INVITATION_STORAGE_KEY, invitationId);
    }

    const requestedIntent = normalizeAuthIntentParam(params.get("intent"));
    if (requestedIntent) {
      window.sessionStorage.setItem(PENDING_AUTH_INTENT_STORAGE_KEY, requestedIntent);
    }
  }, []);

  useEffect(() => {
    if (authToken) {
      window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, authToken);
    } else {
      window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    }
  }, [authToken]);

  useEffect(() => {
    let cancelled = false;

    const hydrateSession = async () => {
      try {
        await refreshSession(true);
      } finally {
        if (!cancelled) {
          setSessionHydrated(true);
        }
      }
    };

    void hydrateSession();

    return () => {
      cancelled = true;
    };
  }, [authToken]);

  useEffect(() => {
    if (!user) {
      setWorkers([]);
      setWorkersLoadedOnce(false);
      setWorkersError(null);
      return;
    }

    void refreshWorkers();
  }, [user?.id, authToken]);

  useEffect(() => {
    if (!user) {
      setBillingSummary(null);
      setBillingError(null);
      setBillingLoadedOnce(false);
      return;
    }

    void refreshBilling({ quiet: true });
  }, [user?.id, authToken]);

  useEffect(() => {
    if (!user) {
      return;
    }

    identifyPosthogUser(user);
  }, [user?.id]);

  useEffect(() => {
    if (!user || typeof window === "undefined") {
      return;
    }

    const pendingSocialSignup = window.sessionStorage.getItem(PENDING_SOCIAL_SIGNUP_STORAGE_KEY);
    if (pendingSocialSignup !== "github" && pendingSocialSignup !== "google") {
      return;
    }
    if (socialSignupHandledRef.current === user.id) {
      return;
    }

    socialSignupHandledRef.current = user.id;
    window.sessionStorage.removeItem(PENDING_SOCIAL_SIGNUP_STORAGE_KEY);
    trackPosthogEvent("den_signup_completed", {
      mode: "sign-up",
      method: pendingSocialSignup,
      email_domain: getEmailDomain(user.email)
    });

    if (getPendingOrgInvitationId()) {
      return;
    }

    void beginSignupOnboarding(user, pendingSocialSignup);
  }, [user?.id]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const raw = window.localStorage.getItem(LAST_WORKER_STORAGE_KEY);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!isWorkerLaunch(parsed)) {
        return;
      }

      const restored: WorkerLaunch = {
        ...parsed,
        openworkUrl: parsed.openworkUrl ?? parsed.instanceUrl,
        workspaceId: parsed.workspaceId ?? parseWorkspaceIdFromUrl(parsed.instanceUrl ?? ""),
        clientToken: null,
        ownerToken: null,
        hostToken: null
      };

      setWorker(restored);
      setWorkerLookupId(restored.workerId);
      setPendingRestoredWorkerId(restored.workerId);
      setLaunchStatus(`已恢复远程工作区“${restored.workerName}”。${getWorkerStatusCopy(restored.status)}`);
      appendEvent("info", "已恢复远程工作区记录", `工作区 ID：${restored.workerId}`);
    } catch {
      // 忽略无法解析的旧版远程工作区缓存。
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !worker) {
      return;
    }

    const serializable: WorkerLaunch = {
      ...worker,
      clientToken: null,
      ownerToken: null,
      hostToken: null
    };

    window.localStorage.setItem(LAST_WORKER_STORAGE_KEY, JSON.stringify(serializable));
  }, [worker]);

  useEffect(() => {
    if (!user || !worker) {
      return;
    }
    if (pendingRestoredWorkerId === worker.workerId) {
      return;
    }
    if (worker.ownerToken || worker.clientToken) {
      return;
    }
    if (actionBusy !== null || launchBusy) {
      return;
    }
    if (tokenFetchedForWorkerId === worker.workerId) {
      return;
    }

    setTokenFetchedForWorkerId(worker.workerId);
    void generateWorkerToken();
  }, [actionBusy, launchBusy, pendingRestoredWorkerId, tokenFetchedForWorkerId, user, worker]);

  const provisioningWorkerIds = workers
    .filter((item) => item.status === "provisioning")
    .map((item) => item.workerId);

  useEffect(() => {
    if (!user || provisioningWorkerIds.length === 0) {
      return;
    }

    let cancelled = false;
    const poll = async () => {
      if (cancelled || actionBusy !== null || launchBusy) {
        return;
      }

      await Promise.all(
        provisioningWorkerIds.map((workerId) =>
          checkWorkerStatus({ workerId, quiet: true, background: true }),
        ),
      );
    };

    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, WORKER_STATUS_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [actionBusy, launchBusy, provisioningWorkerIds.join(","), user?.id]);

  useEffect(() => {
    const targetWorkerId = activeWorker?.workerId ?? selectedWorker?.workerId ?? null;
    if (!user || !targetWorkerId || pendingRestoredWorkerId === targetWorkerId) {
      setRuntimeSnapshot(null);
      setRuntimeError(null);
      return;
    }

    void refreshRuntime(targetWorkerId, { quiet: true });
  }, [user?.id, authToken, activeWorker?.workerId, pendingRestoredWorkerId, selectedWorker?.workerId]);

  useEffect(() => {
    const targetWorkerId = activeWorker?.workerId ?? selectedWorker?.workerId ?? null;
    if (!targetWorkerId || runtimeSnapshot?.upgrade.status !== "running") {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshRuntime(targetWorkerId, { quiet: true });
    }, WORKER_STATUS_POLL_MS);

    return () => window.clearInterval(timer);
  }, [activeWorker?.workerId, selectedWorker?.workerId, runtimeSnapshot?.upgrade.status]);

  useEffect(() => {
    if (!desktopAuthRequested || !user || desktopRedirectUrl || desktopRedirectBusy || desktopRedirectAttempted) {
      return;
    }

    void completeDesktopAuthHandoff();
  }, [desktopAuthRequested, user?.id, authToken, desktopRedirectUrl, desktopRedirectBusy, desktopRedirectAttempted, desktopAuthScheme]);

  useEffect(() => {
    if (!webAuthRequested || !user || webRedirectBusy || webRedirectAttempted) {
      return;
    }

    void completeWebAuthHandoff();
  }, [webAuthRequested, webAuthReturnUrl, user?.id, authToken, webRedirectBusy, webRedirectAttempted]);

  useEffect(() => {
    if (!user || !onboardingPending) {
      onboardingAutoLaunchKeyRef.current = null;
      return;
    }

    if (!billingSummary) {
      return;
    }

    if (billingSummary.featureGateEnabled && !billingSummary.hasActivePlan) {
      return;
    }

    if (ownedWorkerCount > 0) {
      markOnboardingComplete();
      return;
    }

    if (launchBusy) {
      return;
    }

    const autoLaunchKey = `${user.id}:${onboardingIntent?.workerName ?? DEFAULT_WORKER_NAME}`;
    if (onboardingAutoLaunchKeyRef.current === autoLaunchKey) {
      return;
    }

    onboardingAutoLaunchKeyRef.current = autoLaunchKey;
    // 首个远程工作区统一通过 POST /v1/workers 创建，由 Den API 在服务端选择配置好的供应器。
    // 创建成功后由 launchWorker 标记引导完成；失败时保留待处理状态，让用户看到原因并重试。
    void launchWorker({ source: "signup_auto", workerNameOverride: onboardingIntent?.workerName ?? DEFAULT_WORKER_NAME });
  }, [billingSummary?.featureGateEnabled, billingSummary?.hasActivePlan, launchBusy, onboardingIntent?.workerName, onboardingPending, ownedWorkerCount, user?.id]);

  useEffect(() => {
    if (!user) {
      return;
    }

    if ((workerName === DEFAULT_WORKER_NAME || workerName.trim().length === 0) && !onboardingPending) {
      setWorkerName(deriveOnboardingWorkerName(user));
    }
  }, [onboardingPending, user?.id, workerName]);

  const showAuthFeedback = authInfo !== getAuthInfoForMode(authMode) || authError !== null;

  const value: DenFlowContextValue = {
    authMode,
    setAuthMode,
    email,
    setEmail,
    authName,
    setAuthName,
    password,
    setPassword,
    verificationCode,
    setVerificationCode,
    verificationRequired,
    authBusy,
    authInfo,
    authError,
    user,
    sessionHydrated,
    desktopAuthRequested,
    desktopAuthScheme,
    webAuthRequested,
    desktopRedirectUrl,
    desktopRedirectBusy,
    showAuthFeedback,
    submitAuth,
    submitVerificationCode,
    resendVerificationCode,
    cancelVerification,
    beginSocialAuth,
    signOut,
    updateUserProfile,
    resolveUserLandingRoute,
    billingSummary,
    billingBusy,
    billingError,
    orgLimitError,
    clearOrgLimitError: () => setOrgLimitError(null),
    refreshBilling,
    onboardingPending,
    onboardingDecisionBusy,
    workers,
    filteredWorkers,
    workersBusy,
    workersLoadedOnce,
    workersError,
    workerQuery,
    setWorkerQuery,
    workerStatusFilter,
    setWorkerStatusFilter,
    selectedWorker,
    activeWorker,
    selectWorker,
    workerName,
    setWorkerName,
    launchBusy,
    launchStatus,
    launchError,
    actionBusy,
    deleteBusyWorkerId,
    redeployBusyWorkerId,
    renameBusyWorkerId,
    runtimeSnapshot,
    runtimeBusy,
    runtimeError,
    runtimeUpgradeBusy,
    copiedField,
    events,
    runtimeConfig,
    runtimeConfigLoaded,
    openworkDeepLink,
    openworkAppConnectUrl,
    hasWorkspaceScopedUrl,
    additionalWorkerNeedsPlan,
    selectedStatusMeta,
    isSelectedWorkerFailed,
    ownedWorkerCount,
    refreshWorkers,
    launchWorker,
    checkWorkerStatus,
    generateWorkerToken,
    renameWorker,
    deleteWorker,
    redeployWorker,
    refreshRuntime,
    upgradeRuntime,
    copyToClipboard,
    getRuntimeServiceLabel,
  };

  return createElement(DenFlowContext.Provider, { value }, children);
}

export function useDenFlow() {
  const value = useContext(DenFlowContext);
  if (!value) {
    throw new Error("useDenFlow 必须在 DenFlowProvider 中使用。");
  }
  return value;
}
