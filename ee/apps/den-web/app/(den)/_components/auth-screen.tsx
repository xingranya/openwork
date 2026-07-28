"use client";

import { Dithering } from "@paper-design/shaders-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { isSamePathname } from "../_lib/client-route";
import { getMcpOAuthSelectOrganizationRoute } from "../_lib/mcp-oauth-route";
import { useDenFlow } from "../_providers/den-flow-provider";
import { AuthPanel } from "./auth-panel";

function SessionStatusPanel({ mode }: { mode: "checking" | "redirecting" }) {
  const status = mode === "checking"
    ? {
        title: "正在检查登录状态",
        body: "如果你已经登录，将直接进入工作区；如果还没有，可以在这里继续登录。",
      }
    : {
        title: "正在打开工作区",
        body: "登录成功，正在进入你的公司工作区。",
      };

  return (
    <div className="grid gap-6" role="status" aria-live="polite">
      <div className="grid gap-3">
        <p className="den-eyebrow">公司账号</p>
        <div className="rounded-[1.5rem] border border-[var(--dls-border)] bg-[var(--dls-hover)]/60 p-4">
          <div className="flex items-start gap-3">
            <span className="relative mt-1 flex h-2.5 w-2.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--dls-accent)] opacity-30" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--dls-accent)]" />
            </span>
            <div className="min-w-0">
              <p className="m-0 text-[14px] font-medium text-[var(--dls-text-primary)]">{status.title}</p>
              <p className="mt-1 text-[13px] leading-6 text-[var(--dls-text-secondary)]">{status.body}</p>
            </div>
          </div>
        </div>
      </div>
      <p className="m-0 text-xs leading-5 text-[var(--dls-text-secondary)]">
        无需操作，请稍候。
      </p>
    </div>
  );
}

export function AuthScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const routingRef = useRef(false);
  const { user, sessionHydrated, desktopAuthRequested, webAuthRequested, resolveUserLandingRoute } = useDenFlow();
  const hasResolvedSession = sessionHydrated && Boolean(user) && !desktopAuthRequested && !webAuthRequested;

  useEffect(() => {
    if (!hasResolvedSession || routingRef.current) {
      return;
    }

    const oauthRoute = typeof window === "undefined" ? null : getMcpOAuthSelectOrganizationRoute(window.location.search);
    if (oauthRoute && !isSamePathname(pathname, oauthRoute)) {
      router.replace(oauthRoute);
      return;
    }

    routingRef.current = true;
    void resolveUserLandingRoute()
      .then((target) => {
        if (target && !isSamePathname(pathname, target)) {
          router.replace(target);
        }
      })
      .finally(() => {
        routingRef.current = false;
      });
  }, [hasResolvedSession, pathname, resolveUserLandingRoute, router]);

  return (
    <section className="den-page flex min-h-[calc(100vh-2.5rem)] w-full items-center justify-center py-3 sm:py-4">
      <div className="den-frame relative mx-auto w-full max-w-[600px] overflow-hidden" data-testid="auth-landing-frame">
        <div className="grid lg:grid-cols-[1fr_5fr]">
          <div className="relative hidden min-h-[520px] overflow-hidden lg:block" data-testid="auth-landing-visual">
            <div className="absolute inset-0 z-0">
              <Dithering
                speed={0}
                shape="warp"
                type="4x4"
                size={2.5}
                scale={1}
                frame={30214.2}
                colorBack="#00000000"
                colorFront="#FEFEFE"
                style={{ backgroundColor: "#142033", width: "100%", height: "100%" }}
              />
            </div>
          </div>

          <div className="flex flex-col justify-center border-[var(--dls-border)] px-5 py-6 sm:px-7 sm:py-8 md:px-9 md:py-10 lg:border-l" data-testid="auth-landing-form">
            <div className="mb-6 flex items-center gap-2 lg:hidden" data-testid="auth-landing-mobile-brand">
              <img src="/openwork-mark.svg" alt="FoxWork" className="h-7 w-auto" />
              <span className="text-[1.15rem] font-semibold tracking-tight text-[var(--dls-text-primary)]">
                FoxWork
              </span>
            </div>
            {!sessionHydrated ? (
              <SessionStatusPanel mode="checking" />
            ) : hasResolvedSession ? (
              <SessionStatusPanel mode="redirecting" />
            ) : (
              <AuthPanel bare emailFirstFlow />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
