/** @jsxImportSource react */
import {
  CheckCircle2,
  ChevronRight,
  Loader2,
  Search,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import { openDesktopUrl } from "@/app/lib/desktop";
import { isDesktopRuntime } from "@/app/utils";
import { compareProviders } from "@/app/utils/providers";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ProviderIcon } from "../../../design-system/provider-icon";
import { TextInput } from "../../../design-system/text-input";
import type {
  ProviderAuthMethod,
  ProviderAuthProvider,
  ProviderOAuthStartResult,
} from "./store";
import {
  LOCAL_PROVIDER_PLANS,
  parseLocalModelIds,
  type LocalProviderInput,
  type LocalProviderPlan,
} from "./local-provider-config";

export type ProviderAuthEntry = {
  id: string;
  name: string;
  methods: ProviderAuthMethod[];
  connected: boolean;
  env: string[];
  localPlan?: LocalProviderPlan;
};

type ProviderOAuthSession = ProviderOAuthStartResult & {
  providerId: string;
  methodLabel: string;
};

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  openrouter: "OpenRouter",
};

function formatProviderName(id: string, fallback?: string) {
  const named = fallback?.trim();
  if (named) return named;

  const normalized = id.trim();
  const mapped = PROVIDER_LABELS[normalized.toLowerCase()];
  if (mapped) return mapped;

  const cleaned = normalized.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return id;

  return cleaned
    .split(" ")
    .flatMap((word) => {
      if (!word) return [];
      if (/\d/.test(word) || word.length <= 3) {
        return [word.toUpperCase()];
      }
      const lower = word.toLowerCase();
      return [lower.charAt(0).toUpperCase() + lower.slice(1)];
    })
    .join(" ");
}

/**
 * 汇总当前工作区可使用的模型。公司模型和自定义模型对所有工作区
 * 使用同一入口，不能因工作区位于远程 Worker 而隐藏或降级。
 */
export function buildProviderAuthEntries(input: {
  providers: ProviderAuthProvider[];
  connectedProviderIds: string[];
  authMethods: Record<string, ProviderAuthMethod[]>;
}): ProviderAuthEntry[] {
  const connected = new Set(input.connectedProviderIds ?? []);
  const providersById = new Map((input.providers ?? []).map((provider) => [provider.id, provider]));
  const entriesById = new Map<string, ProviderAuthEntry>();

  for (const plan of LOCAL_PROVIDER_PLANS) {
    const id = plan.providerId ?? plan.kind;
    const configuredMethods = input.authMethods?.[id] ?? [];
    entriesById.set(id, {
      id,
      name: plan.name,
      methods: [
        { type: "api", label: "配置模型服务" },
        ...configuredMethods.filter((method) => method.type !== "api"),
      ],
      connected: connected.has(id),
      env: plan.env ? [plan.env] : [],
      localPlan: plan,
    });
  }

  for (const [id, methods] of Object.entries(input.authMethods ?? {})) {
    const existing = entriesById.get(id);
    if (existing) {
      const mergedMethods = [
        ...existing.methods,
        ...methods.filter((method) => !existing.methods.some((current) => (
          current.type === method.type &&
          current.methodIndex === method.methodIndex &&
          current.cloudProviderId === method.cloudProviderId &&
          current.label === method.label
        ))),
      ];
      entriesById.set(id, { ...existing, methods: mergedMethods });
      continue;
    }
    const provider = providersById.get(id);
    entriesById.set(id, {
      id,
      name: formatProviderName(id, provider?.name),
      methods,
      connected: connected.has(id),
      env: Array.isArray(provider?.env) ? provider.env : [],
    });
  }

  for (const provider of input.providers ?? []) {
    const id = provider.id.trim();
    if (!id || entriesById.has(id) || provider.env.length === 0) continue;
    entriesById.set(id, {
      id,
      name: formatProviderName(id, provider.name),
      methods: [{ type: "api", label: "API 密钥" }],
      connected: connected.has(id),
      env: provider.env,
    });
  }

  return Array.from(entriesById.values()).toSorted((left, right) => {
    if (left.localPlan && !right.localPlan) return -1;
    if (!left.localPlan && right.localPlan) return 1;
    return compareProviders(left, right);
  });
}

export type ProviderAuthModalProps = {
  open: boolean;
  loading: boolean;
  submitting: boolean;
  error: string | null;
  preferredProviderId?: string | null;
  workerType?: "local" | "remote";
  providers: ProviderAuthProvider[];
  connectedProviderIds: string[];
  authMethods: Record<string, ProviderAuthMethod[]>;
  onSelect: (providerId: string, methodIndex?: number) => Promise<ProviderOAuthStartResult>;
  onSubmitApiKey: (providerId: string, apiKey: string) => Promise<string | void>;
  onSubmitLocalProvider: (
    input: LocalProviderInput,
  ) => Promise<{ providerId: string; message: string }>;
  onConnectCloudProvider: (cloudProviderId: string) => Promise<string | void>;
  onSubmitOAuth: (
    providerId: string,
    methodIndex: number,
    code?: string,
  ) => Promise<{ connected: boolean; pending?: boolean; message?: string }>;
  onRefreshProviders?: () => Promise<unknown>;
  onClose: () => void;
};

export default function ProviderAuthModal(props: ProviderAuthModalProps) {
  const isRemoteWorker = props.workerType === "remote";

  const [view, setView] = useState<
    "list" | "method" | "local" | "api" | "cloud" | "oauth-code" | "oauth-auto"
  >("list");
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [selectedCloudMethod, setSelectedCloudMethod] = useState<ProviderAuthMethod | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [localProviderId, setLocalProviderId] = useState("");
  const [localProviderName, setLocalProviderName] = useState("");
  const [localBaseUrl, setLocalBaseUrl] = useState("");
  const [localModelsText, setLocalModelsText] = useState("");
  const [localImageInputModelIds, setLocalImageInputModelIds] = useState<string[]>([]);
  const [oauthCodeInput, setOauthCodeInput] = useState("");
  const [oauthSession, setOauthSession] = useState<ProviderOAuthSession | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeEntryIndex, setActiveEntryIndex] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);
  const [pollingBusy, setPollingBusy] = useState(false);
  const [oauthAutoBusy, setOauthAutoBusy] = useState(false);
  const [oauthCodeCopied, setOauthCodeCopied] = useState(false);
  const [oauthBrowserOpened, setOauthBrowserOpened] = useState(false);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const providerPollRef = useRef<number | null>(null);
  const oauthAutoPollRef = useRef<number | null>(null);
  const oauthCodeCopiedResetRef = useRef<number | null>(null);
  const autoOpenedPreferredProviderIdRef = useRef<string | null>(null);

  const isOpenAiHeadlessMethod = (method: ProviderAuthMethod) => {
    const label = method.label.toLowerCase();
    return method.type === "oauth" && (label.includes("headless") || label.includes("device"));
  };

  const isOpenAiProvider = (id: string, fallbackName?: string) => {
    const normalizedId = id.trim().toLowerCase();
    const normalizedName = fallbackName?.trim().toLowerCase() ?? "";
    return normalizedId === "openai" || normalizedName === "openai";
  };

  const openExternalUrl = async (url: string) => {
    if (!url) return;
    if (isDesktopRuntime()) {
      await openDesktopUrl(url);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const entries = useMemo(
    () => buildProviderAuthEntries({
      providers: props.providers,
      connectedProviderIds: props.connectedProviderIds,
      authMethods: props.authMethods,
    }),
    [props.authMethods, props.connectedProviderIds, props.providers],
  );

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.id === selectedProviderId) ?? null,
    [entries, selectedProviderId],
  );

  const resolvedView = selectedEntry ? view : "list";
  const rawErrorMessage = localError ?? props.error;
  const errorMessage = rawErrorMessage
    ? /[\u3400-\u9fff]/.test(rawErrorMessage)
      ? rawErrorMessage
      : "连接模型服务失败，请检查凭据和网络后重试。"
    : null;

  const filteredEntries = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return entries;
    return entries.filter((entry) => {
      const methodText = entry.methods.map((method) => method.label || (method.type === "oauth" ? "OAuth" : "API key")).join(" ");
      return `${entry.name} ${entry.id} ${methodText}`.toLowerCase().includes(query);
    });
  }, [entries, searchQuery]);

  const oauthInstructions = oauthSession?.authorization.instructions?.trim() ?? "";
  const isOpenAiHeadlessSession = Boolean(
    oauthSession && oauthSession.providerId === "openai" && oauthSession.methodLabel.toLowerCase().includes("headless"),
  );
  const shouldStartOauthAutoPolling =
    props.open &&
    resolvedView === "oauth-auto" &&
    oauthSession &&
    (!isOpenAiHeadlessSession || oauthBrowserOpened);

  const oauthDisplayCode = useMemo(() => {
    if (!oauthInstructions) return "";
    const matched = oauthInstructions.match(/[A-Z0-9]{4}-[A-Z0-9]{4,5}/)?.[0];
    if (matched) return matched;
    if (oauthInstructions.includes(":")) {
      return oauthInstructions.split(":").slice(1).join(":").trim();
    }
    return oauthInstructions;
  }, [oauthInstructions]);

  const methodLabel = (method: ProviderAuthMethod) => {
    const label = method.label.toLowerCase();
    if (method.type === "cloud") return "公司管理";
    if (method.type === "oauth" && (label.includes("headless") || label.includes("device"))) {
      return "设备代码登录";
    }
    if (method.type === "oauth") return "浏览器登录（OAuth）";
    return "API 密钥";
  };

  const actionDisabled = props.loading || props.submitting;
  const localModelIds = useMemo(
    () => parseLocalModelIds(localModelsText),
    [localModelsText],
  );

  const resetState = () => {
    if (oauthCodeCopiedResetRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(oauthCodeCopiedResetRef.current);
      oauthCodeCopiedResetRef.current = null;
    }
    setView("list");
    setSelectedProviderId(null);
    setSelectedCloudMethod(null);
    setApiKeyInput("");
    setLocalProviderId("");
    setLocalProviderName("");
    setLocalBaseUrl("");
    setLocalModelsText("");
    setLocalImageInputModelIds([]);
    setOauthCodeInput("");
    setOauthSession(null);
    setSearchQuery("");
    setActiveEntryIndex(0);
    setLocalError(null);
    setOauthCodeCopied(false);
    setOauthBrowserOpened(false);
  };

  const stopProviderPolling = () => {
    if (providerPollRef.current !== null) {
      window.clearInterval(providerPollRef.current);
      providerPollRef.current = null;
    }
  };

  const stopOauthAutoPolling = () => {
    if (oauthAutoPollRef.current !== null) {
      window.clearInterval(oauthAutoPollRef.current);
      oauthAutoPollRef.current = null;
    }
  };

  const handleClose = () => {
    void props.onRefreshProviders?.();
    stopOauthAutoPolling();
    stopProviderPolling();
    resetState();
    props.onClose();
  };

  useEffect(() => {
    if (!props.open) {
      autoOpenedPreferredProviderIdRef.current = null;
      resetState();
    }
  }, [props.open]);

  useEffect(() => {
    if (!props.open || resolvedView !== "list") return;
    const total = filteredEntries.length;
    if (total <= 0) {
      setActiveEntryIndex(0);
      return;
    }
    setActiveEntryIndex((current) => Math.max(0, Math.min(current, total - 1)));
  }, [filteredEntries.length, props.open, resolvedView]);

  useEffect(() => {
    if (!props.open || resolvedView !== "list") return;
    queueMicrotask(() => searchInputRef.current?.focus());
  }, [props.open, resolvedView]);

  useEffect(() => {
    if (!props.open || props.loading || resolvedView !== "list") return;

    const preferredId = props.preferredProviderId?.trim().toLowerCase() ?? "";
    if (!preferredId || autoOpenedPreferredProviderIdRef.current === preferredId) return;

    const entry = entries.find((item) => item.id.trim().toLowerCase() === preferredId);
    if (!entry) return;

    autoOpenedPreferredProviderIdRef.current = preferredId;
    queueMicrotask(() => {
      handleEntrySelect(entry);
    });
  }, [
    entries,
    props.loading,
    props.open,
    props.preferredProviderId,
    resolvedView,
  ]);

  useEffect(() => {
    return () => {
      stopOauthAutoPolling();
      stopProviderPolling();
      if (oauthCodeCopiedResetRef.current !== null) {
        window.clearTimeout(oauthCodeCopiedResetRef.current);
        oauthCodeCopiedResetRef.current = null;
      }
    };
  }, []);

  const isOauthView = resolvedView === "oauth-code" || resolvedView === "oauth-auto";
  const activeProviderId = oauthSession?.providerId ?? selectedProviderId;
  const isActiveProviderConnected =
    !!activeProviderId && (props.connectedProviderIds ?? []).includes(activeProviderId);

  const pollProviders = async () => {
    const id = activeProviderId;
    if (!id || pollingBusy) return;
    setPollingBusy(true);
    try {
      await props.onRefreshProviders?.();
    } finally {
      setPollingBusy(false);
    }
    if ((props.connectedProviderIds ?? []).includes(id)) {
      handleClose();
    }
  };

  const startProviderPolling = () => {
    if (typeof window === "undefined") return;
    if (providerPollRef.current !== null) return;
    void pollProviders();
    providerPollRef.current = window.setInterval(() => {
      void pollProviders();
    }, 2000);
  };

  useEffect(() => {
    if (!props.open || !isOauthView) {
      stopProviderPolling();
      return;
    }
    if (isActiveProviderConnected) {
      handleClose();
      return;
    }
    startProviderPolling();
  }, [isActiveProviderConnected, isOauthView, props.open]);

  const openOauthUrl = async (url: string) => {
    if (!url) return;
    if (isDesktopRuntime()) {
      await openDesktopUrl(url);
      setOauthBrowserOpened(true);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
    setOauthBrowserOpened(true);
  };

  const copyOauthDisplayCode = async () => {
    const code = oauthDisplayCode.trim();
    if (!code) return;
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      setLocalError("Clipboard is unavailable in this environment.");
      return;
    }
    await navigator.clipboard.writeText(code);
    setOauthCodeCopied(true);
    if (typeof window === "undefined") return;
    if (oauthCodeCopiedResetRef.current !== null) {
      window.clearTimeout(oauthCodeCopiedResetRef.current);
    }
    oauthCodeCopiedResetRef.current = window.setTimeout(() => {
      setOauthCodeCopied(false);
      oauthCodeCopiedResetRef.current = null;
    }, 2000);
  };

  const submitOauth = async (providerId: string, methodIndex: number, code?: string) => {
    const trimmedCode = code?.trim();
    setLocalError(null);
    try {
      return await props.onSubmitOAuth(providerId, methodIndex, trimmedCode || undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to complete OAuth";
      setLocalError(message);
      throw error instanceof Error ? error : new Error(message);
    }
  };

  const attemptOauthAutoCompletion = async () => {
    const session = oauthSession;
    if (!session || oauthAutoBusy) return;
    setOauthAutoBusy(true);
    try {
      const result = await submitOauth(session.providerId, session.methodIndex);
      if (result?.connected) {
        stopOauthAutoPolling();
      }
    } finally {
      setOauthAutoBusy(false);
    }
  };

  const startOauthAutoPolling = () => {
    if (typeof window === "undefined") return;
    if (oauthAutoPollRef.current !== null) return;
    void attemptOauthAutoCompletion();
    oauthAutoPollRef.current = window.setInterval(() => {
      void attemptOauthAutoCompletion();
    }, 2000);
  };

  useEffect(() => {
    if (!shouldStartOauthAutoPolling) {
      stopOauthAutoPolling();
      return;
    }
    startOauthAutoPolling();
  }, [shouldStartOauthAutoPolling]);

  const startOauth = async (entry: ProviderAuthEntry, methodIndex?: number) => {
    if (actionDisabled) return;
    if (!Number.isInteger(methodIndex) || methodIndex === undefined) {
      setLocalError(`No OAuth flow available for ${entry.name}.`);
      return;
    }
    setLocalError(null);
    setOauthCodeInput("");
    setOauthSession(null);
    setOauthCodeCopied(false);
    setOauthBrowserOpened(false);
    try {
      const started = await props.onSelect(entry.id, methodIndex);
      const selectedMethod = entry.methods.find((method) => method.methodIndex === methodIndex);
      if (!selectedMethod) {
        throw new Error(`${entry.name} 当前不支持所选登录方式。`);
      }
      const nextSession: ProviderOAuthSession = {
        providerId: entry.id,
        methodIndex: started.methodIndex,
        methodLabel: selectedMethod.label,
        authorization: started.authorization,
      };
      setOauthSession(nextSession);

      if (started.authorization.method === "code") {
        await openOauthUrl(started.authorization.url);
        setView("oauth-code");
        return;
      }

      if (!isOpenAiHeadlessMethod(selectedMethod)) {
        await openOauthUrl(started.authorization.url);
      }

      setView("oauth-auto");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to start OAuth";
      setLocalError(message);
    }
  };

  const handleMethodSelect = async (method: ProviderAuthMethod) => {
    if (!selectedEntry || actionDisabled) return;
    setLocalError(null);
    setSelectedCloudMethod(null);

    if (method.type === "api" && selectedEntry.localPlan) {
      const plan = selectedEntry.localPlan;
      setLocalProviderId(plan.providerId ?? "");
      setLocalProviderName(plan.custom ? "" : plan.name);
      setLocalBaseUrl(plan.api ?? "");
      setLocalModelsText(plan.modelIds.join("\n"));
      setLocalImageInputModelIds([]);
      setApiKeyInput("");
      setView("local");
      return;
    }

    if (method.type === "oauth") {
      await startOauth(selectedEntry, method.methodIndex);
      return;
    }

    if (method.type === "cloud") {
      setSelectedCloudMethod(method);
      setView("cloud");
      return;
    }

    setView("api");
  };

  const handleEntrySelect = (entry: ProviderAuthEntry) => {
    if (actionDisabled) return;
    setLocalError(null);
    setSelectedProviderId(entry.id);

    if (entry.methods.length === 1) {
      void handleMethodSelect(entry.methods[0]);
      return;
    }

    if (entry.methods.length > 1) {
      setView("method");
      return;
    }

    setLocalError(`${entry.name} 暂无可用的认证方式。`);
  };

  const handleApiSubmit = async () => {
    if (!selectedEntry || actionDisabled) return;

    const trimmed = apiKeyInput.trim();
    if (!trimmed) {
      setLocalError("请输入 API 密钥。");
      return;
    }

    setLocalError(null);
    try {
      await props.onSubmitApiKey(selectedEntry.id, trimmed);
      toast.success(`${selectedEntry.name} 已连接`, {
        description: "API 密钥已安全保存在本机运行环境中。",
      });
      // Close the modal after a successful save
      props.onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存 API 密钥失败，请重试。";
      setLocalError(message);
    }
  };

  const handleLocalProviderSubmit = async () => {
    const plan = selectedEntry?.localPlan;
    if (!plan || actionDisabled) return;

    const input: LocalProviderInput = {
      kind: plan.kind,
      providerId: localProviderId,
      name: localProviderName,
      baseUrl: localBaseUrl,
      apiKey: apiKeyInput,
      modelIds: localModelIds,
      imageInputModelIds: localImageInputModelIds.filter((modelId) => localModelIds.includes(modelId)),
    };
    setLocalError(null);
    try {
      await props.onSubmitLocalProvider(input);
      props.onClose();
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "保存模型服务失败，请检查填写内容后重试。";
      setLocalError(message);
    }
  };

  const handleCloudSubmit = async () => {
    if (!selectedCloudMethod?.cloudProviderId || actionDisabled) return;

    setLocalError(null);
    try {
      await props.onConnectCloudProvider(selectedCloudMethod.cloudProviderId);
      props.onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to connect organization provider";
      setLocalError(message);
    }
  };

  const handleOauthCodeSubmit = async () => {
    if (!selectedEntry || !oauthSession || actionDisabled) return;

    const trimmed = oauthCodeInput.trim();
    if (!trimmed) {
      setLocalError("Authorization code is required.");
      return;
    }

    await submitOauth(selectedEntry.id, oauthSession.methodIndex, trimmed);
  };

  const handleBack = () => {
    if (resolvedView === "oauth-code" || resolvedView === "oauth-auto") {
      if ((selectedEntry?.methods.length ?? 0) > 1) {
        setView("method");
      } else {
        setView("list");
      }
      setOauthSession(null);
      setOauthCodeInput("");
      setOauthCodeCopied(false);
      setOauthBrowserOpened(false);
      setLocalError(null);
      return;
    }

    if (
      (resolvedView === "api" || resolvedView === "local") &&
      (selectedEntry?.methods.length ?? 0) > 1
    ) {
      setView("method");
      setSelectedCloudMethod(null);
      setApiKeyInput("");
      setLocalError(null);
      return;
    }
    if (resolvedView === "cloud" && (selectedEntry?.methods.length ?? 0) > 1) {
      setView("method");
      setSelectedCloudMethod(null);
      setLocalError(null);
      return;
    }
    resetState();
  };

  const submittingLabel = () => {
    if (!props.submitting) return null;
    if (resolvedView === "local") return "正在保存模型服务…";
    if (resolvedView === "api") return "正在保存 API 密钥…";
    if (resolvedView === "cloud") return "正在连接公司模型服务…";
    if (resolvedView === "oauth-code") return "正在验证授权码…";
    if (resolvedView === "oauth-auto") return "正在等待 OAuth 确认…";
    return "正在打开认证…";
  };

  const stepEntryIndex = (delta: number) => {
    const total = filteredEntries.length;
    if (total <= 0) {
      setActiveEntryIndex(0);
      return;
    }
    setActiveEntryIndex((current) => {
      const normalized = ((current % total) + total) % total;
      return (normalized + delta + total) % total;
    });
  };

  const handleListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (resolvedView !== "list") return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      stepEntryIndex(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      stepEntryIndex(-1);
      return;
    }
    if (event.key === "Enter") {
      const nativeEvent = event.nativeEvent as globalThis.KeyboardEvent & { keyCode?: number };
      if (nativeEvent.isComposing || nativeEvent.keyCode === 229) {
        return;
      }
      const entry = filteredEntries[activeEntryIndex];
      if (!entry) return;
      event.preventDefault();
      handleEntrySelect(entry);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      handleClose();
    }
  };

  const methodDescription = (entry: ProviderAuthEntry, method: ProviderAuthMethod) => {
    const rawLabel = method.label.toLowerCase();
    if (isOpenAiProvider(entry.id, entry.name) && (rawLabel.includes("headless") || rawLabel.includes("device"))) {
      return isRemoteWorker
        ? "远程 Worker 使用 OpenAI 设备代码登录，避免浏览器回调落到本机。"
        : "浏览器回调不稳定时，可使用 OpenAI 设备代码登录。";
    }
    if (method.type === "oauth") {
      return "在浏览器中完成登录，SeeWayWork 会自动完成连接。";
    }
    if (method.type === "cloud") {
      return method.description && /[\u3400-\u9fff]/.test(method.description)
        ? method.description
        : "使用公司统一管理的模型服务和凭据。";
    }
    if (entry.localPlan && method.type === "api") {
      return "为当前工作区保存接口地址、API 密钥和模型 ID。";
    }
    return "粘贴 API 密钥；密钥仅由 SeeWayWork 本地运行环境保存。";
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <DialogContent className="flex max-h-[calc(100vh-2rem)] min-h-0 w-full max-w-lg flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>连接模型服务</DialogTitle>
          <DialogDescription>
            登录个人模型服务，或使用公司统一管理的模型。
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4">
          {errorMessage ? (
            <div className="rounded-xl border border-red-7/30 bg-red-1/40 px-3 py-2 text-xs text-red-11">
              {errorMessage}
            </div>
          ) : props.loading ? (
            <div className="rounded-xl border border-gray-6 bg-gray-1/60 px-4 py-3 text-sm text-gray-10 animate-pulse">
              正在加载模型服务…
            </div>
          ) : null}

          {!props.loading ? (
            <div className="-mr-1 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {resolvedView === "list" ? (
                <div className="space-y-3" role="presentation" onKeyDown={handleListKeyDown}>
                  <div className="relative flex items-center mb-1">
                    <Search size={16} className="absolute left-3 text-gray-9" />
                    <input
                      ref={searchInputRef}
                      type="text"
                      placeholder="按名称或 ID 搜索模型服务"
                      value={searchQuery}
                      onChange={(event) => {
                        setSearchQuery(event.currentTarget.value);
                        setActiveEntryIndex(0);
                      }}
                      autoComplete="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      disabled={actionDisabled}
                      className="w-full rounded-xl bg-gray-2 px-9 py-2.5 text-[13px] text-gray-12 placeholder:text-gray-9 border border-gray-6/60 focus:border-gray-8 focus:bg-gray-1 focus:outline-none transition-colors shadow-sm"
                    />
                  </div>

                  {filteredEntries.length ? (
                    filteredEntries.map((entry, index) => (
                      <button
                        key={entry.id}
                        type="button"
                        className={`w-full group flex items-start gap-3.5 rounded-xl px-3.5 py-3 text-left transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed ${
                          index === activeEntryIndex ? "bg-gray-3/60" : "hover:bg-gray-3/30"
                        }`}
                        disabled={actionDisabled}
                        onMouseEnter={() => setActiveEntryIndex(index)}
                        onClick={() => handleEntrySelect(entry)}
                      >
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-gray-5/60 bg-gray-2 shadow-sm overflow-hidden">
                          <ProviderIcon providerId={entry.id} size={18} className="text-gray-12" />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0 flex items-center gap-2">
                              <div className="text-[14px] font-medium text-gray-12 truncate tracking-tight">
                                {entry.name}
                              </div>
                            </div>
                            <div className="flex items-center justify-end shrink-0">
                              {entry.connected ? (
                                <div className="flex items-center gap-1 text-[11px] font-medium text-green-11 bg-green-4/20 border border-green-5/30 px-1.5 py-0.5 rounded-md">
                                  <CheckCircle2 size={12} strokeWidth={2.5} />
                                  已连接
                                </div>
                              ) : (
                                <div className="text-[12px] font-medium text-gray-9 group-hover:text-gray-12 transition-colors flex items-center gap-0.5 opacity-80 group-hover:opacity-100">
                                  连接
                                  <ChevronRight size={14} className="opacity-0 -ml-2 group-hover:opacity-100 group-hover:ml-0 transition-all duration-200" />
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="text-[11px] text-gray-9 font-mono truncate mt-0.5 opacity-60 group-hover:opacity-80 transition-opacity">
                            {entry.id}
                          </div>

                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {entry.methods.map((method) => (
                              <span
                                key={`${entry.id}-${method.type}-${method.methodIndex ?? method.cloudProviderId ?? method.label}`}
                                className={`text-[10px] font-medium px-2 py-0.5 rounded-md border ${
                                  method.type === "oauth"
                                    ? "bg-indigo-3/30 text-indigo-11 border-indigo-5/30"
                                    : method.type === "cloud"
                                      ? "bg-emerald-3/30 text-emerald-11 border-emerald-5/30"
                                      : "bg-gray-3/40 text-gray-11 border-gray-6/40"
                                }`}
                              >
                                {methodLabel(method)}
                              </span>
                            ))}
                          </div>
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="text-sm text-gray-10 pt-2">
                      {entries.length ? "没有符合搜索条件的模型服务。" : "暂无可用模型服务。"}
                    </div>
                  )}

                  <div className="text-[11px] text-gray-9">使用方向键移动，按回车键选择。</div>
                </div>
              ) : null}

              {resolvedView === "method" && selectedEntry ? (
                <div className="rounded-xl border border-gray-6/40 bg-gray-2/50 shadow-sm p-5 space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-medium text-gray-12">{selectedEntry.name}</div>
                      <div className="text-xs text-gray-10 mt-1">选择连接方式。</div>
                    </div>
                    <Button variant="outline" onClick={handleBack} disabled={actionDisabled}>
                      返回
                    </Button>
                  </div>
                  <div className="grid gap-2">
                    {selectedEntry.methods.map((method) => (
                      <button
                        key={`${selectedEntry.id}-${method.type}-${method.methodIndex ?? method.cloudProviderId ?? method.label}`}
                        type="button"
                        className={`w-full rounded-xl border px-4 py-3.5 text-left transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed ${
                          method.type === "oauth"
                            ? "border-indigo-5/40 bg-indigo-3/20 hover:bg-indigo-4/30 shadow-sm"
                            : "border-gray-5/50 bg-gray-2 hover:bg-gray-3/50 shadow-sm"
                        }`}
                        onClick={() => void handleMethodSelect(method)}
                        disabled={actionDisabled}
                      >
                        <div className="text-sm font-medium text-gray-12">{methodLabel(method)}</div>
                        <div className="mt-1 text-xs text-gray-10">{methodDescription(selectedEntry, method)}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {resolvedView === "local" && selectedEntry?.localPlan ? (
                <div className="space-y-4 rounded-xl border border-gray-6/40 bg-gray-2/50 p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-medium text-gray-12">
                        {selectedEntry.name}
                      </div>
                      <div className="mt-1 text-xs text-gray-10">
                        配置只作用于当前工作区。
                      </div>
                    </div>
                    <Button variant="outline" onClick={handleBack} disabled={actionDisabled}>
                      返回
                    </Button>
                  </div>

                  {selectedEntry.localPlan.custom ? (
                    <>
                      <TextInput
                        label="名称"
                        type="text"
                        placeholder="例如：公司模型网关"
                        value={localProviderName}
                        onChange={(event) => setLocalProviderName(event.currentTarget.value)}
                        autoComplete="off"
                        spellCheck={false}
                        disabled={actionDisabled}
                      />
                      <TextInput
                        label="模型服务 ID"
                        type="text"
                        placeholder="例如：company-models"
                        value={localProviderId}
                        onChange={(event) => setLocalProviderId(event.currentTarget.value)}
                        autoComplete="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        disabled={actionDisabled}
                      />
                      <TextInput
                        label="基础地址"
                        type="url"
                        placeholder={
                          selectedEntry.localPlan.protocol === "anthropic"
                            ? "https://anthropic.example.com/v1"
                            : "https://models.example.com/v1"
                        }
                        value={localBaseUrl}
                        onChange={(event) => setLocalBaseUrl(event.currentTarget.value)}
                        autoComplete="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        disabled={actionDisabled}
                      />
                    </>
                  ) : (
                    <div className="rounded-lg border border-gray-6/60 bg-gray-1/60 px-3 py-2 text-xs text-gray-10">
                      <div className="font-medium text-gray-12">服务地址</div>
                      <div className="mt-1 break-all">{selectedEntry.localPlan.api}</div>
                    </div>
                  )}

                  <TextInput
                    label="API 密钥"
                    type="password"
                    placeholder="粘贴 API 密钥"
                    value={apiKeyInput}
                    onChange={(event) => {
                      setApiKeyInput(event.currentTarget.value);
                      if (localError) setLocalError(null);
                    }}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    disabled={actionDisabled}
                  />

                  <label className="grid gap-2 text-xs text-gray-10">
                    <span className="font-medium text-gray-12">模型 ID</span>
                    <textarea
                      value={localModelsText}
                      onChange={(event) => setLocalModelsText(event.currentTarget.value)}
                      placeholder="每行填写一个模型 ID"
                      rows={4}
                      spellCheck={false}
                      disabled={actionDisabled}
                      className="min-h-24 w-full resize-y rounded-xl border border-gray-6/60 bg-gray-1 px-3 py-2.5 text-[13px] text-gray-12 outline-none transition-colors placeholder:text-gray-9 focus:border-gray-8 disabled:opacity-60"
                    />
                    <span>每行填写一个，也可以用逗号分隔；可补充服务商新发布的模型。</span>
                  </label>

                  {localModelIds.length > 0 ? (
                    <fieldset className="grid gap-2 rounded-lg border border-gray-6/60 bg-gray-1/60 p-3">
                      <legend className="px-1 text-xs font-medium text-gray-12">图片输入能力</legend>
                      <p className="text-[11px] text-gray-9">仅勾选服务商明确支持图片的模型。</p>
                      <div className="grid gap-2">
                        {localModelIds.map((modelId) => {
                          const checkboxId = `local-model-image-${modelId.replace(/[^a-z0-9_-]+/gi, "-")}`;
                          return (
                            <label
                              key={modelId}
                              htmlFor={checkboxId}
                              className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-xs text-gray-11 hover:bg-gray-3/50"
                            >
                              <Checkbox
                                id={checkboxId}
                                checked={localImageInputModelIds.includes(modelId)}
                                onCheckedChange={(checked) => {
                                  setLocalImageInputModelIds((current) => checked
                                    ? [...new Set([...current, modelId])]
                                    : current.filter((entry) => entry !== modelId));
                                }}
                                nativeButton
                                render={<button type="button" />}
                                disabled={actionDisabled}
                              />
                              <span className="min-w-0 truncate">{modelId}</span>
                              <span className="ml-auto shrink-0 text-gray-9">支持图片输入</span>
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                  ) : null}

                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[11px] text-gray-9">
                      密钥仅由 SeeWayWork 本地运行环境保存。
                    </div>
                    <Button
                      onClick={() => void handleLocalProviderSubmit()}
                      disabled={actionDisabled || !apiKeyInput.trim() || !localModelsText.trim()}
                    >
                      {props.submitting ? "正在保存…" : "保存并连接"}
                    </Button>
                  </div>
                </div>
              ) : null}

              {resolvedView === "api" && selectedEntry ? (
                <div className="rounded-xl border border-gray-6/40 bg-gray-2/50 shadow-sm p-5 space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-medium text-gray-12">{selectedEntry.name}</div>
                      <div className="text-xs text-gray-10 mt-1">
                        粘贴 API 密钥以完成连接。
                      </div>
                    </div>
                    <Button variant="outline" onClick={handleBack} disabled={actionDisabled}>
                      返回
                    </Button>
                  </div>
                  <TextInput
                    label="API 密钥"
                    type="password"
                    placeholder="粘贴 API 密钥"
                    value={apiKeyInput}
                    onChange={(event) => {
                      setApiKeyInput(event.currentTarget.value);
                      if (localError) setLocalError(null);
                    }}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    disabled={actionDisabled}
                  />
                  {selectedEntry.env.length > 0 ? (
                    <div className="text-[11px] text-gray-9">
                      环境变量：<span className="font-mono">{selectedEntry.env.join("、")}</span>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[11px] text-gray-9">密钥仅由 SeeWayWork 本地运行环境保存。</div>
                    <Button
                      onClick={handleApiSubmit}
                      disabled={actionDisabled || !apiKeyInput.trim()}
                    >
                      {props.submitting ? "正在保存…" : "保存密钥"}
                    </Button>
                  </div>
                </div>
              ) : null}

              {resolvedView === "cloud" && selectedEntry && selectedCloudMethod ? (
                <div className="rounded-xl border border-gray-6/40 bg-gray-2/50 shadow-sm p-5 space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-medium text-gray-12">{selectedEntry.name}</div>
                      <div className="text-xs text-gray-10 mt-1">连接公司统一管理的模型服务。</div>
                    </div>
                    <Button variant="outline" onClick={handleBack} disabled={actionDisabled}>
                      返回
                    </Button>
                  </div>
                  <div className="text-xs text-gray-9">
                    {selectedCloudMethod.description && /[\u3400-\u9fff]/.test(selectedCloudMethod.description)
                      ? selectedCloudMethod.description
                      : "使用公司统一管理的模型服务和凭据。"}
                  </div>
                  {(selectedCloudMethod.modelCount ?? 0) > 0 ? (
                    <div className="rounded-lg border border-gray-6/60 bg-gray-1/60 px-3 py-2 text-[11px] text-gray-9">
                      将向当前工作区添加 {selectedCloudMethod.modelCount ?? 0} 个公司精选模型。
                    </div>
                  ) : null}
                  {(selectedCloudMethod.env?.length ?? 0) > 0 ? (
                    <div className="text-[11px] text-gray-9">
                      环境变量：<span className="font-mono">{selectedCloudMethod.env?.join("、")}</span>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[11px] text-gray-9">
                      SeeWayWork 会安装模型服务配置，并使用公司保存的凭据。
                    </div>
                    <Button onClick={handleCloudSubmit} disabled={actionDisabled}>
                      {props.submitting ? "正在连接…" : "连接模型服务"}
                    </Button>
                  </div>
                </div>
              ) : null}

              {resolvedView === "oauth-code" && selectedEntry && oauthSession ? (
                <div className="rounded-xl border border-gray-6/40 bg-gray-2/50 shadow-sm p-5 space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-medium text-gray-12">{selectedEntry.name}</div>
                      <div className="text-xs text-gray-10 mt-1">粘贴授权码以完成 OAuth 登录。</div>
                    </div>
                    <Button variant="outline" onClick={handleBack} disabled={actionDisabled}>
                      返回
                    </Button>
                  </div>
                  <div className="text-xs text-gray-9">
                    在浏览器中完成登录，然后将授权码粘贴到这里。
                  </div>
                  {oauthInstructions ? (
                    <div className="rounded-lg border border-gray-6/60 bg-gray-1/60 px-3 py-2 text-[11px] text-gray-9 font-mono break-all">
                      {/[\u3400-\u9fff]/.test(oauthInstructions) ? oauthInstructions : "请按模型服务页面中的提示完成授权。"}
                    </div>
                  ) : null}
                  <TextInput
                    label="授权码"
                    type="text"
                    placeholder="粘贴授权码"
                    value={oauthCodeInput}
                    onChange={(event) => {
                      setOauthCodeInput(event.currentTarget.value);
                      if (localError) setLocalError(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      void handleOauthCodeSubmit();
                    }}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    disabled={actionDisabled}
                  />
                  <div className="flex items-center justify-between gap-3">
                    <Button
                      variant="outline"
                      onClick={() => {
                        void openOauthUrl(oauthSession.authorization.url ?? "");
                      }}
                    >
                      重新打开浏览器
                    </Button>
                    <Button
                      onClick={() => void handleOauthCodeSubmit()}
                      disabled={actionDisabled || !oauthCodeInput.trim()}
                    >
                      {props.submitting ? "正在验证…" : "完成连接"}
                    </Button>
                  </div>
                </div>
              ) : null}

              {resolvedView === "oauth-auto" && selectedEntry && oauthSession ? (
                <div className="rounded-xl border border-gray-6/40 bg-gray-2/50 shadow-sm p-5 space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-medium text-gray-12">{selectedEntry.name}</div>
                      <div className="text-xs text-gray-10 mt-1">正在等待浏览器确认。</div>
                    </div>
                    <Button variant="outline" onClick={handleBack} disabled={actionDisabled}>
                      返回
                    </Button>
                  </div>
                  {isOpenAiHeadlessSession ? (
                    <div className="space-y-2 text-xs text-gray-9">
                      <div>请登录 OpenAI 账号，并使用下方代码完成设备授权。</div>
                      <div>首次使用时，需要先在账号设置中启用设备代码授权。</div>
                      <div>ChatGPT &gt; 账号设置 &gt; 安全 &gt; 启用设备代码授权</div>
                      <div>准备好后，复制下方代码并点击“打开浏览器”。</div>
                    </div>
                  ) : (
                    <div className="text-xs text-gray-9">
                      请在刚打开的浏览器页面中登录，SeeWayWork 会自动完成连接。
                    </div>
                  )}
                  {oauthDisplayCode ? (
                    <div className="rounded-xl border border-gray-6/70 bg-gray-2/40 p-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] tracking-wide text-gray-8">确认码</div>
                        <div className="text-sm text-gray-12 font-mono break-all">{oauthDisplayCode}</div>
                      </div>
                      <Button variant="outline" size="sm" className="shrink-0" onClick={() => void copyOauthDisplayCode()}>
                        {oauthCodeCopied ? "已复制" : "复制"}
                      </Button>
                    </div>
                  ) : null}
                  {isOpenAiHeadlessSession && !oauthBrowserOpened ? (
                    <div className="flex items-center gap-2 text-xs text-gray-9">
                      <span>点击“打开浏览器”后开始检查授权状态。</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-xs text-gray-9">
                      <Loader2 size={14} className={props.submitting || pollingBusy || oauthAutoBusy ? "animate-spin" : ""} />
                      <span>正在自动检查连接状态…</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-3">
                    <Button
                      variant="outline"
                      onClick={() => {
                        void openOauthUrl(oauthSession.authorization.url ?? "");
                      }}
                    >
                      {isOpenAiHeadlessSession
                        ? oauthBrowserOpened
                          ? "重新打开浏览器"
                          : "打开浏览器"
                        : "重新打开浏览器"}
                    </Button>
                    <div className="text-[11px] text-gray-9 text-right">
                      模型服务连接成功后，此窗口会自动关闭。
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 flex-col gap-3">
          <div className="min-h-[16px] text-xs text-gray-10">
            {props.submitting ? submittingLabel() : null}
          </div>
          <DialogClose
            disabled={actionDisabled}
            render={<Button variant="outline" disabled={actionDisabled} />}
          >
            关闭
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
