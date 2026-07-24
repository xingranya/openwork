"use client";

import { Dithering } from "@paper-design/shaders-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { getErrorMessage, requestJson } from "../_lib/den-flow";
import {
  PENDING_ORG_INVITATION_STORAGE_KEY,
  formatRoleLabel,
  getJoinOrgRoute,
  getOrgDashboardRoute,
  isEmailAllowedForOrganization,
  parseInvitationPreviewPayload,
  type DenInvitationPreview,
} from "../_lib/den-org";
import { useDenFlow } from "../_providers/den-flow-provider";
import { AuthPanel } from "./auth-panel";
import { JoinOrgSuccess } from "./join-org-success";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

type JoinedOrg = {
  id: string;
  name: string;
  slug: string;
};

type AccountSummary = {
  email: string;
} | null;

function subscribeToReducedMotion(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
  mediaQuery.addEventListener("change", onStoreChange);

  return () => mediaQuery.removeEventListener("change", onStoreChange);
}

function getReducedMotionSnapshot() {
  return typeof window === "undefined" ? true : window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function getReducedMotionServerSnapshot() {
  return true;
}

function useReducedMotion() {
  return useSyncExternalStore(subscribeToReducedMotion, getReducedMotionSnapshot, getReducedMotionServerSnapshot);
}

function JoinOrgShell({
  children,
  shaderSpeed,
  state,
}: {
  children: ReactNode;
  shaderSpeed: number;
  state: string;
}) {
  return (
    <div className="relative isolate min-h-dvh overflow-y-auto bg-[#f8fbff] px-4 py-8 text-slate-950 sm:py-12" data-testid="join-org-root" data-state={state}>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#f8fbff] opacity-[0.09]"
        data-motion={shaderSpeed === 0 ? "reduced" : "ambient"}
        data-shader-speed={shaderSpeed}
        data-testid="join-org-background"
      >
        <Dithering
          speed={shaderSpeed}
          shape="warp"
          type="4x4"
          size={2.4}
          scale={0.9}
          frame={24017.6}
          colorBack="#F8FBFF"
          colorFront="#8FB7E8"
          style={{ backgroundColor: "#F8FBFF", width: "100%", height: "100%" }}
        />
      </div>

      <main className="relative z-10 mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-md flex-col justify-center sm:min-h-[calc(100dvh-6rem)]" data-testid="join-org-foreground">
        {children}
      </main>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</dt>
      <dd className="m-0 min-w-0 text-sm font-medium leading-6 text-slate-900 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function InvitationDetails({
  preview,
  account,
  roleLabel,
}: {
  preview: DenInvitationPreview;
  account: AccountSummary;
  roleLabel: string;
}) {
  return (
    <dl className="divide-y divide-slate-200/80 border-y border-slate-200/80" data-testid="join-org-invitation-details">
      <DetailRow label="公司">{preview.organization.name}</DetailRow>
      <DetailRow label="受邀邮箱">{preview.invitation.email}</DetailRow>
      <DetailRow label="角色">{roleLabel}</DetailRow>
      <DetailRow label="当前账号">{account ? account.email : "尚未登录"}</DetailRow>
    </dl>
  );
}

function InvitationHeading({
  eyebrow = "FoxWork 公司服务",
  title,
  copy,
}: {
  eyebrow?: string;
  title: string;
  copy: string;
}) {
  return (
    <div className="grid gap-2">
      <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{eyebrow}</p>
      <h1 className="m-0 text-balance text-[2rem] font-semibold leading-[0.98] tracking-[-0.055em] text-slate-950 sm:text-[2.6rem]">{title}</h1>
      <p className="m-0 text-sm leading-6 text-slate-600">{copy}</p>
    </div>
  );
}

function ActionGroup({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center" data-testid="join-org-actions">
      {children}
    </div>
  );
}

function NotNowButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="inline-flex min-h-10 items-center justify-center rounded-full px-3 text-sm font-medium text-slate-500 transition hover:text-slate-950 focus:outline-none focus:ring-4 focus:ring-slate-950/10"
      onClick={onClick}
    >
      暂不处理
    </button>
  );
}

function InlineAlert({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-rose-200 bg-white px-4 py-3 text-sm font-medium leading-6 text-rose-700" role="alert">
      {children}
    </div>
  );
}

function LoadingState({ shaderSpeed }: { shaderSpeed: number }) {
  return (
    <JoinOrgShell shaderSpeed={shaderSpeed} state="loading">
      <div className="grid gap-5" aria-busy="true">
        <InvitationHeading title="正在加载邀请" copy="正在核对邀请信息和账号状态..." />
        <div className="h-1.5 overflow-hidden rounded-full bg-white shadow-[inset_0_0_0_1px_rgba(148,163,184,0.18)]">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-slate-900" />
        </div>
      </div>
    </JoinOrgShell>
  );
}

function statusMessage(preview: DenInvitationPreview | null) {
  switch (preview?.invitation.status) {
    case "accepted":
      return "这份邀请已经使用。";
    case "canceled":
      return "这份邀请已取消。";
    case "expired":
      return "这份邀请已过期。";
    default:
      return "这份邀请已失效。";
  }
}

function formatAllowedDomains(allowedEmailDomains: readonly string[] | null | undefined) {
  if (!allowedEmailDomains || allowedEmailDomains.length === 0) {
    return "受邀邮箱";
  }

  return allowedEmailDomains.length === 1
    ? allowedEmailDomains[0]
    : allowedEmailDomains.join(", ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getStringProperty(value: unknown, key: string) {
  if (!isRecord(value)) {
    return null;
  }

  const property = value[key];
  return typeof property === "string" ? property : null;
}

export function JoinOrgScreen({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  const { user, sessionHydrated, signOut } = useDenFlow();
  const [preview, setPreview] = useState<DenInvitationPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinedOrg, setJoinedOrg] = useState<JoinedOrg | null>(null);
  const reducedMotion = useReducedMotion();
  const shaderSpeed = reducedMotion ? 0 : 0.012;

  const invitedEmailMatches = preview && user
    ? preview.invitation.email.trim().toLowerCase() === user.email.trim().toLowerCase()
    : false;
  const invitedEmailAllowed = preview
    ? isEmailAllowedForOrganization(preview.organization.allowedEmailDomains, preview.invitation.email)
    : true;
  const signedInEmailAllowed = preview && user
    ? isEmailAllowedForOrganization(preview.organization.allowedEmailDomains, user.email)
    : true;
  const roleLabel = preview ? formatRoleLabel(preview.invitation.role) : "";
  const allowedDomainsLabel = preview ? formatAllowedDomains(preview.organization.allowedEmailDomains) : "";

  useEffect(() => {
    let cancelled = false;

    async function loadPreview() {
      if (!invitationId) {
        setPreview(null);
        setPreviewError("邀请链接不完整。");
        setPreviewBusy(false);
        return;
      }

      setPreviewBusy(true);
      setPreviewError(null);

      try {
        const { response, payload } = await requestJson(
          `/v1/orgs/invitations/preview?id=${encodeURIComponent(invitationId)}`,
          { method: "GET" },
          12000,
        );

        if (cancelled) {
          return;
        }

        if (!response.ok) {
          if (typeof window !== "undefined" && response.status === 404) {
            window.sessionStorage.removeItem(PENDING_ORG_INVITATION_STORAGE_KEY);
          }

          setPreview(null);
          setPreviewError(getErrorMessage(payload, response.status === 404 ? "这份邀请已失效。" : `无法加载邀请（${response.status}）。`));
          return;
        }

        const nextPreview = parseInvitationPreviewPayload(payload);
        if (!nextPreview) {
          setPreview(null);
          setPreviewError("邀请信息不完整。");
          return;
        }

        setPreview(nextPreview);
      } catch (error) {
        if (!cancelled) {
          setPreview(null);
          setPreviewError(error instanceof Error ? error.message : "无法加载邀请。");
        }
      } finally {
        if (!cancelled) {
          setPreviewBusy(false);
        }
      }
    }

    void loadPreview();

    return () => {
      cancelled = true;
    };
  }, [invitationId]);

  function clearPendingInvitation() {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(PENDING_ORG_INVITATION_STORAGE_KEY);
    }
  }

  function handleNotNow() {
    clearPendingInvitation();
    router.replace("/");
  }

  async function handleAcceptInvitation() {
    if (!invitationId) {
      setJoinError("邀请链接不完整。");
      return;
    }
    if (!preview) {
      setJoinError("邀请信息仍在加载，请稍候。");
      return;
    }

    setJoinBusy(true);
    setJoinError(null);

    try {
      const { response, payload } = await requestJson(
        "/v1/orgs/invitations/accept",
        {
          method: "POST",
          body: JSON.stringify({ id: invitationId }),
        },
        12000,
      );

      if (!response.ok) {
        setJoinError(getErrorMessage(payload, response.status === 404 ? "无法接受这份邀请。" : `无法加入公司（${response.status}）。`));
        return;
      }

      clearPendingInvitation();

      const organizationSlug = getStringProperty(payload, "organizationSlug")?.trim() || preview.organization.slug;
      const organizationId = getStringProperty(payload, "organizationId")?.trim() || preview.organization.id;
      setJoinedOrg({
        id: organizationId,
        name: preview.organization.name,
        slug: organizationSlug,
      });
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : "无法加入公司。");
    } finally {
      setJoinBusy(false);
    }
  }

  async function handleSwitchAccount() {
    await signOut();
    if (typeof window !== "undefined" && invitationId) {
      window.sessionStorage.setItem(PENDING_ORG_INVITATION_STORAGE_KEY, invitationId);
    }
    router.replace(getJoinOrgRoute(invitationId));
  }

  if (!sessionHydrated || previewBusy) {
    return <LoadingState shaderSpeed={shaderSpeed} />;
  }

  if (joinedOrg) {
    return (
      <JoinOrgSuccess
        organizationId={joinedOrg.id}
        organizationName={joinedOrg.name}
        onContinueInBrowser={() => router.replace(joinedOrg.slug ? getOrgDashboardRoute(joinedOrg.slug) : "/dashboard")}
      />
    );
  }

  if (!preview) {
    return (
      <JoinOrgShell shaderSpeed={shaderSpeed} state="invalid">
        <div className="grid gap-5">
          <InvitationHeading title="无法打开邀请" copy={previewError ?? "无法加载这份邀请。"} />
          <ActionGroup>
            <button type="button" className="den-button-primary w-full focus:outline-none focus:ring-4 focus:ring-slate-950/10 sm:w-auto" onClick={handleNotNow}>
              返回公司入口
            </button>
          </ActionGroup>
        </div>
      </JoinOrgShell>
    );
  }

  const account = user ? { email: user.email } : null;
  const showAcceptAction = preview.invitation.status === "pending" && Boolean(user) && invitedEmailMatches;

  if (preview.invitation.status === "pending" && !invitedEmailAllowed) {
    return (
      <JoinOrgShell shaderSpeed={shaderSpeed} state="domain-blocked">
        <div className="grid gap-5">
          <InvitationHeading
            title="请使用公司允许的邮箱"
            copy={`${preview.organization.name} 只接受 ${allowedDomainsLabel} 的账号。请联系公司所有者调整邮箱范围，或重新发送邀请。`}
          />
          <InvitationDetails preview={preview} account={account} roleLabel={roleLabel} />
          <ActionGroup>
            <button type="button" className="den-button-primary w-full focus:outline-none focus:ring-4 focus:ring-slate-950/10 sm:w-auto" onClick={handleNotNow}>
              返回公司入口
            </button>
          </ActionGroup>
        </div>
      </JoinOrgShell>
    );
  }

  if (preview.invitation.status === "pending" && !user) {
    return (
      <JoinOrgShell shaderSpeed={shaderSpeed} state="signed-out">
        <div className="grid gap-4">
          <div className="grid gap-4">
            <InvitationHeading title={`加入 ${preview.organization.name}`} copy="请核对邀请信息，然后登录或创建账号。" />
            <InvitationDetails preview={preview} account={account} roleLabel={roleLabel} />
            {preview.organization.allowedEmailDomains?.length ? (
              <p className="m-0 text-sm leading-6 text-slate-600">
                这家公司只接受 {allowedDomainsLabel} 的账号。
              </p>
            ) : null}
          </div>

          <div data-testid="join-org-auth">
            <AuthPanel
              bare
              eyebrow="公司邀请"
              prefilledEmail={preview.invitation.email}
              prefillKey={preview.invitation.id}
              initialMode="sign-up"
              lockEmail
              hideEmailField
              hideLockedEmailSummary
              hideSocialAuth
              signUpContent={{
                title: "创建公司账号",
                copy: "为受邀邮箱设置密码。",
                submitLabel: `加入 ${preview.organization.name}`,
              }}
              signInContent={{
                title: "登录后继续",
                copy: "请使用受邀账号接受邀请。",
                submitLabel: "登录并加入",
              }}
              verificationContent={{
                title: "输入验证码",
                copy: `请输入发送到 ${preview.invitation.email} 的 6 位验证码。`,
                submitLabel: "确认并加入",
              }}
            />
          </div>

          <ActionGroup>
            <NotNowButton onClick={handleNotNow} />
          </ActionGroup>
        </div>
      </JoinOrgShell>
    );
  }

  return (
    <JoinOrgShell shaderSpeed={shaderSpeed} state="signed-in">
      <div className="grid gap-5">
        <InvitationHeading title={`加入 ${preview.organization.name}`} copy="请核对邀请，并使用正确的账号继续。" />
        <InvitationDetails preview={preview} account={account} roleLabel={roleLabel} />

        {preview.invitation.status !== "pending" ? (
          <div className="grid gap-4">
            <p className="m-0 text-sm leading-6 text-slate-600">{statusMessage(preview)}</p>
            <ActionGroup>
              <Link
                href={user && invitedEmailMatches ? getOrgDashboardRoute(preview.organization.slug) : "/"}
                className="den-button-primary w-full focus:outline-none focus:ring-4 focus:ring-slate-950/10 sm:w-auto"
                onClick={clearPendingInvitation}
              >
                {user && invitedEmailMatches ? "进入公司" : "返回公司入口"}
              </Link>
              <NotNowButton onClick={handleNotNow} />
            </ActionGroup>
          </div>
        ) : user && !signedInEmailAllowed ? (
          <div className="grid gap-4">
            <p className="m-0 text-sm leading-6 text-slate-600">
              {preview.organization.name} 只接受 <span className="font-medium text-slate-950">{allowedDomainsLabel}</span> 的账号。当前登录的是 <span className="font-medium text-slate-950">{user.email}</span>，无法接受这份邀请。
            </p>
            <p className="m-0 text-sm leading-6 text-slate-500">
              请退出登录，再使用公司允许的邮箱创建账号或登录。
            </p>
            <ActionGroup>
              <button
                type="button"
                className="den-button-primary w-full focus:outline-none focus:ring-4 focus:ring-slate-950/10 sm:w-auto"
                onClick={() => void handleSwitchAccount()}
                disabled={joinBusy}
              >
                退出登录
              </button>
              <NotNowButton onClick={handleNotNow} />
            </ActionGroup>
          </div>
        ) : !invitedEmailMatches ? (
          <div className="grid gap-4">
            <p className="m-0 text-sm leading-6 text-slate-600">
              这份邀请发给了 <span className="font-medium text-slate-950">{preview.invitation.email}</span>。请切换账号后继续。
            </p>
            <ActionGroup>
              <button
                type="button"
                className="den-button-primary w-full focus:outline-none focus:ring-4 focus:ring-slate-950/10 sm:w-auto"
                onClick={() => void handleSwitchAccount()}
                disabled={joinBusy}
              >
                切换账号
              </button>
              <NotNowButton onClick={handleNotNow} />
            </ActionGroup>
          </div>
        ) : (
          <div className="grid gap-4">
            <p className="m-0 text-sm leading-6 text-slate-600">确认后即可加入公司。</p>
            <ActionGroup>
              <button
                type="button"
                className="den-button-primary w-full focus:outline-none focus:ring-4 focus:ring-slate-950/10 sm:w-auto"
                onClick={() => void handleAcceptInvitation()}
                disabled={!showAcceptAction || joinBusy}
              >
                {joinBusy ? "正在加入..." : `加入 ${preview.organization.name}`}
              </button>
              <NotNowButton onClick={handleNotNow} />
            </ActionGroup>
          </div>
        )}

        {joinError ? <InlineAlert>{joinError}</InlineAlert> : null}
        {previewError ? <InlineAlert>{previewError}</InlineAlert> : null}
      </div>
    </JoinOrgShell>
  );
}
