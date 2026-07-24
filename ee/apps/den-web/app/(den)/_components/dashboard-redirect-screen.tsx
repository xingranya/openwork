"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isSamePathname } from "../_lib/client-route";
import { useDenFlow } from "../_providers/den-flow-provider";

export function DashboardRedirectScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const redirectingRef = useRef(false);
  const { resolveUserLandingRoute, sessionHydrated } = useDenFlow();

  useEffect(() => {
    if (!sessionHydrated || redirectingRef.current) {
      return;
    }

    redirectingRef.current = true;
    void resolveUserLandingRoute()
      .then((target) => {
        const nextTarget = target ?? "/";
        if (!isSamePathname(pathname, nextTarget)) {
          router.replace(nextTarget);
        }
      })
      .finally(() => {
        redirectingRef.current = false;
      });
  }, [pathname, resolveUserLandingRoute, router, sessionHydrated]);

  return (
    <section className="mx-auto grid w-full max-w-[52rem] gap-4 rounded-[32px] border border-gray-100 bg-white p-6 shadow-[0_10px_30px_-24px_rgba(15,23,42,0.22)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">FoxWork 公司服务</p>
      <p className="text-2xl font-semibold tracking-[-0.04em] text-gray-900">正在进入公司</p>
      <p className="text-sm text-gray-500">正在确认你的公司身份和访问权限。</p>
    </section>
  );
}
