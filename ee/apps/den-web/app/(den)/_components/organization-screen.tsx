"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { LogOut, Settings } from "lucide-react";
import { getErrorMessage, normalizeAuthIntentParam, PENDING_AUTH_INTENT_STORAGE_KEY, requestJson } from "../_lib/den-flow";
import { type DenOrgSummary, formatRoleLabel, getInferenceRoute, getMarketplaceOnboardingRoute, getOrgDashboardRoute, parseOrgListPayload } from "../_lib/den-org";
import { useOrgListWindow } from "../_lib/use-org-list-window";
import { useDenFlow } from "../_providers/den-flow-provider";

type SettingsTab = "profile" | "organizations";

export function OrganizationScreen() {
  const router = useRouter();
  const { user, sessionHydrated, signOut, runtimeConfig, runtimeConfigLoaded } = useDenFlow();
  const [orgs, setOrgs] = useState<DenOrgSummary[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>("organizations");
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const userDisplayName = useMemo(() => {
    const trimmedName = user?.name?.trim();
    if (trimmedName) return trimmedName;
    const emailLocalPart = user?.email?.split("@")[0]?.trim() ?? "";
    return emailLocalPart || "FoxWork 用户";
  }, [user?.email, user?.name]);

  const userInitials = useMemo(() => {
    const parts = userDisplayName.split(/\s+/).filter(Boolean);
    return ((parts[0]?.slice(0, 1) ?? "O") + (parts[1]?.slice(0, 1) ?? "")).toUpperCase();
  }, [userDisplayName]);

  const activeOrg = useMemo(() => orgs.find((org) => org.isActive) ?? null, [orgs]);
  const isSingleOrgMode = runtimeConfigLoaded && runtimeConfig.orgMode === "single_org";
  const singleOrgName = runtimeConfig.singleOrgName || "FoxWork";
  const singleOrgSlug = runtimeConfig.singleOrgSlug.trim();
  const singleOrgSsoConfigured = runtimeConfig.singleOrgSsoConfigured;
  const showDirectCreateFlow = !isSingleOrgMode && orgs.length === 0;
  const {
    query: orgQuery,
    setQuery: setOrgQuery,
    visible: visibleOrgs,
    filteredCount: orgFilteredCount,
    hasMore: orgHasMore,
    showMore: showMoreOrgs,
    showSearch: showOrgSearch,
  } = useOrgListWindow(orgs);

  useEffect(() => {
    if (!sessionHydrated || !runtimeConfigLoaded) return;
    if (!user) {
      router.replace("/");
      return;
    }

    let isMounted = true;

    async function loadOrgs() {
      try {
        const { response, payload } = await requestJson("/v1/me/orgs", { method: "GET" });
        if (!response.ok) {
          throw new Error(getErrorMessage(payload, "无法加载公司信息。"));
        }

        if (isMounted) {
          const parsed = parseOrgListPayload(payload);
          const nextOrgs = parsed.orgs.map((org) => ({ ...org, isActive: org.slug === parsed.activeOrgSlug }));
          const targetOrg = nextOrgs.find((org) => org.isActive) ?? nextOrgs[0] ?? null;
          if (isSingleOrgMode && targetOrg) {
            router.replace(getOrgDashboardRoute(targetOrg.slug));
            return;
          }
          setOrgs(nextOrgs);
          setShowCreate(!isSingleOrgMode && nextOrgs.length === 0);
          setBusy(false);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "加载失败，请重试。");
          setBusy(false);
        }
      }
    }

    void loadOrgs();

    return () => {
      isMounted = false;
    };
  }, [isSingleOrgMode, runtimeConfigLoaded, sessionHydrated, user, router]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (isSingleOrgMode) {
      setCreateError("当前账号只能加入这一家公司。");
      return;
    }

    const trimmed = createName.trim();
    if (!trimmed) return;

    setCreateBusy(true);
    setCreateError(null);
    try {
      const { response, payload } = await requestJson("/v1/org", {
        method: "POST",
        body: JSON.stringify({ name: trimmed }),
      });

      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "无法创建公司。"));
      }

      const organization =
        typeof payload === "object" && payload && "organization" in payload && payload.organization && typeof payload.organization === "object"
          ? (payload.organization as { slug?: unknown })
          : null;
      const nextSlug = typeof organization?.slug === "string" ? organization.slug : null;

      if (!nextSlug) {
        throw new Error("公司已创建，但服务端没有返回公司标识。");
      }

      const pendingIntent = normalizeAuthIntentParam(window.sessionStorage.getItem(PENDING_AUTH_INTENT_STORAGE_KEY));
      if (pendingIntent === "models") {
        window.sessionStorage.removeItem(PENDING_AUTH_INTENT_STORAGE_KEY);
        router.push(getInferenceRoute(nextSlug));
        return;
      }

      router.push(getMarketplaceOnboardingRoute(nextSlug));
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "无法创建公司。");
      setCreateBusy(false);
    }
  }

  function handleSwitch(slug: string) {
    router.push(getOrgDashboardRoute(slug));
  }

  if (!sessionHydrated || !runtimeConfigLoaded || busy) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fafafa]">
        <p className="text-sm text-gray-500">正在加载公司信息...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#fafafa]">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 sm:px-6">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-medium text-gray-900">FoxWork 公司服务</span>
        </div>
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <span className="min-w-0 truncate text-sm text-gray-500">{user?.email}</span>
          <button
            onClick={() => void signOut()}
            className="text-gray-400 transition-colors hover:text-gray-900"
            aria-label="退出登录"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-12">
        {isSingleOrgMode && orgs.length === 0 ? (
          <div className="mx-auto max-w-2xl">
            <section className="rounded-[1.75rem] border border-gray-200 bg-white p-5 shadow-sm sm:p-7 md:rounded-[2rem] md:p-10">
              <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#011627] text-sm font-semibold uppercase tracking-[0.08em] text-white sm:h-14 sm:w-14">
                  {userInitials}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium uppercase tracking-[0.18em] text-gray-400">FoxWork</p>
                  <h1 className="mt-2 text-[2rem] font-semibold leading-none tracking-[-0.04em] text-gray-950 sm:text-3xl">
                    {singleOrgName}
                  </h1>
                  <p className="mt-3 max-w-xl text-[13px] leading-6 text-gray-500 sm:text-sm">
                    当前账号尚未加入公司。请联系公司所有者或稍后重试。
                  </p>
                </div>
              </div>

              {error ? (
                <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
                  {error}
                </div>
              ) : null}

              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                {singleOrgSlug && singleOrgSsoConfigured ? (
                  <button
                    type="button"
                    className="w-full rounded-2xl bg-gray-900 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-gray-800 sm:w-auto"
                    onClick={() => router.push(`/sso/${encodeURIComponent(singleOrgSlug)}`)}
                  >
                    使用公司单点登录
                  </button>
                ) : null}
                <button
                  type="button"
                  className="w-full rounded-2xl border border-gray-200 px-5 py-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 sm:w-auto"
                  onClick={() => window.location.reload()}
                >
                  重新检查
                </button>
              </div>
            </section>
          </div>
        ) : null}

        {showDirectCreateFlow ? (
          <div className="mx-auto max-w-2xl">
            <section className="rounded-[1.75rem] border border-gray-200 bg-white p-5 shadow-sm sm:p-7 md:rounded-[2rem] md:p-10">
              <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-start">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#011627] text-sm font-semibold uppercase tracking-[0.08em] text-white sm:h-14 sm:w-14">
                  {userInitials}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium uppercase tracking-[0.18em] text-gray-400">FoxWork 公司服务</p>
                  <h1 className="mt-2 text-[2rem] font-semibold leading-none tracking-[-0.04em] text-gray-950 sm:text-3xl">
                    创建公司
                  </h1>
                  <p className="mt-3 max-w-xl text-[13px] leading-6 text-gray-500 sm:text-sm">
                    输入公司名称，创建后仍可修改。
                  </p>
                </div>
              </div>

              {error ? (
                <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
                  {error}
                </div>
              ) : null}

              <form onSubmit={handleCreate} className="grid gap-5">
                <label className="grid gap-2">
                  <span className="text-sm font-medium text-gray-700">公司名称</span>
                  <input
                    type="text"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    placeholder="例如：鸿喜达"
                    className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-gray-400 focus:ring-4 focus:ring-gray-900/5"
                    autoFocus
                    required
                  />
                </label>

                {createError ? <p className="text-sm font-medium text-rose-600">{createError}</p> : null}

                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                  <button
                    type="submit"
                    disabled={createBusy || !createName.trim()}
                    className="w-full rounded-2xl bg-gray-900 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50 sm:w-auto"
                  >
                    {createBusy ? "正在创建..." : "继续"}
                  </button>

                </div>
              </form>
            </section>
          </div>
        ) : !isSingleOrgMode ? (
          <div className="mx-auto max-w-5xl">
            <div className="mb-6 sm:mb-8">
              <h1 className="text-2xl font-semibold tracking-tight text-gray-900">账号设置</h1>
              <p className="mt-1 text-sm text-gray-500">查看个人资料和已加入的公司。</p>
            </div>

            <div className="mb-6 flex gap-6 overflow-x-auto border-b border-gray-200 sm:mb-8 sm:gap-8">
              <button
                type="button"
                onClick={() => setActiveTab("profile")}
                className={`border-b-2 pb-3 text-sm font-medium transition-colors ${
                  activeTab === "profile"
                    ? "border-gray-900 text-gray-900"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                个人资料
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("organizations")}
                className={`border-b-2 pb-3 text-sm font-medium transition-colors ${
                  activeTab === "organizations"
                    ? "border-gray-900 text-gray-900"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                公司
              </button>
            </div>

            {error ? (
              <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
                {error}
              </div>
            ) : null}

            {activeTab === "profile" ? (
              <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                <div className="mb-6 flex items-start gap-4">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#011627] text-sm font-semibold uppercase tracking-[0.08em] text-white">
                    {userInitials}
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-lg font-medium text-gray-900">{userDisplayName}</h2>
                    <p className="mt-1 text-sm text-gray-500">{user?.email ?? "已登录"}</p>
                  </div>
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                  <label className="grid gap-2">
                    <span className="text-sm font-medium text-gray-700">姓名</span>
                    <input
                      type="text"
                      value={user?.name ?? ""}
                      readOnly
                      className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 outline-none"
                    />
                  </label>

                  <label className="grid gap-2">
                    <span className="text-sm font-medium text-gray-700">邮箱</span>
                    <input
                      type="email"
                      value={user?.email ?? ""}
                      readOnly
                      className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 outline-none"
                    />
                  </label>

                  <label className="grid gap-2">
                    <span className="text-sm font-medium text-gray-700">用户 ID</span>
                    <input
                      type="text"
                      value={user?.id ?? ""}
                      readOnly
                      className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 outline-none"
                    />
                  </label>

                  <label className="grid gap-2">
                    <span className="text-sm font-medium text-gray-700">当前公司</span>
                    <input
                      type="text"
                      value={activeOrg?.name ?? "尚未加入公司"}
                      readOnly
                      className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 outline-none"
                    />
                  </label>
                </div>
              </section>
            ) : (
              <>
                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <p className="max-w-2xl text-sm text-gray-500">
                    每家公司都有独立的成员、权限和资源。
                  </p>
                  <div className="flex w-full flex-col gap-3 sm:w-auto sm:min-w-[18rem]">
                    {showOrgSearch ? (
                      <input
                        type="search"
                        value={orgQuery}
                        onChange={(event) => setOrgQuery(event.target.value)}
                        placeholder="搜索公司"
                        className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-400 focus:ring-4 focus:ring-gray-900/5"
                      />
                    ) : null}
                    <button
                      onClick={() => setShowCreate(true)}
                      className="w-full shrink-0 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-800 sm:w-auto"
                    >
                      + 创建公司
                    </button>
                  </div>
                </div>

                {showCreate ? (
                  <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:mb-8 sm:p-6">
                    <h2 className="mb-4 text-lg font-medium text-gray-900">创建公司</h2>
                    <form onSubmit={handleCreate} className="grid max-w-md gap-4">
                      <label className="grid gap-2">
                        <span className="text-sm font-medium text-gray-700">公司名称</span>
                        <input
                          type="text"
                          value={createName}
                          onChange={(e) => setCreateName(e.target.value)}
                          placeholder="例如：鸿喜达"
                          className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-400 focus:ring-4 focus:ring-gray-900/5"
                          autoFocus
                          required
                        />
                      </label>

                      <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row">
                        <button
                          type="button"
                          onClick={() => {
                            setShowCreate(false);
                            setCreateName("");
                            setCreateError(null);
                          }}
                          className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                        >
                          取消
                        </button>
                        <button
                          type="submit"
                          disabled={createBusy || !createName.trim()}
                          className="rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
                        >
                          {createBusy ? "正在创建..." : "创建"}
                        </button>
                      </div>

                      {createError ? <p className="text-sm font-medium text-rose-600">{createError}</p> : null}
                    </form>
                  </div>
                ) : null}

                <div className="grid gap-3 md:hidden">
                  {visibleOrgs.map((org) => (
                    <section key={org.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h2 className="truncate text-[15px] font-semibold text-gray-950">{org.name}</h2>
                          <p className="mt-1 text-xs text-gray-500">
                            {org.role === "owner" ? "创建者方案" : "免费方案"} · {formatRoleLabel(org.role)}
                          </p>
                        </div>
                        {org.isActive ? (
                          <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                            当前公司
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-4 flex gap-2">
                        <button
                          onClick={() => handleSwitch(org.slug)}
                          className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50"
                        >
                          {org.isActive ? "打开" : "切换"}
                        </button>
                        <button
                          onClick={() => handleSwitch(org.slug)}
                          className="inline-flex items-center justify-center rounded-xl border border-gray-200 px-3 py-2.5 text-gray-500 transition hover:bg-gray-50 hover:text-gray-800"
                          aria-label="公司设置"
                        >
                          <Settings className="h-4 w-4" />
                        </button>
                      </div>
                    </section>
                  ))}
                </div>

                <div className="hidden overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm md:block">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-gray-200 bg-gray-50/50">
                        <tr>
                          <th className="px-6 py-4 font-medium text-gray-500">公司</th>
                          <th className="px-6 py-4 font-medium text-gray-500">角色</th>
                          <th className="px-6 py-4 text-right font-medium text-gray-500">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {visibleOrgs.map((org) => (
                          <tr key={org.id} className="transition-colors hover:bg-gray-50/50">
                            <td className="px-6 py-4">
                              <div className="font-medium text-gray-900">{org.name}</div>
                              <div className="mt-1 text-xs text-gray-500">
                                {org.role === "owner" ? "创建者方案" : "免费方案"} · 1 名成员
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <span className="text-gray-700">{formatRoleLabel(org.role)}</span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              {org.isActive ? (
                                <span className="inline-flex cursor-default items-center rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-500">
                                  当前公司
                                </span>
                              ) : (
                                <button
                                  onClick={() => handleSwitch(org.slug)}
                                  className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition hover:bg-gray-50"
                                >
                                  切换
                                </button>
                              )}
                              <button
                                onClick={() => handleSwitch(org.slug)}
                                className="ml-2 inline-flex items-center justify-center rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
                                aria-label="公司设置"
                              >
                                <Settings className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {orgFilteredCount === 0 && orgQuery ? (
                  <p className="mt-4 text-sm text-gray-500">没有找到匹配的公司。</p>
                ) : null}

                {orgHasMore ? (
                  <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-gray-500">
                      当前显示 {visibleOrgs.length} 个，共 {orgFilteredCount} 个公司
                    </p>
                    <button
                      type="button"
                      onClick={showMoreOrgs}
                      className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 sm:w-auto"
                    >
                      展开更多
                    </button>
                  </div>
                ) : null}

                <p className="mt-8 text-center text-sm text-gray-500">当前没有待处理的公司邀请。</p>
              </>
            )}
          </div>
        ) : null}
      </main>
    </div>
  );
}
