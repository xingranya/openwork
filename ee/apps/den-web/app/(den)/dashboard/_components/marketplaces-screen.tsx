"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Cable, Loader2, Plus, Search, Store } from "lucide-react";
import { StaticSeededGradient } from "@openwork/ui/react";
import { DashboardPageTemplate } from "../../_components/ui/dashboard-page-template";
import { DenInput } from "../../_components/ui/input";
import { buttonVariants, DenButton } from "../../_components/ui/button";
import { getErrorMessage } from "../../_lib/den-flow";
import { getIntegrationsRoute, getMarketplaceRoute, getOrgAccessFlags } from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { useHasAnyIntegration } from "./integration-data";
import {
  type DenMarketplace,
  formatMarketplaceTimestamp,
  useCreateMarketplace,
  useMarketplaces,
} from "./marketplace-data";
import { MarketplaceLogo } from "./marketplace-logo";

export function MarketplacesScreen() {
  const { orgContext, orgSlug } = useOrgDashboard();
  const router = useRouter();
  const { data: marketplaces = [], isLoading, error } = useMarketplaces();
  const { hasAny: hasAnyIntegration, isLoading: integrationsLoading } = useHasAnyIntegration();
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const access = getOrgAccessFlags(
    orgContext?.currentMember.role ?? "member",
    orgContext?.currentMember.isOwner ?? false,
    orgContext?.roles ?? [],
  );

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!normalizedQuery) return marketplaces;
    return marketplaces.filter((marketplace) =>
      `${marketplace.name}\n${marketplace.description ?? ""}`.toLowerCase().includes(normalizedQuery),
    );
  }, [marketplaces, normalizedQuery]);

  return (
    <DashboardPageTemplate
      icon={Store}
      badgeLabel="预览"
      title="应用市场"
      description="应用市场用于集中管理插件。分配给全公司、指定成员或团队的市场，会在员工登录 SeeWayWork 后自动显示。"
      colors={["#FEF3C7", "#92400E", "#F59E0B", "#FDE68A"]}
    >
      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <div className="min-w-0 flex-1">
          <DenInput
            type="search"
            icon={Search}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索应用市场"
          />
        </div>
        {access.isAdmin ? (
          <DenButton icon={Plus} onClick={() => setCreateOpen(true)}>
            新建应用市场
          </DenButton>
        ) : null}
      </div>

      {error ? (
        <div className="mb-6 rounded-[24px] border border-red-200 bg-red-50 px-5 py-4 text-[14px] text-red-700">
          {error instanceof Error
            ? getErrorMessage(error.message, "应用市场加载失败，请重试。")
            : "应用市场加载失败，请重试。"}
        </div>
      ) : null}

      {isLoading || integrationsLoading ? (
        <div className="rounded-2xl border border-gray-100 bg-white px-6 py-10 text-[14px] text-gray-500">
          正在加载应用市场…
        </div>
      ) : !hasAnyIntegration && marketplaces.length === 0 ? (
        <ConnectIntegrationEmptyState integrationsHref={getIntegrationsRoute(orgSlug)} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={marketplaces.length === 0 ? "还没有应用市场" : "没有符合条件的应用市场"}
          description={
            marketplaces.length === 0
              ? "新建或连接一个应用市场，再将它分配给全公司、指定成员或团队。"
              : "请更换关键词，或前往插件页面查看。"
          }
          action={
            marketplaces.length === 0
              ? { href: getIntegrationsRoute(orgSlug), label: "打开数据源", icon: Cable }
              : undefined
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((marketplace) => (
            <Link
              key={marketplace.id}
              href={getMarketplaceRoute(orgSlug, marketplace.id)}
              className="group block overflow-hidden rounded-2xl border border-gray-100 bg-white transition hover:-translate-y-0.5 hover:border-gray-200 hover:shadow-[0_8px_24px_-12px_rgba(15,23,42,0.12)]"
            >
              <div className="flex items-stretch">
                <div className="relative w-[68px] shrink-0 overflow-hidden">
                  <StaticSeededGradient seed={marketplace.id} className="absolute inset-0" />
                  <div className="relative flex h-full items-center justify-center">
                    <div className="flex h-10 w-10 items-center justify-center rounded-[12px] border border-white/60 bg-white shadow-[0_8px_20px_-8px_rgba(15,23,42,0.3)]">
                      <MarketplaceLogo
                        logoUrl={marketplace.logoUrl}
                        name={marketplace.name}
                        imgClassName="h-6 w-6"
                        iconClassName="h-4 w-4"
                      />
                    </div>
                  </div>
                </div>

                <div className="min-w-0 flex-1 px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="truncate text-[14px] font-semibold tracking-[-0.01em] text-gray-900">
                      {marketplace.name}
                    </h2>
                    <span className="shrink-0 rounded-full bg-gray-50 px-2 py-0.5 text-[11px] text-gray-500">
                      {marketplace.pluginCount} 个插件
                    </span>
                  </div>
                  {marketplace.description ? (
                    <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-[1.55] text-gray-500">
                      {marketplace.description}
                    </p>
                  ) : null}
                  <p className="mt-3 text-[11.5px] text-gray-400">
                    添加于 {formatMarketplaceTimestamp(marketplace.createdAt)}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
      {access.isAdmin ? (
        <CreateMarketplaceDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={(marketplace) => {
            setCreateOpen(false);
            router.push(getMarketplaceRoute(orgSlug, marketplace.id));
          }}
        />
      ) : null}
    </DashboardPageTemplate>
  );
}

function CreateMarketplaceDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (marketplace: DenMarketplace) => void;
}) {
  const createMutation = useCreateMarketplace();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  if (!open) return null;

  const trimmedName = name.trim();

  async function submit() {
    try {
      const created = await createMutation.mutateAsync({
        name: trimmedName,
        description: description.trim() || undefined,
      });
      setName("");
      setDescription("");
      onCreated(created);
    } catch {
      // 提交错误会直接显示在对话框中。
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-marketplace-title"
        className="w-full max-w-[440px] rounded-2xl border border-gray-100 bg-white p-6 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.4)]"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="create-marketplace-title" className="text-[16px] font-semibold tracking-[-0.01em] text-gray-950">
          新建应用市场
        </h2>
        <p className="mt-1 text-[13px] leading-6 text-gray-500">
          为公司建立一个插件目录。创建后可以添加插件，并设置可使用的成员或团队。
        </p>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-[12px] font-medium text-gray-700">名称</span>
          <DenInput
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：设计团队工具"
            autoFocus
          />
        </label>
        <label className="mt-3 block">
          <span className="mb-1.5 block text-[12px] font-medium text-gray-700">说明（选填）</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="说明这里包含哪些插件"
            rows={2}
            className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-[13px] text-gray-900 outline-none transition placeholder:text-gray-300 focus:border-gray-400"
          />
        </label>

        {createMutation.error ? (
          <p className="mt-3 text-[12.5px] text-red-600">
            {createMutation.error instanceof Error
              ? getErrorMessage(createMutation.error.message, "应用市场创建失败，请重试。")
              : "应用市场创建失败，请重试。"}
          </p>
        ) : null}

        <div className="mt-5 flex items-center justify-end gap-2">
          <DenButton variant="secondary" onClick={onClose} disabled={createMutation.isPending}>
            取消
          </DenButton>
          <DenButton disabled={!trimmedName || createMutation.isPending} onClick={() => void submit()}>
            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            创建应用市场
          </DenButton>
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: { href: string; label: string; icon: React.ComponentType<{ className?: string }> };
}) {
  const ActionIcon = action?.icon;
  return (
    <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-6 py-12 text-center">
      <p className="text-[15px] font-semibold tracking-[-0.02em] text-gray-900">{title}</p>
      <p className="mx-auto mt-2 max-w-[520px] text-[13px] leading-6 text-gray-500">{description}</p>
      {action ? (
        <div className="mt-5 flex justify-center">
          <Link href={action.href} className={buttonVariants({ variant: "primary", size: "sm" })}>
            {ActionIcon ? <ActionIcon className="h-4 w-4" aria-hidden="true" /> : null}
            {action.label}
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function ConnectIntegrationEmptyState({ integrationsHref }: { integrationsHref: string }) {
  return (
    <EmptyState
      title="连接数据源以发现插件"
      description="SeeWayWork 会在已连接的代码仓库中查找插件并建立应用市场，之后可将其分配给全公司、指定成员或团队。"
      action={{ href: integrationsHref, label: "打开数据源", icon: Cable }}
    />
  );
}
