"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, RefreshCw } from "lucide-react";
import { DenButton, buttonVariants } from "../../_components/ui/button";
import { DenNotice } from "../../_components/ui/notice";
import { formatMoneyMinor, formatSubscriptionStatus, getErrorMessage, getRequestError, requestJson } from "../../_lib/den-flow";
import { DashboardPageTemplate } from "../../_components/ui/dashboard-page-template";
import { getInferenceRoute, getMembersRoute } from "../../_lib/den-org";
import { useDenFlow } from "../../_providers/den-flow-provider";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";

type StripeBilling = {
  configured: boolean;
  priceId: string | null;
  unitAmount: number;
  currency: string;
  interval: string;
  memberCount: number;
  hasActiveSubscription: boolean;
  portalUrl: string | null;
  subscription: {
    status: string;
    quantity: number;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  seats: StripeSeatBilling;
};

type StripeSeatBilling = {
  configured: boolean;
  priceId: string | null;
  unitAmount: number;
  currency: string;
  interval: string;
  freeSeatCount: number;
  billableSeatCount: number;
  hasActiveSubscription: boolean;
  subscription: {
    status: string;
    quantity: number;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
};

type PolarBilling = {
  hasActivePlan: boolean;
  portalUrl: string | null;
  subscription: {
    status: string;
  } | null;
};

function parseStripeBilling(payload: unknown): StripeBilling | null {
  if (!payload || typeof payload !== "object" || !("billing" in payload)) return null;
  const billing = (payload as { billing?: unknown }).billing;
  if (!billing || typeof billing !== "object" || !("stripe" in billing)) return null;
  const stripe = (billing as { stripe?: unknown }).stripe;
  if (!stripe || typeof stripe !== "object") return null;
  const value = stripe as Partial<StripeBilling>;
  const seats = value.seats && typeof value.seats === "object" ? value.seats as Partial<StripeSeatBilling> : null;
  if (
    typeof value.unitAmount !== "number" ||
    typeof value.currency !== "string" ||
    typeof value.interval !== "string" ||
    typeof value.memberCount !== "number" ||
    typeof seats?.unitAmount !== "number" ||
    typeof seats.currency !== "string" ||
    typeof seats.interval !== "string" ||
    typeof seats.freeSeatCount !== "number" ||
    typeof seats.billableSeatCount !== "number"
  ) return null;
  return {
    configured: value.configured === true,
    priceId: typeof value.priceId === "string" ? value.priceId : null,
    unitAmount: value.unitAmount,
    currency: value.currency,
    interval: value.interval,
    memberCount: value.memberCount,
    hasActiveSubscription: value.hasActiveSubscription === true,
    portalUrl: typeof value.portalUrl === "string" ? value.portalUrl : null,
    subscription: value.subscription && typeof value.subscription === "object"
      ? {
          status: typeof value.subscription.status === "string" ? value.subscription.status : "unknown",
          quantity: typeof value.subscription.quantity === "number" ? value.subscription.quantity : 0,
          currentPeriodEnd: typeof value.subscription.currentPeriodEnd === "string" ? value.subscription.currentPeriodEnd : null,
          cancelAtPeriodEnd: value.subscription.cancelAtPeriodEnd === true,
        }
      : null,
    seats: {
      configured: seats?.configured === true,
      priceId: typeof seats?.priceId === "string" ? seats.priceId : null,
      unitAmount: seats.unitAmount,
      currency: seats.currency,
      interval: seats.interval,
      freeSeatCount: seats.freeSeatCount,
      billableSeatCount: seats.billableSeatCount,
      hasActiveSubscription: seats?.hasActiveSubscription === true,
      subscription: seats?.subscription && typeof seats.subscription === "object"
        ? {
            status: typeof seats.subscription.status === "string" ? seats.subscription.status : "unknown",
            quantity: typeof seats.subscription.quantity === "number" ? seats.subscription.quantity : 0,
            currentPeriodEnd: typeof seats.subscription.currentPeriodEnd === "string" ? seats.subscription.currentPeriodEnd : null,
            cancelAtPeriodEnd: seats.subscription.cancelAtPeriodEnd === true,
          }
        : null,
    },
  };
}

const STRIPE_RETURN_POLL_ATTEMPTS = 20;
const STRIPE_RETURN_POLL_INTERVAL_MS = 3000;
function parsePolarBilling(payload: unknown): PolarBilling | null {
  if (!payload || typeof payload !== "object" || !("billing" in payload)) return null;
  const billing = (payload as { billing?: unknown }).billing;
  if (!billing || typeof billing !== "object" || !("polar" in billing)) return null;
  const polar = (billing as { polar?: unknown }).polar;
  if (!polar || typeof polar !== "object") return null;
  const value = polar as Partial<PolarBilling>;
  return {
    hasActivePlan: value.hasActivePlan === true,
    portalUrl: typeof value.portalUrl === "string" ? value.portalUrl : null,
    subscription: value.subscription && typeof value.subscription === "object"
      ? {
          status: typeof value.subscription.status === "string" ? value.subscription.status : "active",
        }
      : null,
  };
}

export function BillingDashboardScreen() {
  const router = useRouter();
  const { sessionHydrated, user } = useDenFlow();
  const { activeOrg, orgContext, runReauthableAction } = useOrgDashboard();
  const [stripeBilling, setStripeBilling] = useState<StripeBilling | null>(null);
  const [polarBilling, setPolarBilling] = useState<PolarBilling | null>(null);
  const [stripeBusy, setStripeBusy] = useState(false);
  const [stripeActionBusy, setStripeActionBusy] = useState<"seat-checkout" | "portal" | null>(null);
  const [stripeError, setStripeError] = useState<string | null>(null);
  const [stripeReturnChecking, setStripeReturnChecking] = useState(false);

  const isOwner = orgContext?.currentMember.isOwner === true;

  async function refreshStripeBilling(quiet = false) {
    setStripeBusy(true);
    if (!quiet) setStripeError(null);
    try {
      const { response, payload } = await requestJson("/v1/billing", { method: "GET" }, 12000);
      if (!response.ok) throw new Error(getErrorMessage(payload, `查询 Stripe 账单失败（${response.status}）。`));
      const parsed = parseStripeBilling(payload);
      if (!parsed) throw new Error("Stripe 账单数据不完整。");
      setStripeBilling(parsed);
      setPolarBilling(parsePolarBilling(payload));
      return parsed;
    } catch (error) {
      if (!quiet) setStripeError(getErrorMessage(error, "加载 Stripe 账单失败，请重试。"));
      return null;
    } finally {
      setStripeBusy(false);
    }
  }

  useEffect(() => {
    if (!sessionHydrated || !user) return;
    void refreshStripeBilling(false);
  }, [sessionHydrated, user, orgContext?.organization.id]);

  useEffect(() => {
    if (!sessionHydrated || !user || typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    if (params.get("stripe_checkout") !== "seat") return;
    const sessionId = params.get("session_id")?.trim() ?? "";

    let cancelled = false;
    let attempts = 0;
    setStripeReturnChecking(true);

    async function pollSeatSubscription() {
      attempts += 1;
      if (attempts === 1 && sessionId) {
        try {
          await runReauthableAction("stripe-checkout-sync", async () => {
            const { response, payload } = await requestJson(
              "/v1/billing/stripe/checkout/sync",
              { method: "POST", body: JSON.stringify({ sessionId }) },
              12000,
            );
            if (!response.ok) {
              setStripeError(getErrorMessage(payload, `同步 Stripe 结账结果失败（${response.status}）。`));
            }
          });
        } catch (error) {
          if (!cancelled) {
            setStripeError(getErrorMessage(error, "同步 Stripe 结账结果失败，请重试。"));
          }
        }
      }
      const billing = await refreshStripeBilling(true);
      if (cancelled) return;

      if (billing?.seats.hasActiveSubscription || attempts >= STRIPE_RETURN_POLL_ATTEMPTS) {
        setStripeReturnChecking(false);
        const url = new URL(window.location.href);
        url.searchParams.delete("stripe_checkout");
        url.searchParams.delete("session_id");
        window.history.replaceState(null, "", url.toString());
        return;
      }

      window.setTimeout(() => void pollSeatSubscription(), STRIPE_RETURN_POLL_INTERVAL_MS);
    }

    void pollSeatSubscription();

    return () => {
      cancelled = true;
    };
  }, [sessionHydrated, user, orgContext?.organization.id]);

  async function startSeatCheckout() {
    setStripeError(null);
    try {
      await runReauthableAction("seat-checkout", async () => {
        setStripeActionBusy("seat-checkout");
        const { response, payload } = await requestJson(
          "/v1/billing/stripe/checkout",
          { method: "POST", body: JSON.stringify({ type: "seat" }) },
          12000,
        );
        if (!response.ok) throw getRequestError(payload, response, `创建成员订阅订单失败（${response.status}）。`);
        const url = payload && typeof payload === "object" && "url" in payload && typeof payload.url === "string" ? payload.url : null;
        if (!url) throw new Error("公司服务没有返回结账地址。");
        window.location.href = url;
      });
    } catch (error) {
      setStripeError(getErrorMessage(error, "发起成员订阅失败，请重试。"));
    } finally {
      setStripeActionBusy(null);
    }
  }

  async function openStripePortal() {
    setStripeError(null);
    try {
      await runReauthableAction("billing-portal", async () => {
        setStripeActionBusy("portal");
        const { response, payload } = await requestJson("/v1/billing/stripe/portal", { method: "POST" }, 12000);
        if (!response.ok) throw getRequestError(payload, response, `打开账单管理页失败（${response.status}）。`);
        const url = payload && typeof payload === "object" && "url" in payload && typeof payload.url === "string" ? payload.url : null;
        if (!url) throw new Error("公司服务没有返回账单管理地址。");
        window.location.href = url;
      });
    } catch (error) {
      setStripeError(getErrorMessage(error, "打开 Stripe 账单管理页失败，请重试。"));
    } finally {
      setStripeActionBusy(null);
    }
  }

  const showPolar = polarBilling?.hasActivePlan === true && Boolean(polarBilling.portalUrl);
  const stripePrice = stripeBilling ? formatMoneyMinor(stripeBilling.unitAmount, stripeBilling.currency) : null;
  const seatBilling = stripeBilling?.seats;
  const seatPrice = seatBilling ? formatMoneyMinor(seatBilling.unitAmount, seatBilling.currency) : null;
  const activeMemberCount = stripeBilling?.memberCount ?? 0;

  return (
    <div data-testid="stripe-billing-screen">
      <DashboardPageTemplate
        icon={CreditCard}
        title="Stripe 账单"
        description="集中查看和管理公司成员席位与公司模型订阅。"
        colors={["#F5F3FF", "#312E81", "#635BFF", "#C4B5FD"]}
      >
      {stripeError && stripeBilling ? (
        <DenNotice message={stripeError} className="mb-6" />
      ) : null}

      {isOwner ? null : (
        <div className="mb-6 rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
          只有公司所有者可以购买订阅或打开账单管理页，其他成员只能查看当前账单状态。
        </div>
      )}

      {stripeReturnChecking ? (
        <div className="mb-6 rounded-[20px] border border-blue-200 bg-blue-50 px-4 py-3 text-[13px] text-blue-800">
          正在确认 Stripe 订阅状态，页面会自动刷新。
        </div>
      ) : null}

      {!stripeBilling ? (
        <section className="rounded-2xl border border-gray-200 bg-white p-8 shadow-[0_8px_30px_-20px_rgba(49,46,129,0.45)]">
          {stripeBusy ? (
            <div className="flex min-h-36 items-center justify-center gap-3 text-[14px] text-gray-500">
              <RefreshCw className="size-4 animate-spin text-[#635BFF]" aria-hidden="true" />
              正在加载 Stripe 账单详情...
            </div>
          ) : (
            <div className="mx-auto grid max-w-lg justify-items-start gap-3">
              <p className="text-[16px] font-medium text-gray-950">无法加载 Stripe 账单详情</p>
              <p className="text-[13px] leading-6 text-gray-500">{stripeError ?? "公司服务返回的账单数据不完整。"}</p>
              <DenButton icon={RefreshCw} onClick={() => void refreshStripeBilling(false)}>重试</DenButton>
            </div>
          )}
        </section>
      ) : (
        <>
          <div className="mb-6 flex items-center justify-between gap-4 rounded-2xl border border-violet-100 bg-violet-50/70 px-5 py-4">
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#635BFF]">公司 Stripe 账单</p>
              <p className="mt-1 text-[13px] text-violet-950/70">下方价格和计费周期来自公司 Stripe 配置。</p>
            </div>
            <DenButton variant="secondary" icon={RefreshCw} loading={stripeBusy} onClick={() => void refreshStripeBilling(false)}>刷新</DenButton>
          </div>

      {showPolar ? (
        <section className="mb-6 rounded-[20px] border border-gray-100 bg-white p-8 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.06)]">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-gray-400">Polar</p>
              <h2 className="text-[18px] font-medium text-gray-950">云端 Worker 套餐</h2>
              <p className="mt-2 text-[14px] text-gray-500">
                当前 Polar 订阅状态：{formatSubscriptionStatus(polarBilling?.subscription?.status ?? "active")}。
              </p>
            </div>
            {polarBilling?.portalUrl ? (
              <a href={polarBilling.portalUrl} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "secondary" })}>
                打开 Polar 管理页
              </a>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="mb-6 rounded-2xl border border-violet-100 bg-white p-8 shadow-[0_8px_30px_-20px_rgba(49,46,129,0.45)]">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-blue-500">Stripe</p>
            <h2 className="text-[20px] font-medium text-gray-950">公司成员席位</h2>
            <p className="mt-2 max-w-[620px] text-[14px] leading-6 text-gray-500">
              公司前 {seatBilling?.freeSeatCount} 位成员已包含在套餐中，超出部分按每位成员每{seatBilling?.interval === "year" ? "年" : seatBilling?.interval === "month" ? "月" : "个计费周期"} {seatPrice} 计费。
            </p>
          </div>
        </div>

        <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="rounded-[16px] border border-gray-100 bg-gray-50 p-4">
            <p className="text-[12px] text-gray-500">套餐内席位</p>
            <p className="mt-1 text-[20px] font-semibold text-gray-950">{seatBilling?.freeSeatCount}</p>
          </div>
          <div className="rounded-[16px] border border-gray-100 bg-gray-50 p-4">
            <p className="text-[12px] text-gray-500">当前成员</p>
            <p className="mt-1 text-[20px] font-semibold text-gray-950">{activeMemberCount}</p>
          </div>
          <div className="rounded-[16px] border border-gray-100 bg-gray-50 p-4">
            <p className="text-[12px] text-gray-500">计费成员</p>
            <p className="mt-1 text-[20px] font-semibold text-gray-950">{seatBilling?.billableSeatCount}</p>
          </div>
          <div className="rounded-[16px] border border-gray-100 bg-gray-50 p-4">
            <p className="text-[12px] text-gray-500">订阅状态</p>
            <p className="mt-1 text-[20px] font-semibold text-gray-950">
              {seatBilling?.hasActiveSubscription ? formatSubscriptionStatus(seatBilling.subscription?.status ?? "active") : "未订阅"}
            </p>
          </div>
        </div>

        {seatBilling?.hasActiveSubscription ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <DenButton variant="secondary" onClick={() => {
              window.location.href = getMembersRoute(activeOrg?.slug);
            }}>
              管理成员
            </DenButton>
            <DenButton disabled={!isOwner} loading={stripeActionBusy === "portal"} onClick={openStripePortal}>
              管理订阅
            </DenButton>
          </div>
        ) : (
          <div className="flex flex-col gap-4 rounded-[16px] border border-blue-100 bg-blue-50 p-5 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-[15px] font-medium text-blue-950">成员超过 {seatBilling?.freeSeatCount} 人后再购买订阅</p>
              <p className="mt-1 text-[13px] leading-5 text-blue-900/70">只对超出套餐内席位的成员收费。</p>
            </div>
            <DenButton disabled={!isOwner || seatBilling?.configured === false} loading={stripeActionBusy === "seat-checkout"} onClick={startSeatCheckout}>
              通过 Stripe 订阅
            </DenButton>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-violet-100 bg-white p-8 shadow-[0_8px_30px_-20px_rgba(49,46,129,0.45)]">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-blue-500">Stripe</p>
            <h2 className="text-[20px] font-medium text-gray-950">公司模型</h2>
            <p className="mt-2 max-w-[620px] text-[14px] leading-6 text-gray-500">
              模型服务按每位成员每{stripeBilling.interval === "year" ? "年" : stripeBilling.interval === "month" ? "月" : "个计费周期"} {stripePrice} 计费。
            </p>
          </div>
        </div>

        <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-[16px] border border-gray-100 bg-gray-50 p-4">
            <p className="text-[12px] text-gray-500">价格</p>
            <p className="mt-1 text-[20px] font-semibold text-gray-950">{stripePrice}<span className="text-[13px] font-medium text-gray-500"> / 每位成员 / {stripeBilling.interval === "year" ? "年" : stripeBilling.interval === "month" ? "月" : "计费周期"}</span></p>
          </div>
          <div className="rounded-[16px] border border-gray-100 bg-gray-50 p-4">
            <p className="text-[12px] text-gray-500">当前成员</p>
            <p className="mt-1 text-[20px] font-semibold text-gray-950">{stripeBilling.memberCount}</p>
          </div>
          <div className="rounded-[16px] border border-gray-100 bg-gray-50 p-4">
            <p className="text-[12px] text-gray-500">订阅状态</p>
            <p className="mt-1 text-[20px] font-semibold text-gray-950">
              {stripeBilling?.hasActiveSubscription ? formatSubscriptionStatus(stripeBilling.subscription?.status ?? "active") : "未订阅"}
            </p>
          </div>
        </div>

        {stripeBilling?.hasActiveSubscription ? (
          <div className="flex justify-end">
            <DenButton disabled={!isOwner} loading={stripeActionBusy === "portal"} onClick={openStripePortal}>
              管理订阅
            </DenButton>
          </div>
        ) : (
          <div className="flex flex-col gap-4 rounded-[16px] border border-blue-100 bg-blue-50 p-5 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-[15px] font-medium text-blue-950">尚未订阅</p>
              <p className="mt-1 text-[13px] leading-5 text-blue-900/70">
                前往公司模型页面查看可用模型并订阅。
              </p>
            </div>
            <DenButton onClick={() => router.push(getInferenceRoute(activeOrg?.slug))}>
              查看公司模型
            </DenButton>
          </div>
        )}
      </section>
        </>
      )}
      </DashboardPageTemplate>
    </div>
  );
}
