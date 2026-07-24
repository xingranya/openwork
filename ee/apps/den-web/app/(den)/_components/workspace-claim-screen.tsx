"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { getDesktopGrant } from "../_lib/desktop-handoff";
import { getErrorMessage, requestJson } from "../_lib/den-flow";
import {
  PENDING_WORKSPACE_CLAIM_STORAGE_KEY,
  getOrgDashboardRoute,
} from "../_lib/den-org";
import { useDenFlow } from "../_providers/den-flow-provider";
import { AuthPanel } from "./auth-panel";
import { FOXWORK_DESKTOP_SCHEME } from "../_lib/foxwork-brand";

function LoadingCard({ title, body }: { title: string; body: string }) {
  return (
    <section className="den-page py-4 lg:py-6">
      <div className="den-frame grid max-w-[44rem] gap-4 p-6 md:p-7">
        <p className="den-eyebrow">FoxWork 公司服务</p>
        <div className="grid gap-2">
          <h1 className="den-title-lg">{title}</h1>
          <p className="den-copy">{body}</p>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[var(--dls-hover)]">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-[var(--dls-accent)]" />
        </div>
      </div>
    </section>
  );
}

type AcceptedClaim = {
  organizationName: string;
  organizationSlug: string;
};

const AUTO_ACCEPT_WORKSPACE_CLAIM_STORAGE_KEY = "openwork:web:auto-accept-workspace-claim";

function parseAcceptedClaim(payload: unknown): AcceptedClaim | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const organization = (payload as { organization?: unknown }).organization;
  if (typeof organization !== "object" || organization === null) {
    return null;
  }

  const name = (organization as { name?: unknown }).name;
  const slug = (organization as { slug?: unknown }).slug;

  return {
    organizationName: typeof name === "string" ? name : "公司",
    organizationSlug: typeof slug === "string" ? slug : "",
  };
}

function getOpenworkUrl(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const url = (payload as { openworkUrl?: unknown }).openworkUrl;
  return typeof url === "string" && url.trim() ? url : null;
}

async function inviteTeammates(inviteEmails: readonly string[]): Promise<string> {
  const results = await Promise.allSettled(
    inviteEmails.map((email) =>
      requestJson("/v1/invitations", { method: "POST", body: JSON.stringify({ email, role: "member" }) }, 12000),
    ),
  );

  const succeeded = results.filter((result) => result.status === "fulfilled" && result.value.response.ok).length;
  const failed = inviteEmails.length - succeeded;

  if (failed === 0) {
    return `已邀请 ${succeeded} 名成员。`;
  }
  if (succeeded === 0) {
    return `${failed} 名成员邀请失败，可以稍后在成员管理中重试。`;
  }
  return `已邀请 ${succeeded} 名成员，另有 ${failed} 名邀请失败。可以在成员管理中重试。`;
}

export function WorkspaceClaimScreen({
  token,
  prefilledEmail,
  inviteEmails = [],
}: {
  token: string;
  prefilledEmail?: string;
  inviteEmails?: string[];
}) {
  const router = useRouter();
  const { user, sessionHydrated, signOut } = useDenFlow();
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimedOrg, setClaimedOrg] = useState<AcceptedClaim | null>(null);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [handoffAttempted, setHandoffAttempted] = useState(false);
  const [inviteSummary, setInviteSummary] = useState<string | null>(null);
  const autoClaimAttempted = useRef(false);
  const isLoopback = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

  // Persist the token so sign-in / sign-up returns the user to this page.
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (token) {
      window.sessionStorage.setItem(PENDING_WORKSPACE_CLAIM_STORAGE_KEY, token);
    } else {
      window.sessionStorage.removeItem(PENDING_WORKSPACE_CLAIM_STORAGE_KEY);
    }
  }, [token]);

  useEffect(() => {
    if (!sessionHydrated || user || !token || typeof window === "undefined") return;
    window.sessionStorage.setItem(AUTO_ACCEPT_WORKSPACE_CLAIM_STORAGE_KEY, token);
  }, [sessionHydrated, token, user]);

  async function handleClaim() {
    if (!token) {
      setClaimError("公司初始化链接不完整。");
      return;
    }

    setClaimBusy(true);
    setClaimError(null);

    try {
      const { response, payload } = await requestJson(
        "/v1/bootstrap/claims/accept",
        {
          method: "POST",
          body: JSON.stringify({ token }),
        },
        12000,
      );

      if (!response.ok) {
        setClaimError(
          getErrorMessage(
            payload,
            response.status === 404
              ? "公司初始化链接不存在、已过期或已经使用。"
              : `无法完成公司初始化（${response.status}）。`,
          ),
        );
        return;
      }

      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(PENDING_WORKSPACE_CLAIM_STORAGE_KEY);
      }

      if (inviteEmails.length > 0) {
        // The claim above just made this account the owner (and set it as
        // the session's active organization), so it can now invite
        // teammates through the same endpoint Manage Members uses. Show the
        // result briefly before moving on - this is best-effort: a failed
        // invite never blocks the claim, the owner can always retry from
        // Manage Members.
        const summary = await inviteTeammates(inviteEmails);
        setInviteSummary(summary);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 1400));
      }

      // Don't navigate away immediately - offer to sign the already-running
      // desktop app in with zero retyped credentials, reusing the same
      // one-time handoff grant the normal "connect desktop" flow already
      // uses. The human chooses; we never auto-redirect them into an OS
      // "open this link?" prompt without asking.
      setClaimedOrg(parseAcceptedClaim(payload));
    } catch (error) {
      setClaimError(error instanceof Error ? error.message : "无法完成公司初始化。");
    } finally {
      setClaimBusy(false);
    }
  }

  useEffect(() => {
    if (!sessionHydrated || !user || !token || claimBusy || claimedOrg || autoClaimAttempted.current) return;
    if (window.sessionStorage.getItem(AUTO_ACCEPT_WORKSPACE_CLAIM_STORAGE_KEY) !== token) return;

    autoClaimAttempted.current = true;
    window.sessionStorage.removeItem(AUTO_ACCEPT_WORKSPACE_CLAIM_STORAGE_KEY);
    void handleClaim();
  }, [claimBusy, claimedOrg, sessionHydrated, token, user]);

  async function createDesktopHandoff(): Promise<string> {
    const { response, payload } = await requestJson(
      "/v1/auth/desktop-handoff",
      {
        method: "POST",
        body: JSON.stringify({ desktopScheme: FOXWORK_DESKTOP_SCHEME }),
      },
      12000,
    );

    if (!response.ok) {
      throw new Error(getErrorMessage(payload, `无法准备 FoxWork 登录链接（${response.status}）。`));
    }

    const openworkUrl = getOpenworkUrl(payload);
    if (!openworkUrl) {
      throw new Error("登录交接已完成，但没有返回 FoxWork 打开链接。");
    }

    return openworkUrl;
  }

  async function handleOpenDesktop() {
    setHandoffBusy(true);
    setHandoffError(null);
    setHandoffAttempted(true);

    try {
      window.location.assign(await createDesktopHandoff());
    } catch (error) {
      setHandoffError(error instanceof Error ? error.message : "无法打开 FoxWork。");
    } finally {
      setHandoffBusy(false);
    }
  }

  async function handleCopySignInCode() {
    setCopyBusy(true);
    setCodeCopied(false);
    setHandoffError(null);

    try {
      if (!navigator.clipboard) {
        throw new Error("当前浏览器无法使用剪贴板。");
      }

      const grant = getDesktopGrant(await createDesktopHandoff());
      if (!grant) {
        throw new Error("登录交接已完成，但没有返回一次性登录码。");
      }

      await navigator.clipboard.writeText(grant);
      setCodeCopied(true);
      window.setTimeout(() => setCodeCopied(false), 1800);
    } catch (error) {
      setHandoffError(error instanceof Error ? error.message : "无法复制登录码。");
    } finally {
      setCopyBusy(false);
    }
  }

  function continueInBrowser() {
    router.replace(getOrgDashboardRoute(claimedOrg?.organizationSlug ?? null));
  }

  if (!token) {
    return (
      <section className="den-page py-4 lg:py-6">
        <div className="den-frame grid max-w-[44rem] gap-6 p-6 md:p-8">
          <div className="grid gap-2">
            <p className="den-eyebrow">FoxWork 公司服务</p>
            <h1 className="den-title-lg">无法打开公司初始化链接</h1>
            <p className="den-copy">链接缺少必要信息，请重新打开原链接或向管理员索取新链接。</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/" className="den-button-primary w-full sm:w-auto">
              返回公司入口
            </Link>
          </div>
        </div>
      </section>
    );
  }

  if (!sessionHydrated) {
    return <LoadingCard title="正在准备公司初始化" body="正在检查账号状态..." />;
  }

  // Signed out: collect credentials, then resume on this page automatically.
  if (!user) {
    return (
      <section className="den-page py-6 lg:py-10">
        <div className="mx-auto grid w-full max-w-[32rem] gap-5">
          <div className="grid gap-2 text-center">
            <p className="den-eyebrow">FoxWork 公司服务</p>
            <h1 className="den-title-lg">完成公司初始化</h1>
            <p className="den-copy">
              登录或创建账号后，该账号将成为公司所有者。
            </p>
          </div>

          <AuthPanel
            eyebrow="公司所有者"
            // Prefill only - never locked. The claim token (not the email) is
            // what authorizes accepting this claim, so the human can still
            // claim with a different email if they want to.
            prefilledEmail={prefilledEmail}
            prefillKey={token}
            signUpContent={{
              title: "创建公司账号",
              copy: "这个账号将成为公司所有者。",
              submitLabel: "创建账号并完成初始化",
            }}
            signInContent={{
              title: "登录后继续",
              copy: "当前账号将成为公司所有者。",
              submitLabel: "登录并完成初始化",
            }}
          />
        </div>
      </section>
    );
  }

  // Claimed: offer to sign the desktop app in with zero retyped credentials,
  // or continue in the browser.
  if (claimedOrg) {
    return (
      <section
        className={`flex min-h-dvh w-full items-center justify-center px-5 py-8 ${isLoopback ? "bg-[#edf6ff]" : ""}`}
        data-demo-claim={isLoopback ? "true" : undefined}
      >
        <div className={`den-frame mx-auto grid w-full max-w-[38rem] gap-7 p-7 text-center md:p-10 ${isLoopback ? "border-blue-200/80 bg-white/90 shadow-[0_28px_80px_-44px_rgba(37,99,235,0.45)]" : ""}`}>
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-blue-600 text-white shadow-[0_12px_28px_-14px_rgba(37,99,235,0.8)]">
            <Check className="size-6" strokeWidth={2.5} aria-hidden />
          </div>

          <div className="grid justify-items-center gap-3">
            <p className={`den-eyebrow ${isLoopback ? "text-blue-700" : ""}`}>{isLoopback ? "测试环境已准备" : "公司初始化完成"}</p>
            <h1 className="den-title-lg max-w-[22ch]">已完成 {claimedOrg.organizationName} 的初始化</h1>
            <p className="den-copy max-w-[46ch]">
              {isLoopback
                ? "复制一次性登录码，再粘贴到 FoxWork 中完成登录。"
                : "打开 FoxWork 完成登录，无需再次输入密码。"}
            </p>
          </div>

          <div className="grid gap-3">
            {isLoopback ? (
              <button
                type="button"
                className="den-button-primary w-full bg-blue-600 shadow-[0_16px_34px_-18px_rgba(37,99,235,0.75)] hover:!bg-blue-700"
                onClick={() => void handleCopySignInCode()}
                disabled={handoffBusy || copyBusy}
              >
                <Copy className="size-4" aria-hidden />
                {copyBusy ? "正在复制..." : codeCopied ? "登录码已复制" : "复制登录码"}
              </button>
            ) : (
              <button
                type="button"
                className="den-button-primary w-full sm:w-auto"
                onClick={() => void handleOpenDesktop()}
                disabled={handoffBusy || copyBusy}
              >
                {handoffBusy ? "正在打开 FoxWork..." : "打开 FoxWork"}
              </button>
            )}

            <div className="flex flex-col items-center justify-center gap-2 text-sm sm:flex-row sm:gap-5">
              {isLoopback ? (
                <button
                  type="button"
                  className="inline-flex min-h-10 items-center gap-1.5 px-2 font-medium text-[var(--dls-text-primary)] transition hover:text-blue-700 disabled:opacity-60"
                  onClick={() => void handleOpenDesktop()}
                  disabled={handoffBusy || copyBusy}
                >
                  <ExternalLink className="size-3.5" aria-hidden />
                  {handoffBusy ? "正在打开 FoxWork..." : "打开 FoxWork"}
                </button>
              ) : (
                <button
                  type="button"
                  className="inline-flex min-h-10 items-center gap-1.5 px-2 font-medium text-[var(--dls-text-secondary)] transition hover:text-[var(--dls-text-primary)] disabled:opacity-60"
                  onClick={() => void handleCopySignInCode()}
                  disabled={handoffBusy || copyBusy}
                >
                  <Copy className="size-3.5" aria-hidden />
                  {copyBusy ? "正在复制..." : codeCopied ? "登录码已复制" : "复制登录码"}
                </button>
              )}
              <span className="hidden text-[var(--dls-border)] sm:inline" aria-hidden>•</span>
              <button
                type="button"
                className="min-h-10 px-2 font-medium text-[var(--dls-text-secondary)] transition hover:text-[var(--dls-text-primary)] disabled:opacity-60"
                onClick={continueInBrowser}
                disabled={handoffBusy || copyBusy}
              >
                在浏览器中继续
              </button>
            </div>
          </div>

          {codeCopied ? (
            <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">
              在 FoxWork 中选择“粘贴登录码”，然后粘贴一次。
            </div>
          ) : null}

          {handoffAttempted && !handoffError ? (
            <p className="den-copy text-sm">
              正在打开 FoxWork。如果没有反应，可能是这台电脑尚未安装应用，请先在浏览器中继续。
            </p>
          ) : null}
          {handoffError ? <div className="den-notice is-error">{handoffError}</div> : null}
        </div>
      </section>
    );
  }

  // Signed in: confirm ownership.
  return (
    <section className="den-page py-6 lg:py-10">
      <div className="den-frame mx-auto grid max-w-[34rem] gap-6 p-6 md:p-8">
        <div className="grid gap-2">
          <p className="den-eyebrow">FoxWork 公司服务</p>
          <h1 className="den-title-lg">确认公司所有者</h1>
          <p className="den-copy">确认后，当前账号将成为公司所有者。</p>
        </div>

        <div className="den-frame-inset grid gap-1 rounded-[1.5rem] px-4 py-3">
          <p className="den-label">当前账号</p>
          <p className="m-0 text-sm font-medium text-[var(--dls-text-primary)]">{user.email}</p>
        </div>

        <div className="grid gap-4">
          {inviteEmails.length > 0 ? (
            <div className="den-frame-inset rounded-[1.5rem] px-4 py-3">
              <p className="den-label">初始化后邀请以下成员</p>
              <p className="m-0 text-sm text-[var(--dls-text-primary)]">{inviteEmails.join(", ")}</p>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="den-button-primary w-full sm:w-auto"
              onClick={() => void handleClaim()}
              disabled={claimBusy}
            >
              {claimBusy ? (inviteSummary ?? "正在完成初始化...") : "确认并完成初始化"}
            </button>
            <button
              type="button"
              className="den-button-secondary w-full sm:w-auto"
              onClick={() => void signOut()}
              disabled={claimBusy}
            >
              切换账号
            </button>
          </div>
        </div>

        {inviteSummary ? <div className="den-notice is-info">{inviteSummary}</div> : null}
        {claimError ? <div className="den-notice is-error">{claimError}</div> : null}
      </div>
    </section>
  );
}
