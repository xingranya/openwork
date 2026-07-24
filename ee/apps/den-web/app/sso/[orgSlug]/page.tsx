"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { getErrorMessage, getSocialCallbackUrl } from "../../(den)/_lib/den-flow";

export default function OrganizationSsoSignInPage() {
  const params = useParams<{ orgSlug: string }>();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const orgSlug = typeof params?.orgSlug === "string" ? params.orgSlug : "";

  const callbackURL = useMemo(() => searchParams.get("callbackURL") || getSocialCallbackUrl(), [searchParams]);
  const loginHint = useMemo(() => searchParams.get("loginHint") || undefined, [searchParams]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/auth/sign-in/sso", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            organizationSlug: orgSlug,
            callbackURL,
            loginHint,
          }),
        });

        const payload = await response.json().catch(() => null) as { url?: unknown; message?: unknown } | null;
        if (!response.ok) {
          throw new Error(getErrorMessage(payload, `无法开始单点登录（${response.status}）。`));
        }

        const nextUrl = typeof payload?.url === "string" ? payload.url : "";
        if (!nextUrl) {
          throw new Error("单点登录没有返回跳转地址。");
        }

        if (!cancelled) {
          window.location.assign(nextUrl);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "无法开始单点登录。");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [callbackURL, loginHint, orgSlug]);

  return (
    <main className="min-h-screen bg-[#0B1020] px-6 py-20 text-white">
      <div className="mx-auto max-w-xl rounded-[32px] border border-white/10 bg-white/5 p-8 shadow-[0_30px_90px_-40px_rgba(0,0,0,0.6)] backdrop-blur">
        <p className="text-[12px] font-semibold uppercase tracking-[0.24em] text-violet-200">公司单点登录</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em]">正在登录</h1>
        <p className="mt-3 text-[15px] leading-7 text-white/70">
          正在前往公司的身份认证服务（{orgSlug}）。
        </p>
        {error ? (
          <div className="mt-6 rounded-[20px] border border-red-400/40 bg-red-500/10 px-4 py-3 text-[14px] text-red-100">
            {error}
          </div>
        ) : (
          <div className="mt-6 rounded-[20px] border border-white/10 bg-black/20 px-4 py-3 text-[14px] text-white/70">
            如果没有自动跳转，请刷新页面后重试。
          </div>
        )}
      </div>
    </main>
  );
}
