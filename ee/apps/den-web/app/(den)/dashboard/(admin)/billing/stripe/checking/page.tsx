"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CreditCard, Loader2 } from "lucide-react";
import { DashboardPageTemplate } from "../../../../../_components/ui/dashboard-page-template";
import { DenButton } from "../../../../../_components/ui/button";
import { getBillingRoute, getInferenceRoute } from "../../../../../_lib/den-org";
import { requestJson } from "../../../../../_lib/den-flow";
import { useOrgDashboard } from "../../../../_providers/org-dashboard-provider";

const MAX_ATTEMPTS = 20;
const POLL_INTERVAL_MS = 3000;

function hasActiveStripeSubscription(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("billing" in payload)) return false;
  const billing = (payload as { billing?: unknown }).billing;
  if (!billing || typeof billing !== "object" || !("stripe" in billing)) return false;
  const stripe = (billing as { stripe?: unknown }).stripe;
  return Boolean(stripe && typeof stripe === "object" && "hasActiveSubscription" in stripe && stripe.hasActiveSubscription === true);
}

export default function StripeCheckingPage() {
  const router = useRouter();
  const { activeOrg } = useOrgDashboard();
  const [failed, setFailed] = useState(false);
  const attemptsRef = useRef(0);
  const intervalRef = useRef<number | null>(null);
  // 从模型服务页发起的结算会带上 return=models，完成后返回原页面。
  // 此页面仅在客户端运行，直接读取 window.location 可避免额外的 Suspense 包装。
  const returnTarget = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("return")
    : null;
  const billingRoute = returnTarget === "models"
    ? getInferenceRoute(activeOrg?.slug)
    : getBillingRoute(activeOrg?.slug);

  useEffect(() => {
    let cancelled = false;

    function stop() {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    async function checkSubscription() {
      if (cancelled) return;
      attemptsRef.current += 1;
      try {
        const { response, payload } = await requestJson("/v1/billing", { method: "GET" }, 12000);
        if (cancelled) return;
        if (response.ok && hasActiveStripeSubscription(payload)) {
          stop();
          router.replace(billingRoute);
          return;
        }
      } catch {
        // 单次检查失败后继续轮询，直到达到最大次数。
      }
      if (attemptsRef.current >= MAX_ATTEMPTS) {
        stop();
        setFailed(true);
      }
    }

    void checkSubscription();
    intervalRef.current = window.setInterval(() => void checkSubscription(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      stop();
    };
  }, [billingRoute, router]);

  return (
    <DashboardPageTemplate
      icon={CreditCard}
      title="正在确认 Stripe 订阅"
      description="正在完成结算并刷新公司的使用权限。"
      colors={["#F5F3FF", "#312E81", "#635BFF", "#C4B5FD"]}
    >
      <section className="flex min-h-72 flex-col items-center justify-center gap-4 rounded-2xl border border-violet-100 bg-white p-12 text-center shadow-[0_8px_30px_-20px_rgba(49,46,129,0.45)]">
        {failed ? (
          <>
            <AlertCircle className="h-10 w-10 text-red-500" aria-hidden="true" />
            <p className="text-[17px] font-medium text-gray-950">暂时无法确认订阅状态</p>
            <p className="max-w-[480px] text-[14px] leading-6 text-gray-600">
              如果已经完成付款，请返回账单页刷新 Stripe 状态，或联系公司管理员。
            </p>
            <DenButton onClick={() => router.replace(billingRoute)}>返回账单页</DenButton>
          </>
        ) : (
          <>
            <Loader2 className="h-9 w-9 animate-spin text-[#635BFF]" aria-hidden="true" />
            <p className="text-[16px] font-medium text-gray-950">Stripe 正在确认订阅</p>
            <p className="max-w-sm text-[13px] leading-6 text-gray-500">页面会自动更新，权限生效后将返回公司工作区。</p>
          </>
        )}
      </section>
    </DashboardPageTemplate>
  );
}
