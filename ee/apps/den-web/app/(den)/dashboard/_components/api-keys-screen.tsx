"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Copy, KeyRound, Trash2 } from "lucide-react";
import { DashboardPageTemplate } from "../../_components/ui/dashboard-page-template";
import { DenButton } from "../../_components/ui/button";
import { DenNotice } from "../../_components/ui/notice";
import { DenCard } from "../../_components/ui/card";
import { DenInput } from "../../_components/ui/input";
import { getErrorMessage, getRequestError, isReauthRequiredError, requestJson } from "../../_lib/den-flow";
import {
    getOrgAccessFlags,
    parseOrgApiKeysPayload,
    type DenOrgApiKey,
} from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";

function formatDateTime(value: string | null) {
    if (!value) {
        return "从未";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "从未";
    }

    return date.toLocaleString("zh-CN");
}

function formatKeyPreview(apiKey: DenOrgApiKey) {
    if (apiKey.start) {
        return `${apiKey.start}...`;
    }

    if (apiKey.prefix) {
        return `${apiKey.prefix}${apiKey.id.slice(0, 6)}...`;
    }

    return `${apiKey.id.slice(0, 6)}...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function getCreatedKey(payload: unknown) {
    if (!isRecord(payload) || typeof payload.key !== "string") {
        return null;
    }

    return payload.key;
}

export function ApiKeysScreen() {
    const { orgId, orgContext, runReauthableAction } = useOrgDashboard();
    const [apiKeys, setApiKeys] = useState<DenOrgApiKey[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [name, setName] = useState("");
    const [creating, setCreating] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [createdKey, setCreatedKey] = useState<string | null>(null);
    const [createdKeyName, setCreatedKeyName] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const access = useMemo(
        () =>
            getOrgAccessFlags(
                orgContext?.currentMember.role ?? "member",
                orgContext?.currentMember.isOwner ?? false,
                orgContext?.roles,
            ),
        [orgContext?.currentMember.isOwner, orgContext?.currentMember.role, orgContext?.roles],
    );

    async function loadApiKeys(isCurrent = () => true) {
        if (!orgId || !access.canManageApiKeys) {
            if (isCurrent()) {
                setApiKeys([]);
            }
            return;
        }

        if (isCurrent()) {
            setBusy(true);
            setError(null);
        }
        try {
            const { response, payload } = await requestJson(
                `/v1/api-keys`,
                { method: "GET" },
                12000,
            );
            if (!response.ok) {
                throw getRequestError(payload, response, `API 密钥加载失败（${response.status}）。`);
            }

            if (isCurrent()) {
                setApiKeys(parseOrgApiKeysPayload(payload));
            }
        } catch (nextError) {
            if (isReauthRequiredError(nextError)) {
                throw nextError;
            }

            if (isCurrent()) {
                setError(
                    nextError instanceof Error
                        ? getErrorMessage(nextError.message, "API 密钥加载失败，请重试。")
                        : "API 密钥加载失败，请重试。",
                );
            }
        } finally {
            if (isCurrent()) {
                setBusy(false);
            }
        }
    }

    useEffect(() => {
        let active = true;
        void runReauthableAction("load-api-keys", () => loadApiKeys(() => active)).catch((nextError) => {
            if (active) {
                setError(
                    nextError instanceof Error
                        ? getErrorMessage(nextError.message, "API 密钥加载失败，请重试。")
                        : "API 密钥加载失败，请重试。",
                );
            }
        });
        return () => {
            active = false;
        };
    }, [orgId, access.canManageApiKeys]);

    useEffect(() => {
        if (!copied) {
            return;
        }

        const timeout = window.setTimeout(() => setCopied(false), 1500);
        return () => window.clearTimeout(timeout);
    }, [copied]);

    async function handleCreate(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!orgId) {
            setError("没有找到公司信息，请刷新后重试。");
            return;
        }

        setError(null);
        setCreatedKey(null);
        setCreatedKeyName(null);
        setCopied(false);
        try {
            await runReauthableAction("create-api-key", async () => {
                setCreating(true);
                try {
                    const { response, payload } = await requestJson(
                        `/v1/api-keys`,
                        {
                            method: "POST",
                            body: JSON.stringify({ name }),
                        },
                        12000,
                    );

                    if (!response.ok) {
                        throw getRequestError(
                            payload,
                            response,
                            `API 密钥创建失败（${response.status}）。`,
                        );
                    }

                    const nextKey = getCreatedKey(payload);
                    if (!nextKey) {
                        throw new Error(
                            "API 密钥已创建，但没有返回密钥内容，请删除后重新创建。",
                        );
                    }

                    setCreatedKey(nextKey);
                    setCreatedKeyName(name);
                    setName("");
                    setShowCreateForm(false);
                    await loadApiKeys();
                } finally {
                    setCreating(false);
                }
            });
        } catch (nextError) {
            setError(
                nextError instanceof Error
                    ? getErrorMessage(nextError.message, "API 密钥创建失败，请重试。")
                    : "API 密钥创建失败，请重试。",
            );
        }
    }

    function openCreateForm() {
        setError(null);
        setCopied(false);
        setCreatedKey(null);
        setCreatedKeyName(null);
        setName("");
        setShowCreateForm(true);
    }

    function closeCreateForm() {
        setName("");
        setShowCreateForm(false);
    }

    async function handleDelete(apiKey: DenOrgApiKey) {
        if (
            !orgId ||
            !window.confirm(
                `确定删除“${apiKey.name ?? apiKey.start ?? "此 API 密钥"}”吗？删除后无法恢复。`,
            )
        ) {
            return;
        }

        setError(null);
        try {
            await runReauthableAction("delete-api-key", async () => {
                setDeletingId(apiKey.id);
                try {
                    const { response, payload } = await requestJson(
                        `/v1/api-keys/${encodeURIComponent(apiKey.id)}`,
                        { method: "DELETE" },
                        12000,
                    );

                    if (response.status !== 204 && !response.ok) {
                        throw getRequestError(
                            payload,
                            response,
                            `API 密钥删除失败（${response.status}）。`,
                        );
                    }

                    await loadApiKeys();
                } finally {
                    setDeletingId(null);
                }
            });
        } catch (nextError) {
            setError(
                nextError instanceof Error
                    ? getErrorMessage(nextError.message, "API 密钥删除失败，请重试。")
                    : "API 密钥删除失败，请重试。",
            );
        }
    }

    async function copyCreatedKey() {
        if (!createdKey) {
            return;
        }

        try {
            await navigator.clipboard.writeText(createdKey);
            setCopied(true);
        } catch {
            setError(
                "无法复制 API 密钥，请在离开此页面前手动复制。",
            );
        }
    }

    if (!orgContext) {
        return (
            <DashboardPageTemplate
                icon={KeyRound}
                badgeLabel="管理员"
                title="API 密钥"
                description="创建带名称和限流策略的公司 API 密钥，并随时撤销不再使用的密钥。"
                colors={["#E6FFFA", "#0F766E", "#14B8A6", "#99F6E4"]}
            >
                <div className="rounded-[28px] border border-gray-200 bg-white px-6 py-10 text-[15px] text-gray-500">
                    正在加载公司信息…
                </div>
            </DashboardPageTemplate>
        );
    }

    return (
        <DashboardPageTemplate
            icon={KeyRound}
            badgeLabel="管理员"
            title="API 密钥"
            description="管理当前公司的 FoxWork API 密钥。"
            colors={["#E6FFFA", "#0F766E", "#14B8A6", "#99F6E4"]}
        >
            {!access.canManageApiKeys ? (
                <div className="rounded-[28px] border border-amber-200 bg-amber-50 px-6 py-5 text-[14px] text-amber-900">
                    只有公司所有者和管理员可以查看或管理 API 密钥。
                </div>
            ) : (
                <>
                    {error ? (
                        <DenNotice message={error} className="mb-6" />
                    ) : null}

                    <DenCard className="mb-6">
                        {createdKey ? (
                            <div className="rounded-[24px] bg-[#0f172a] p-6 text-white">
                                <div className="flex flex-wrap items-start justify-between gap-4">
                                    <div>
                                        <p className="text-[16px] font-semibold tracking-[-0.03em]">
                                            {createdKeyName
                                                ? `“${createdKeyName}”已创建`
                                                : "新的 API 密钥已创建"}
                                        </p>
                                        <p className="mt-1 text-[14px] leading-6 text-slate-300">
                                            密钥只会显示这一次，请立即妥善保存。
                                        </p>
                                    </div>
                                </div>

                                <div className="mt-5 rounded-[20px] border border-white/10 bg-white/5 p-4">
                                    <code className="block break-all text-[13px] leading-6 text-emerald-200">
                                        {createdKey}
                                    </code>
                                </div>

                                <div className="mt-5 flex flex-wrap justify-end gap-3">
                                    <DenButton
                                        variant="secondary"
                                        icon={Copy}
                                        onClick={() => void copyCreatedKey()}
                                    >
                                        {copied ? "已复制" : "复制密钥"}
                                    </DenButton>
                                    <DenButton onClick={openCreateForm}>
                                        再创建一个密钥
                                    </DenButton>
                                </div>
                            </div>
                        ) : showCreateForm ? (
                            <form onSubmit={handleCreate}>
                                <div className="mb-5 flex items-start justify-between gap-4">
                                    <div>
                                        <p className="text-[16px] font-semibold tracking-[-0.03em] text-gray-900">
                                            创建 API 密钥
                                        </p>
                                        <p className="mt-1 text-[14px] leading-6 text-gray-500">
                                            此密钥只会关联当前公司和你的成员身份。
                                        </p>
                                    </div>
                                </div>

                                <label className="grid gap-3">
                                    <span className="text-[14px] font-medium text-gray-700">
                                        密钥名称
                                    </span>
                                    <DenInput
                                        type="text"
                                        value={name}
                                        onChange={(event) =>
                                            setName(event.target.value)
                                        }
                                        placeholder="例如：自动化任务"
                                        required
                                    />
                                </label>

                                <div className="mt-5 flex flex-wrap justify-end gap-3">
                                    <DenButton
                                        type="button"
                                        variant="secondary"
                                        onClick={closeCreateForm}
                                    >
                                        取消
                                    </DenButton>
                                    <DenButton type="submit" loading={creating}>
                                        创建 API 密钥
                                    </DenButton>
                                </div>
                            </form>
                        ) : (
                            <div className="flex flex-wrap items-center justify-between gap-4">
                                <div>
                                    <p className="text-[16px] font-semibold tracking-[-0.03em] text-gray-900">
                                        创建新的 API 密钥
                                    </p>
                                </div>
                                 <DenButton onClick={openCreateForm}>
                                    新建密钥
                                </DenButton>
                            </div>
                        )}
                    </DenCard>

                    <div className="overflow-hidden rounded-[28px] border border-gray-100 bg-white">
                        <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_180px_120px] gap-4 border-b border-gray-100 px-6 py-3 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                            <span>密钥</span>
                            <span>所有者</span>
                            <span>最后使用</span>
                            <span />
                        </div>

                        {busy ? (
                            <div className="px-6 py-8 text-center text-[13px] text-gray-400">
                                正在加载 API 密钥…
                            </div>
                        ) : apiKeys.length === 0 ? (
                            <div className="px-6 py-8 text-center text-[13px] text-gray-400">
                                当前公司还没有 API 密钥。
                            </div>
                        ) : (
                            apiKeys.map((apiKey) => (
                                <div
                                    key={apiKey.id}
                                    className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_180px_120px] items-center gap-4 border-b border-gray-100 px-6 py-4 transition hover:bg-gray-50/70 last:border-b-0"
                                >
                                    <div className="min-w-0">
                                        <p className="truncate text-[14px] font-medium text-gray-900">
                                            {apiKey.name ??
                                                apiKey.start ??
                                                "未命名密钥"}
                                        </p>
                                        <p className="mt-1 truncate text-[12px] text-gray-400">
                                            {formatKeyPreview(apiKey)}{" "}
                                            {formatDateTime(apiKey.createdAt)}
                                        </p>
                                    </div>

                                    <div className="min-w-0">
                                        <p className="truncate text-[13px] font-medium text-gray-900">
                                            {apiKey.owner.name}
                                        </p>
                                        <p className="truncate text-[12px] text-gray-400">
                                            {apiKey.owner.email}
                                        </p>
                                    </div>

                                    <span className="text-[13px] text-gray-500">
                                        {formatDateTime(apiKey.lastRequest)}
                                    </span>

                                    <div className="flex justify-end">
                                        <DenButton
                                            variant="destructive"
                                            size="sm"
                                            icon={Trash2}
                                            onClick={() =>
                                                void handleDelete(apiKey)
                                            }
                                            disabled={deletingId === apiKey.id}
                                        >
                                            {deletingId === apiKey.id
                                                ? "正在删除…"
                                                : "删除"}
                                        </DenButton>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </>
            )}
        </DashboardPageTemplate>
    );
}
