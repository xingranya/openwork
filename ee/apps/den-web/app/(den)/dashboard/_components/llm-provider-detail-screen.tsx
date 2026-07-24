"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink, KeyRound, Trash2, Users } from "lucide-react";
import { DenButton } from "../../_components/ui/button";
import { getRequestError, requestJson } from "../../_lib/den-flow";
import {
    getEditLlmProviderRoute,
    getLlmProvidersRoute,
} from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import {
    formatProviderTimestamp,
    getProviderApiBase,
    getProviderDocUrl,
    getProviderEnvNames,
    getProviderNpmPackage,
    useOrgLlmProviders,
} from "./llm-provider-data";

function formatCountLabel(count: number) {
    return `${count} 个模型`;
}

function getLimitLabel(config: Record<string, unknown>) {
    const limit =
        typeof config.limit === "object" && config.limit !== null
            ? (config.limit as Record<string, unknown>)
            : null;
    const context = typeof limit?.context === "number" ? limit.context : null;
    return context ? `${context.toLocaleString()} 上下文` : null;
}

export function LlmProviderDetailScreen({
    llmProviderId,
}: {
    llmProviderId: string;
}) {
    const router = useRouter();
    const { orgId, orgSlug, runReauthableAction } = useOrgDashboard();
    const { llmProviders, busy, error, reloadProviders } =
        useOrgLlmProviders(orgId);
    const [deleteBusy, setDeleteBusy] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    const provider = useMemo(
        () => llmProviders.find((entry) => entry.id === llmProviderId) ?? null,
        [llmProviderId, llmProviders],
    );

    async function deleteProvider() {
        if (!orgId || !provider) {
            return;
        }

        if (
            !window.confirm(
                `删除 ${provider.name}？已保存的模型列表和访问规则也会被删除。`,
            )
        ) {
            return;
        }

        setDeleteError(null);
        try {
            await runReauthableAction("delete-llm-provider", async () => {
                setDeleteBusy(true);
                const { response, payload } = await requestJson(
                    `/v1/llm-providers/${encodeURIComponent(provider.id)}`,
                    { method: "DELETE" },
                    12000,
                );

                if (response.status !== 204 && !response.ok) {
                    throw getRequestError(payload, response, `删除模型服务失败（${response.status}）。`);
                }

                await reloadProviders();
                router.push(getLlmProvidersRoute(orgSlug));
                router.refresh();
            });
        } catch (nextError) {
            setDeleteError(
                nextError instanceof Error
                    ? nextError.message
                    : "删除模型服务失败。",
            );
        } finally {
            setDeleteBusy(false);
        }
    }

    if (busy && !provider) {
        return (
            <div className="mx-auto max-w-[1180px] px-6 py-8 md:px-8">
                <div className="rounded-[28px] border border-gray-200 bg-white px-6 py-10 text-[15px] text-gray-500">
                    正在加载模型服务详情...
                </div>
            </div>
        );
    }

    if (!provider) {
        return (
            <div className="mx-auto max-w-[1180px] px-6 py-8 md:px-8">
                <div className="rounded-[28px] border border-red-200 bg-red-50 px-6 py-4 text-[15px] text-red-700">
                    {error ?? "找不到此模型服务。"}
                </div>
            </div>
        );
    }

    const envNames = getProviderEnvNames(provider.providerConfig);
    const npmPackage = getProviderNpmPackage(provider.providerConfig);
    const apiBase = getProviderApiBase(provider.providerConfig);
    const docUrl = getProviderDocUrl(provider.providerConfig);

    return (
        <div className="mx-auto max-w-[1180px] px-6 py-8 md:px-8">
            <div className="mb-8 flex flex-col gap-3">
                <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                    模型服务
                </p>
                <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                    <div>
                        <h1 className="text-[34px] font-semibold tracking-[-0.07em] text-gray-950">
                            {provider.name}
                        </h1>
                    </div>
                </div>
            </div>

            <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
                <Link
                    href={getLlmProvidersRoute(orgSlug)}
                    className="inline-flex items-center gap-2 text-[15px] font-medium text-gray-500 transition hover:text-gray-900"
                >
                    <ArrowLeft className="h-5 w-5" />
                    返回模型服务
                </Link>

                <div className="flex flex-wrap gap-3">
                    {provider.canManage && provider.source !== "openwork" ? (
                        <>
                            <Link
                                href={getEditLlmProviderRoute(
                                    orgSlug,
                                    provider.id,
                                )}
                            >
                                <DenButton variant="secondary">
                                    编辑模型服务
                                </DenButton>
                            </Link>
                            <DenButton
                                variant="destructive"
                                loading={deleteBusy}
                                onClick={() => void deleteProvider()}
                            >
                                <Trash2 className="h-4 w-4" />
                                删除
                            </DenButton>
                        </>
                    ) : null}
                </div>
            </div>

            {deleteError ? (
                <div className="mb-6 rounded-[28px] border border-red-200 bg-red-50 px-6 py-4 text-[14px] text-red-700">
                    {deleteError}
                </div>
            ) : null}

            <section className="mb-8 rounded-[36px] border border-gray-200 bg-white p-8 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.24)]">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                        <h2 className="text-[24px] font-semibold tracking-[-0.05em] text-gray-950">
                            服务配置
                        </h2>
                    </div>

                    <div
                        className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium ${provider.hasApiKey ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}
                    >
                        <KeyRound className="h-4 w-4" />
                        {provider.hasApiKey
                            ? "凭据已保存"
                            : "缺少凭据"}
                    </div>
                </div>

                <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-[24px] bg-gray-50 p-5">
                        <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                            服务商 ID
                        </p>
                        <p className="mt-3 text-[16px] font-medium text-gray-900">
                            {provider.providerId}
                        </p>
                    </div>
                    <div className="rounded-[24px] bg-gray-50 p-5">
                        <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                            NPM 包
                        </p>
                        <p className="mt-3 text-[16px] font-medium text-gray-900">
                            {npmPackage ?? "未设置"}
                        </p>
                    </div>
                    <div className="rounded-[24px] bg-gray-50 p-5">
                        <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                            API 地址
                        </p>
                        <p className="mt-3 break-all text-[16px] font-medium text-gray-900">
                            {apiBase ?? "未设置"}
                        </p>
                    </div>
                    <div className="rounded-[24px] bg-gray-50 p-5">
                        <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                            更新时间
                        </p>
                        <p className="mt-3 text-[16px] font-medium text-gray-900">
                            {formatProviderTimestamp(provider.updatedAt)}
                        </p>
                    </div>
                </div>

                <div className="mt-6 flex flex-wrap gap-2">
                    {envNames.map((envName) => (
                        <span
                            key={envName}
                            className="rounded-full bg-gray-100 px-3 py-1 text-[12px] font-medium text-gray-600"
                        >
                            {envName}
                        </span>
                    ))}
                    {docUrl ? (
                        <a
                            href={docUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-[12px] font-medium text-gray-600 transition hover:bg-gray-200"
                        >
                            文档
                            <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                    ) : null}
                </div>
            </section>

            <section className="mb-8 rounded-[36px] border border-gray-200 bg-white p-8 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.24)]">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h2 className="text-[24px] font-semibold tracking-[-0.05em] text-gray-950">
                            已选模型
                        </h2>
                    </div>
                    <div className="rounded-full bg-gray-100 px-4 py-2 text-[13px] font-medium text-gray-600">
                        {formatCountLabel(provider.models.length)}
                    </div>
                </div>

                <div className="mt-8 grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                    {provider.models.map((model) => {
                        const limitLabel = getLimitLabel(model.config);
                        return (
                            <div
                                key={model.id}
                                className="rounded-[24px] border border-gray-200 bg-gray-50 p-5"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-[17px] font-semibold tracking-[-0.03em] text-gray-950">
                                            {model.name}
                                        </p>
                                        <p className="mt-1 text-[13px] text-gray-500">
                                            {model.id}
                                        </p>
                                    </div>
                                    {limitLabel ? (
                                        <span className="rounded-full bg-white px-3 py-1 text-[12px] font-medium text-gray-600">
                                            {limitLabel}
                                        </span>
                                    ) : null}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </section>

            <section className="mb-8 rounded-[36px] border border-gray-200 bg-white p-8 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.24)]">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h2 className="text-[24px] font-semibold tracking-[-0.05em] text-gray-950">
                            使用范围
                        </h2>
                    </div>
                    <div className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-4 py-2 text-[13px] font-medium text-gray-600">
                        <Users className="h-4 w-4" />
                        {provider.access.members.length +
                            provider.access.teams.length}{" "}
                        项授权
                    </div>
                </div>

                <div className="mt-8 grid gap-6 xl:grid-cols-2">
                    <div className="rounded-[24px] bg-gray-50 p-5">
                        <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                            成员
                        </p>
                        <div className="mt-4 grid gap-3">
                            {provider.access.members.length === 0 ? (
                                <p className="text-[14px] text-gray-500">
                                    暂无直接授权的成员。
                                </p>
                            ) : (
                                provider.access.members.map((member) => (
                                    <div
                                        key={member.id}
                                        className="rounded-[18px] border border-gray-200 bg-white px-4 py-3"
                                    >
                                        <p className="text-[15px] font-medium text-gray-900">
                                            {member.user.name}
                                        </p>
                                        <p className="mt-1 text-[13px] text-gray-500">
                                            {member.user.email}
                                        </p>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    <div className="rounded-[24px] bg-gray-50 p-5">
                        <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                            团队
                        </p>
                        <div className="mt-4 grid gap-3">
                            {provider.access.teams.length === 0 ? (
                                <p className="text-[14px] text-gray-500">
                                    暂无获授权的团队。
                                </p>
                            ) : (
                                provider.access.teams.map((team) => (
                                    <div
                                        key={team.id}
                                        className="rounded-[18px] border border-gray-200 bg-white px-4 py-3"
                                    >
                                        <p className="text-[15px] font-medium text-gray-900">
                                            {team.name}
                                        </p>
                                        <p className="mt-1 text-[13px] text-gray-500">
                                            更新于{" "}
                                            {formatProviderTimestamp(
                                                team.updatedAt,
                                            )}
                                        </p>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </section>

            {provider.source === "custom" ? (
                <section className="rounded-[36px] border border-gray-200 bg-white p-8 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.24)]">
                    <h2 className="text-[24px] font-semibold tracking-[-0.05em] text-gray-950">
                        自定义服务原始配置
                    </h2>
                    <p className="mt-2 text-[15px] text-gray-500">
                        此处显示为自定义来源保存的原始服务配置。
                    </p>
                    <pre className="mt-6 overflow-x-auto rounded-[24px] bg-[#0f172a] p-5 text-[13px] leading-6 text-slate-100">
                        {JSON.stringify(provider.providerConfig, null, 2)}
                    </pre>
                </section>
            ) : null}
        </div>
    );
}
