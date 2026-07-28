"use client";

import { detectPlatform, DownloadPlatformGrid, type DetectedPlatform, type DownloadPlatformGroup, type DownloadPlatformOption } from "@openwork/ui/react";
import { ChevronDown, Download, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { requestJson } from "../_lib/den-flow";
import { getInstallConfigErrorMessage } from "../_lib/install-errors";
import { buildInstallDownloadHref, installerFileName, type InstallPlatform } from "../_lib/install-download";
import { isMobileUserAgent } from "../_lib/platform";
import { isFoxWorkDesktopProtocol } from "../_lib/foxwork-brand";

type InstallConfig = {
  appName: string;
  clientName: string;
  webUrl: string;
  apiUrl: string;
  requireSignin: boolean;
  logoUrl: string | null;
  iconUrl: string | null;
  connectUrl: string | null;
  connectExpiresAt: string | null;
  activationUrl: string;
  activationExpiresAt: string;
};

const platformOptions: Array<{ value: InstallPlatform; label: string }> = [
  { value: "mac-arm64", label: "Mac（Apple 芯片）" },
  { value: "mac-x64", label: "Mac（Intel 芯片）" },
  { value: "win-x64", label: "Windows 系统（x64）" },
  { value: "linux-x64", label: "Linux 系统（x64）" },
  { value: "linux-arm64", label: "Linux 系统（ARM64）" },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUrl(value: string) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function isConnectUrl(value: string) {
  try {
    const url = new URL(value);
    const route = (url.hostname || url.pathname.replace(/^\/+|\/+$/g, "")).toLowerCase();
    if (!isFoxWorkDesktopProtocol(url.protocol, true) || route !== "connect") return false;
    const token = url.searchParams.get("token")?.trim() ?? "";
    const code = url.searchParams.get("code")?.trim() ?? "";
    const apiBaseUrl = url.searchParams.get("apiBaseUrl")?.trim() ?? "";
    return (Boolean(token) && !code && !apiBaseUrl)
      || (!token && /^[A-Za-z0-9_-]{24,128}$/.test(code) && isUrl(apiBaseUrl));
  } catch {
    return false;
  }
}

function activationCodeFromUrl(value: string) {
  try {
    const url = new URL(value);
    const code = url.searchParams.get("code")?.trim() ?? "";
    return CONNECT_CODE_PATTERN.test(code) ? code : null;
  } catch {
    return null;
  }
}

function exchangeConnectUrl(code: string, apiBaseUrl: string) {
  const url = new URL("openwork://connect");
  url.searchParams.set("code", code);
  url.searchParams.set("apiBaseUrl", apiBaseUrl);
  return url.toString();
}

function parseInstallConfig(value: unknown): InstallConfig | null {
  if (!isRecord(value)) {
    return null;
  }

  const clientName = typeof value.clientName === "string" ? value.clientName.trim() : "";
  const appName = "FoxWork";
  const webUrl = typeof value.webUrl === "string" ? value.webUrl.trim() : "";
  const apiUrl = typeof value.apiUrl === "string" ? value.apiUrl.trim() : "";
  const requireSignin = value.requireSignin;
  const logoUrl = value.logoUrl;
  const iconUrl = value.iconUrl ?? null;
  const connectUrl = value.connectUrl ?? null;
  const connectExpiresAt = value.connectExpiresAt ?? null;
  const activationUrl = typeof value.activationUrl === "string" ? value.activationUrl.trim() : "";
  const activationExpiresAt = typeof value.activationExpiresAt === "string" ? value.activationExpiresAt : "";

  if (!clientName || !isUrl(webUrl) || !isUrl(apiUrl) || typeof requireSignin !== "boolean") {
    return null;
  }
  if (logoUrl !== null && (typeof logoUrl !== "string" || !isUrl(logoUrl))) {
    return null;
  }
  if (iconUrl !== null && (typeof iconUrl !== "string" || !isUrl(iconUrl))) {
    return null;
  }
  if (connectUrl !== null && (typeof connectUrl !== "string" || !isConnectUrl(connectUrl))) {
    return null;
  }
  if (connectExpiresAt !== null && (typeof connectExpiresAt !== "string" || Number.isNaN(Date.parse(connectExpiresAt)))) {
    return null;
  }
  if (!isUrl(activationUrl) || Number.isNaN(Date.parse(activationExpiresAt))) {
    return null;
  }

  return {
    appName,
    clientName,
    webUrl,
    apiUrl,
    requireSignin,
    logoUrl,
    iconUrl,
    connectUrl,
    connectExpiresAt,
    activationUrl,
    activationExpiresAt,
  };
}

async function fetchInstallConfig(token: string) {
  const { response, payload } = await requestJson(
    `/v1/install-config?token=${encodeURIComponent(token)}`,
    { method: "GET" },
    12000,
  );
  if (!response.ok) {
    throw new Error(getInstallConfigErrorMessage(payload, response.status));
  }
  const parsed = parseInstallConfig(payload);
  if (!parsed) {
    throw new Error("安装链接返回的信息不完整。");
  }
  return parsed;
}

function installHref(config: InstallConfig, platform: InstallPlatform, token: string) {
  return buildInstallDownloadHref(config.apiUrl, platform, token);
}

type StepState = "complete" | "active" | "pending";

const STEP_SHELL: Record<StepState, string> = {
  complete: "border-[#e7eaef] bg-[#fafbfc]",
  active: "border-[#c8d6f5] bg-[#f8faff]",
  pending: "border-[#e1e4e8] bg-[#f7f8fa]",
};

const STEP_BADGE: Record<StepState, string> = {
  complete: "border-[1.5px] border-[#c9cfd7] bg-white text-[#7a828e]",
  active: "bg-[#101828] text-white",
  pending: "border-[1.5px] border-[#101828] text-[#101828]",
};

function InstallStep({
  index,
  state,
  title,
  description,
  expanded,
  onExpand,
  testId,
  children,
}: {
  index: number;
  state: StepState;
  title: string;
  description: string;
  expanded: boolean;
  onExpand: () => void;
  testId: string;
  children: ReactNode;
}) {
  return (
    <li className={`rounded-[18px] border ${STEP_SHELL[state]}`} data-state={state} data-testid={testId}>
      <button
        type="button"
        className="flex w-full items-start gap-4 p-5 text-left disabled:cursor-default sm:px-7 sm:py-6"
        aria-expanded={expanded}
        disabled={state === "pending"}
        onClick={onExpand}
      >
        <span className={`grid size-8 shrink-0 place-items-center rounded-full text-[13px] font-semibold ${STEP_BADGE[state]}`} aria-hidden="true">
          {state === "complete" ? "✓" : index}
        </span>
        <span className="grid grow gap-1">
          <span className={`text-base font-semibold ${state === "complete" ? "text-[#667085]" : "text-[#101828]"}`}>{title}</span>
          {expanded ? <span className="text-[13px] leading-5 text-[#60646c]">{description}</span> : null}
        </span>
        <ChevronDown className={`mt-0.5 size-5 shrink-0 text-[#667085] ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {expanded ? <div className="grid gap-4 px-5 pb-5 sm:pb-6 sm:pl-[4.25rem] sm:pr-7">{children}</div> : null}
    </li>
  );
}

function CopyLinkRow({
  value,
  copied,
  onCopy,
  testId,
}: {
  value: string;
  copied: boolean;
  onCopy: () => void;
  testId?: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-[10px] border border-[#e1e4e8] bg-[#fafbfc] px-3 py-2.5" data-testid={testId}>
      <input
        className="min-w-0 grow bg-transparent text-[11px] text-[#344054] outline-none"
        value={value}
        readOnly
        onFocus={(event) => event.currentTarget.select()}
      />
      <button type="button" className="shrink-0 text-[11px] font-semibold text-[#101828] hover:underline" onClick={onCopy}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function InstallScreen() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";
  const [config, setConfig] = useState<InstallConfig | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);
  const [downloadState, setDownloadState] = useState<"idle" | "preparing" | "started">("idle");
  const [downloadLabel, setDownloadLabel] = useState("");
  const [downloadHref, setDownloadHref] = useState("");
  const [downloadPlatform, setDownloadPlatform] = useState<InstallPlatform | null>(null);
  const [detected, setDetected] = useState<DetectedPlatform | null>(null);
  const [currentLink, setCurrentLink] = useState("");
  const requestedStep = searchParams.get("step");
  const initialStep = requestedStep === "3" ? 3 : requestedStep === "2" ? 2 : 1;
  const [guideStep, setGuideStep] = useState<1 | 2 | 3>(initialStep);
  const [expandedStep, setExpandedStep] = useState<1 | 2 | 3>(initialStep);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [activationCode, setActivationCode] = useState<string | null>(null);
  const [activationStatus, setActivationStatus] = useState<"idle" | "pending" | "connected" | "expired">("idle");
  const [connectLink, setConnectLink] = useState("");
  const [connectCopied, setConnectCopied] = useState(false);
  const [returnCopied, setReturnCopied] = useState(false);
  const downloadStartedTimer = useRef<number | null>(null);

  useEffect(() => {
    setIsMobile(isMobileUserAgent());
    setCurrentLink(window.location.href);
    let cancelled = false;
    void detectPlatform().then((platform) => {
      if (!cancelled) setDetected(platform);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      if (!token) {
        setError("安装链接不完整，请联系公司管理员获取新链接。");
        setBusy(false);
        return;
      }

      setBusy(true);
      setError(null);
      try {
        const parsed = await fetchInstallConfig(token);
        if (cancelled) {
          return;
        }
        setConfig(parsed);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "无法加载安装链接。");
          setConfig(null);
        }
      } finally {
        if (!cancelled) {
          setBusy(false);
        }
      }
    }

    void loadConfig();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!activationCode) {
      setActivationStatus("idle");
      return;
    }

    let cancelled = false;
    let timer: number | null = null;
    setActivationStatus("pending");

    async function poll() {
      try {
        const { response, payload } = await requestJson(
          "/v1/install-connect/status",
          { method: "POST", body: JSON.stringify({ code: activationCode }) },
          12000,
        );
        if (cancelled) return;
        if (response.status === 410) {
          setActivationStatus("expired");
          return;
        }
        if (response.ok && isRecord(payload) && payload.status === "connected") {
          setActivationStatus("connected");
          return;
        }
      } catch {
        // Keep waiting through temporary network failures.
      }
      if (!cancelled) timer = window.setTimeout(() => void poll(), 2500);
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [activationCode]);

  useEffect(() => () => {
    if (downloadStartedTimer.current !== null) {
      window.clearTimeout(downloadStartedTimer.current);
    }
  }, []);

  const downloadGroups = useMemo<DownloadPlatformGroup[]>(() => {
    if (!config) {
      return [];
    }

    return [
      {
        os: "macos",
        title: "macOS",
        options: [
          { href: installHref(config, "mac-arm64", token), label: "Apple Silicon (M1+)", arch: "arm64" },
          { href: installHref(config, "mac-x64", token), label: "Intel", arch: "x64" },
        ],
      },
      {
        os: "windows",
        title: "Windows",
        options: [
          { href: installHref(config, "win-x64", token), label: "x64 Installer", arch: "x64" },
        ],
      },
      {
        os: "linux",
        title: "Linux",
        options: [
          { href: installHref(config, "linux-x64", token), label: "Setup script (x64)", arch: "x64" },
          { href: installHref(config, "linux-arm64", token), label: "Setup script (ARM64)", arch: "arm64" },
        ],
      },
    ];
  }, [config, token]);

  const platformByHref = useMemo<Record<string, InstallPlatform>>(() => {
    if (!config) {
      return {};
    }
    return Object.fromEntries(INSTALL_PLATFORMS.map((platform) => [installHref(config, platform, token), platform]));
  }, [config, token]);

  async function copyCurrentLink() {
    try {
      await navigator.clipboard.writeText(currentLink || window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setConnectError("Could not copy automatically. Select the install link and copy it manually.");
    }
  }

  function advanceGuide(nextStep: 2 | 3) {
    setGuideStep(nextStep);
    setExpandedStep(nextStep);
    const url = new URL(window.location.href);
    url.searchParams.set("step", String(nextStep));
    window.history.replaceState(null, "", url);
  }

  function beginDownload(label: string, href: string) {
    setDownloadLabel(label);
    setDownloadHref(href);
    setDownloadPlatform(platformByHref[href] ?? null);
    setDownloadState("preparing");
    advanceGuide(2);
    if (downloadStartedTimer.current !== null) {
      window.clearTimeout(downloadStartedTimer.current);
    }
    downloadStartedTimer.current = window.setTimeout(() => {
      setDownloadState("started");
      downloadStartedTimer.current = null;
    }, 5000);
  }

  async function beginConnect() {
    setConnecting(true);
    setConnectError(null);
    try {
      // 打开客户端前再签发短时交接链接，避免安装耗时导致链接提前失效。
      const freshConfig = await fetchInstallConfig(token);
      if (!freshConfig.connectUrl) {
        throw new Error("公司服务无法创建 FoxWork 连接链接。");
      }
      setConfig(freshConfig);
      setActivationCode(code);
      setConnectLink(nextConnectLink);
      advanceGuide(3);
      window.location.assign(nextConnectLink);
    } catch (connectFailure) {
      setConnectError(connectFailure instanceof Error
        ? connectFailure.message
        : "无法创建新的 FoxWork 连接，请重试。");
    } finally {
      setConnecting(false);
    }
  }

  async function copyConnectionLink() {
    try {
      await navigator.clipboard.writeText(connectLink);
      setConnectCopied(true);
      window.setTimeout(() => setConnectCopied(false), 1800);
    } catch {
      setConnectError("Could not copy automatically. Select the OpenWork link and copy it manually.");
    }
  }

  async function prepareAndCopyConnectionLink() {
    setConnecting(true);
    setConnectError(null);
    try {
      if (!navigator.clipboard) {
        throw new Error("当前浏览器无法使用剪贴板。");
      }
      const freshConfig = await fetchInstallConfig(token);
      if (!freshConfig.connectUrl) {
        throw new Error("公司服务无法创建 FoxWork 连接链接。");
      }
      setConfig(freshConfig);
      setActivationCode(code);
      setConnectLink(nextConnectLink);
      await navigator.clipboard.writeText(nextConnectLink);
      setConnectCopied(true);
      window.setTimeout(() => setConnectCopied(false), 1800);
    } catch (copyFailure) {
      setConnectError(copyFailure instanceof Error
        ? copyFailure.message
        : "无法复制新的 FoxWork 连接链接，请重试。");
    } finally {
      setConnecting(false);
    }
  }

  async function copyReturnLink() {
    try {
      await navigator.clipboard.writeText(RETURN_TO_OPENWORK_URL);
      setReturnCopied(true);
      window.setTimeout(() => setReturnCopied(false), 1800);
    } catch {
      setConnectError("Could not copy automatically. Select the OpenWork link and copy it manually.");
    }
  }

  if (busy) {
    return (
      <section className="den-page grid min-h-dvh place-items-center py-4 lg:py-6" data-testid="install-page">
        <div className="den-frame grid w-full max-w-[44rem] gap-4 p-6 md:p-8">
          <p className="den-eyebrow">FoxWork 桌面客户端</p>
          <h1 className="den-title-lg">正在加载安装链接</h1>
          <p className="den-copy">正在检查公司的 FoxWork 配置...</p>
        </div>
      </section>
    );
  }

  if (!config) {
    return (
      <OnboardingShell state="install-error" width="wide">
        <section className="grid gap-6 rounded-[1.75rem] border border-slate-200/80 bg-white p-6 md:p-8" data-testid="install-page">
          <div className="grid gap-2">
            <p className="den-eyebrow">FoxWork 桌面客户端</p>
            <h1 className="den-title-lg">无法打开安装链接</h1>
            <p className="den-copy">{error ?? "请联系公司管理员获取新的安装链接。"}</p>
          </div>
        </section>
      </OnboardingShell>
    );
  }

  const primaryHref = installHref(config, platform, token);
  const primaryLabel = platformOptions.find((option) => option.value === platform)?.label ?? "当前电脑";

  return (
    <section className="den-page grid min-h-dvh place-items-center py-4 lg:py-6" data-testid="install-page">
      <div className="den-frame grid w-full max-w-[44rem] gap-6 p-6 text-center md:p-8" data-testid="install-card">
        <div className="grid justify-items-center gap-3">
          <p className="den-eyebrow">{config.appName} 桌面客户端</p>
          {config.logoUrl ? (
            // 公司标志可能来自内网地址，因此不会加入部署环境的公共图片白名单。
            // eslint-disable-next-line @next/next/no-img-element
            <img src={config.logoUrl} alt={`${config.clientName} 标志`} className="max-h-16 max-w-64 object-contain object-center" />
          ) : null}
          <h1 className="den-title-xl">下载 {config.clientName} 的 {config.appName}</h1>
          <p className="den-copy">
            安装 {config.appName}，连接到 {config.clientName}，然后使用公司账号登录。
          </p>
        </div>

        {isMobile ? (
          <div className="den-frame-inset grid gap-3 rounded-[1.5rem] p-5" data-testid="install-mobile-note">
            <p className="m-0 text-base font-medium text-[var(--dls-text-primary)]">{config.appName} 需要安装在电脑上</p>
            <p className="den-copy">请在 Mac、Windows 或 Linux 电脑上打开此链接，也可以复制链接后在电脑上使用。</p>
            <button type="button" className="den-button-secondary w-full sm:w-auto" onClick={() => void copyCurrentLink()}>
              {copied ? "已复制" : "复制安装链接"}
            </button>
          </div>
        ) : (
          <ol className="grid gap-3 text-left" data-testid="install-guide">
            <InstallStep
              index={1}
              state={guideStep > 1 ? "complete" : "active"}
              title="Download the OpenWork installer"
              description="It's a small setup app. When the download finishes, open it and keep this page open."
              expanded={expandedStep === 1}
              onExpand={() => setExpandedStep(1)}
              testId="install-guide-step-download"
            >
              <span className="grid size-8 place-items-center rounded-full bg-[var(--dls-accent)] font-semibold text-white" aria-hidden="true">
                {guideStep > 1 ? "✓" : "1"}
              </span>
              <div className="grid gap-3">
                <div>
                  <p className="m-0 font-semibold text-[var(--dls-text-primary)]">下载并安装</p>
                  <p className="den-copy">打开公司提供的安装包，安装完成后回到此页面。</p>
                </div>
                {guideStep === 1 ? (
                  <div className="grid gap-3">
                    <a
                      className="den-button-primary w-full justify-center sm:w-fit"
                      href={primaryHref}
                      data-testid="install-download-primary"
                      onClick={beginGuidedDownload}
                    >
                      下载 {primaryLabel} 版本
                    </a>
                    <div className="flex flex-wrap gap-2">
                      {secondaryPlatforms.map((option) => (
                        <a
                          key={option.value}
                          className="den-button-secondary"
                          href={installHref(config, option.value, token)}
                          onClick={beginGuidedDownload}
                        >
                          {option.label}
                        </a>
                      ))}
                      <button type="button" className="den-button-secondary" onClick={() => advanceGuide(2)} data-testid="install-skip-download">
                        已安装 {config.appName}
                      </button>
                    </div>
                  </div>
                ) : (
                  <a className="w-fit text-sm font-medium text-[var(--dls-accent)] underline-offset-4 hover:underline" href={primaryHref}>
                    重新下载
                  </a>
                )}
              </div>
            </li>

            <InstallStep
              index={2}
              state={guideStep === 2 ? "active" : guideStep > 2 ? "complete" : "pending"}
              title="Continue on your computer"
              description={guideStep < 2
                ? `Only continue once ${config.appName} is installed and running on this computer.`
                : `Your download is done. Open the file on this computer — the installer takes it from there.`}
              expanded={expandedStep === 2 && guideStep >= 2}
              onExpand={() => setExpandedStep(2)}
              testId="install-guide-step-open"
            >
              <span className="grid size-8 place-items-center rounded-full border border-[var(--dls-border-strong)] font-semibold text-[var(--dls-text-primary)]" aria-hidden="true">
                {guideStep > 2 ? "✓" : "2"}
              </span>
              <div className="grid gap-3">
                <div>
                  <p className="m-0 font-semibold text-[var(--dls-text-primary)]">打开 {config.appName}</p>
                  <p className="den-copy">
                    {guideStep === 1
                      ? `请先确认 ${config.appName} 已安装并在当前电脑上运行。`
                      : `打开应用，并确认连接到 ${config.clientName}。`}
                  </p>
                </div>
                {guideStep >= 2 ? (
                  <div className="grid gap-2">
                    <button
                      type="button"
                      className="den-button-primary w-full justify-center sm:w-fit"
                      data-testid="install-connect-open"
                      disabled={connecting}
                      onClick={() => void beginConnect()}
                    >
                      {connecting ? "正在准备连接..." : `打开 ${config.appName}`}
                    </button>
                    <button
                      type="button"
                      className="w-fit text-sm text-[var(--dls-text-secondary)] underline-offset-4 hover:underline"
                      data-testid="install-connect-recovery"
                      onClick={() => setConnectRecoveryVisible(true)}
                    >
                      没有打开？
                    </button>
                    {connectRecoveryVisible ? (
                      <div className="den-frame-inset grid gap-3 rounded-[1rem] p-3">
                        <p className="den-copy text-sm">
                          复制新的连接链接，然后粘贴到浏览器地址栏打开。FoxWork 会显示相同的连接确认。
                        </p>
                        <button
                          type="button"
                          className="grid h-9 shrink-0 place-items-center rounded-[9px] bg-[#101828] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-black disabled:opacity-60"
                          data-testid="install-connect-open"
                          disabled={connecting}
                          onClick={() => void beginConnect()}
                        >
                          {connectCopying ? "正在复制..." : connectCopied ? "已复制" : "复制连接链接"}
                        </button>
                      </div>

                      <details className="grid gap-2 border-t border-[#e1e4e8] pt-3 [&[open]_svg]:rotate-180">
                        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-[#344054] [&::-webkit-details-marker]:hidden">
                          <ChevronDown className="size-3 shrink-0 text-[#7a808a] transition-transform" aria-hidden="true" />
                          Nothing happening on your computer?
                        </summary>
                        <p className="m-0 text-[13px] leading-[17px] text-[#60646c]">Paste this link into {config.appName} on your computer to connect it by hand.</p>
                        <CopyLinkRow
                          value={currentLink}
                          copied={copied}
                          onCopy={() => void copyCurrentLink()}
                          testId="install-copy-link"
                        />
                        <button
                          type="button"
                          className="w-fit text-[11px] font-medium text-[#667085] underline-offset-4 hover:text-[#101828] hover:underline"
                          data-testid="install-connect-copy"
                          disabled={connecting}
                          onClick={() => void prepareAndCopyConnectionLink()}
                        >
                          {connectCopied ? "Copied a fresh connection link" : "Or copy a fresh connection link"}
                        </button>
                      </details>
                    </div>
                    <InstallerPreview
                      appName={config.appName}
                      iconUrl={config.iconUrl}
                      activationLinkHint={`${config.webUrl.replace(/\/+$/, "")}/activate?token=…`}
                    />
                  </div>

                  {connectError ? <p className="m-0 text-sm text-red-600" role="alert">{connectError}</p> : null}
            </InstallStep>

            <InstallStep
              index={3}
              state={guideStep === 3 ? "active" : "pending"}
              title="Finish in your browser, then return to OpenWork"
              description="Sign in and approve this computer. The browser will give you a button back to the desktop app."
              expanded={expandedStep === 3 && guideStep === 3}
              onExpand={() => setExpandedStep(3)}
              testId="install-guide-step-signin"
            >
                  <div className="grid gap-3" aria-live="polite">
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <a
                        className="grid h-11 shrink-0 place-items-center rounded-[11px] bg-[#101828] px-6 text-[13px] font-semibold text-white transition-colors hover:bg-black sm:w-[18rem]"
                        href={RETURN_TO_OPENWORK_URL}
                      >
                        Return to OpenWork
                      </a>
                      {activationStatus === "connected" ? null : (
                        <p className="m-0 flex grow items-center gap-3 rounded-[11px] border border-[#e1e4e8] bg-white px-4 text-[13px] text-[#60646c]">
                          <span className="size-4 animate-spin rounded-full border-2 border-[#b0b7c3] border-t-[#101828]" aria-hidden="true" />
                          Waiting for browser confirmation…
                        </p>
                      )}
                    </div>

                    {activationStatus === "connected" ? (
                      <div className="flex items-start gap-3 rounded-[11px] border border-[#e7eaef] bg-[#fafbfc] px-3.5 py-3" data-testid="install-connected">
                        <span className="grid size-5 shrink-0 place-items-center rounded-full border-[1.5px] border-[#c9cfd7] bg-white text-[11px] font-bold text-[#30a46c]" aria-hidden="true">✓</span>
                        <span className="grid gap-0.5">
                          <span className="text-[13px] font-semibold text-[#1c2024]">Connected to {config.clientName}</span>
                          <span className="text-[11px] text-[#60646c]">Your organization setup and branding are ready in {config.appName}.</span>
                        </span>
                      </div>
                    ) : activationStatus === "expired" ? (
                      <p className="m-0 text-sm text-amber-700">This one-time link expired. Return to step 2 and open {config.appName} again.</p>
                    ) : null}

                    {activationStatus === "connected" ? (
                      <CopyLinkRow value={RETURN_TO_OPENWORK_URL} copied={returnCopied} onCopy={() => void copyReturnLink()} />
                    ) : connectLink ? (
                      <div className="grid gap-2">
                        <p className="m-0 text-[11px] text-[#7a808a]">Nothing opened? Copy this {config.appName} link and open it anywhere links work.</p>
                        <CopyLinkRow value={connectLink} copied={connectCopied} onCopy={() => void copyConnectionLink()} />
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </li>

            <li
              className="den-frame-inset grid grid-cols-[2rem_1fr] gap-3 rounded-[1.25rem] p-4"
              data-state={guideStep === 3 ? "active" : "pending"}
              data-testid="install-guide-step-signin"
            >
              <span className="grid size-8 place-items-center rounded-full border border-[var(--dls-border-strong)] font-semibold text-[var(--dls-text-primary)]" aria-hidden="true">3</span>
              <div>
                <p className="m-0 font-semibold text-[var(--dls-text-primary)]">登录</p>
                <p className="den-copy">
                  {guideStep === 3
                    ? `返回 ${config.appName}，确认连接 ${config.clientName}，然后登录公司账号。`
                    : `应用连接后，登录 ${config.clientName} 的公司账号。`}
                </p>
              </div>
            </li>
          </ol>
        ) : (
          <div className="grid justify-items-center gap-4">
            <div className="den-frame-inset grid gap-2 rounded-[1.25rem] p-4 text-left" role="status">
              <p className="m-0 font-medium text-[var(--dls-text-primary)]">公司服务尚未配置桌面登录交接</p>
              <p className="den-copy">请联系管理员完成配置。当前仍可先下载安装 FoxWork。</p>
            </div>
            <a className="den-button-primary w-full justify-center sm:w-auto" href={primaryHref} data-testid="install-download-primary" onClick={() => beginDownload(primaryLabel, primaryHref)}>
              下载 {primaryLabel} 版本
            </a>
            <div className="flex flex-wrap justify-center gap-2">
              {secondaryPlatforms.map((option) => (
                <a key={option.value} className="den-button-secondary" href={installHref(config, option.value, token)} onClick={() => beginDownload(option.label, installHref(config, option.value, token))}>
                  {option.label}
                </a>
              ))}
            </div>
            {downloadState !== "idle" ? (
              <div className="den-frame-inset grid w-full justify-items-center gap-2 rounded-[1.25rem] p-4" aria-live="polite" data-testid="install-download-status">
                {downloadState === "preparing" ? (
                  <>
                    <span className="size-5 animate-spin rounded-full border-2 border-[var(--dls-border-strong)] border-t-[var(--dls-accent)]" aria-hidden="true" />
                    <p className="m-0 font-medium text-[var(--dls-text-primary)]">正在准备 {downloadLabel} 安装包...</p>
                    <p className="den-copy">首次下载可能需要一分钟，准备完成后浏览器会自动开始下载。</p>
                  </>
                ) : (
                  <>
                    <p className="m-0 font-medium text-[var(--dls-text-primary)]">下载已开始</p>
                    <p className="den-copy">浏览器正在准备文件。如果没有看到下载任务，请重新下载。</p>
                    <a className="den-button-secondary" href={downloadHref} onClick={() => beginDownload(downloadLabel, downloadHref)}>
                      重新下载
                    </a>
                  </>
                )}
              </div>
            ) : null}
          </div>
        )}
        </div>
      </section>
    </OnboardingShell>
  );
}
