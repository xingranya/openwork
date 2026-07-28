"use client";

import { Check, Copy, Pencil, SlidersHorizontal, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getErrorMessage, requestJson } from "../../_lib/den-flow";
import {
  getAllowedDesktopVersionsFromMetadata,
  getOrgAccessFlags,
  getRequireSsoFromMetadata,
} from "../../_lib/den-org";
import { DashboardPageTemplate } from "../../_components/ui/dashboard-page-template";
import { DenButton } from "../../_components/ui/button";
import { DenCard } from "../../_components/ui/card";
import { DenInput } from "../../_components/ui/input";
import { DenTextarea } from "../../_components/ui/textarea";
import { DenNotice } from "../../_components/ui/notice";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { EnterprisePlanNotice } from "./enterprise-plan-notice";
import {
  allPublishedDesktopVersionsAllowed,
  compareDesktopVersions,
  getDesktopVersionMetadata,
  initialAllowedDesktopVersions,
} from "./desktop-version-options";

function normalizeAllowedEmailDomainsInput(value: string): string[] | null {
  const domains = [
    ...new Set(
      value
        .split(/[\s,]+/)
        .map((entry) => entry.trim().toLowerCase().replace(/^@+/, ""))
        .filter(Boolean),
    ),
  ];

  return domains.length > 0 ? domains : null;
}

function toggleAllowedDesktopVersion(
  current: string[],
  version: string,
  checked: boolean,
) {
  if (checked) {
    return current.includes(version) ? current : [...current, version];
  }

  return current.filter((entry) => entry !== version);
}

function SettingsToggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (nextValue: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        "relative inline-flex h-7 w-12 items-center rounded-full border transition-colors",
        checked
          ? "border-[#0f172a] bg-[#0f172a]"
          : "border-gray-200 bg-gray-200",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
      ].join(" ")}
    >
      <span
        aria-hidden="true"
        className={[
          "inline-block h-5 w-5 rounded-full bg-white transition-transform",
          checked ? "translate-x-6" : "translate-x-1",
        ].join(" ")}
      />
    </button>
  );
}

function DeleteOrganizationDialog({
  open,
  organizationName,
  confirmationName,
  busy,
  error,
  onConfirmationNameChange,
  onClose,
  onConfirm,
}: {
  open: boolean;
  organizationName: string;
  confirmationName: string;
  busy: boolean;
  error: string | null;
  onConfirmationNameChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open) {
    return null;
  }

  const confirmed = confirmationName === organizationName;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmed || busy) {
      return;
    }

    onConfirm();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6"
      onClick={busy ? undefined : onClose}
    >
      <form
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-organization-title"
        aria-describedby="delete-organization-description"
        className="w-full max-w-md rounded-[28px] border border-gray-200 bg-white p-6 shadow-[0_24px_80px_-32px_rgba(15,23,42,0.45)]"
        onClick={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
            <Trash2 className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="delete-organization-title" className="text-[18px] font-semibold tracking-[-0.02em] text-gray-950">
              Delete {organizationName}?
            </h2>
            <p id="delete-organization-description" className="mt-1 text-[13px] leading-6 text-gray-600">
              Type the organization name to permanently delete it.
            </p>
          </div>
        </div>

        <label className="mt-5 grid gap-2">
          <span className="text-[12px] font-medium text-gray-700">
            Organization name
          </span>
          <DenInput
            value={confirmationName}
            onChange={(event) => onConfirmationNameChange(event.target.value)}
            placeholder={organizationName}
            disabled={busy}
            autoFocus
          />
        </label>

        {error ? (
          <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-[12.5px] text-red-600" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DenButton variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </DenButton>
          <DenButton
            type="submit"
            variant="destructive"
            icon={Trash2}
            loading={busy}
            disabled={!confirmed}
          >
            {busy ? "Deleting..." : "Delete organization"}
          </DenButton>
        </div>
      </form>
    </div>
  );
}

export function OrgSettingsScreen() {
  const {
    activeOrg,
    orgContext,
    orgBusy,
    orgError,
    mutationBusy,
    orgSettingsCompletion,
    clearOrgSettingsCompletion,
    updateOrganizationSettings,
    deleteOrganization,
    refreshOrgData,
  } = useOrgDashboard();
  const [orgNameDraft, setOrgNameDraft] = useState("");
  const [allowedDomainsDraft, setAllowedDomainsDraft] = useState("");
  const [domainRestrictionsEnabled, setDomainRestrictionsEnabled] =
    useState(false);
  const [requireSsoEnabled, setRequireSsoEnabled] = useState(false);
  const [domainEditModeEnabled, setDomainEditModeEnabled] = useState(false);
  const [desktopVersionOptions, setDesktopVersionOptions] = useState<string[]>(
    [],
  );
  const [desktopVersionRange, setDesktopVersionRange] = useState<{
    minVersion: string;
    maxVersion: string;
  } | null>(null);
  const [allowedDesktopVersionsDraft, setAllowedDesktopVersionsDraft] =
    useState<string[]>([]);
  const [desktopVersionOptionsBusy, setDesktopVersionOptionsBusy] =
    useState(false);
  const [desktopVersionOptionsError, setDesktopVersionOptionsError] = useState<
    string | null
  >(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [copiedOrgId, setCopiedOrgId] = useState(false);
  const [denVersion, setDenVersion] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmationName, setDeleteConfirmationName] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const currentAllowedDomains =
    orgContext?.organization.allowedEmailDomains ?? null;
  const access = getOrgAccessFlags(
    orgContext?.currentMember.role ?? "member",
    orgContext?.currentMember.isOwner ?? false,
    orgContext?.roles,
  );
  const canManageSettings = access.canManageSettings;
  const canManageDesktopVersions = access.canManageSettings;
  const canDeleteOrganization = access.canDeleteOrganization;
  const draftAllowedDomains = useMemo(
    () => normalizeAllowedEmailDomainsInput(allowedDomainsDraft),
    [allowedDomainsDraft],
  );
  const hasDraftDomains = (draftAllowedDomains?.length ?? 0) > 0;
  const supportedDesktopVersionOptions = useMemo(
    () =>
      desktopVersionRange
        ? desktopVersionOptions.filter(
            (version) =>
              compareDesktopVersions(version, desktopVersionRange.maxVersion) <= 0,
          )
        : [],
    [desktopVersionOptions, desktopVersionRange],
  );
  const selectedDesktopVersions = useMemo(
    () => new Set(allowedDesktopVersionsDraft),
    [allowedDesktopVersionsDraft],
  );
  const allDesktopVersionsAllowed = allPublishedDesktopVersionsAllowed({
    draftVersions: allowedDesktopVersionsDraft,
    publishedVersions: supportedDesktopVersionOptions,
  });
  const pageSuccess = orgSettingsCompletion?.message ?? null;

  useEffect(() => {
    let cancelled = false;

    void requestJson("/health", { method: "GET" }, 5000)
      .then(({ response, payload }) => {
        const version = Object.getOwnPropertyDescriptor(payload ?? {}, "version")?.value;
        if (!cancelled && response.ok && typeof version === "string" && version.trim()) {
          setDenVersion(version.trim());
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!orgContext) {
      return;
    }

    setOrgNameDraft(orgContext.organization.name);
    setAllowedDomainsDraft(
      (orgContext.organization.allowedEmailDomains ?? []).join("\n"),
    );
    setDomainRestrictionsEnabled(
      (orgContext.organization.allowedEmailDomains?.length ?? 0) > 0,
    );
    setRequireSsoEnabled(getRequireSsoFromMetadata(orgContext.organization.metadata));
    setDomainEditModeEnabled(false);
  }, [orgContext]);

  useEffect(() => {
    let cancelled = false;

    async function loadDesktopVersionOptions() {
      setDesktopVersionOptionsBusy(true);
      setDesktopVersionOptionsError(null);

      try {
        const { response, payload } = await requestJson(
          "/v1/app-version",
          { method: "GET" },
          12000,
        );

        if (!response.ok) {
          throw new Error(
            getErrorMessage(
              payload,
              `加载 FoxWork 版本信息失败（${response.status}）。`,
            ),
          );
        }

        const metadata = getDesktopVersionMetadata(payload);
        if (!metadata) {
          throw new Error("FoxWork 版本信息不完整。");
        }

        if (cancelled) {
          return;
        }

        setDesktopVersionOptions(metadata.publishedDesktopVersions);
        setDesktopVersionRange({
          minVersion: metadata.minAppVersion,
          maxVersion: metadata.latestAppVersion,
        });
      } catch (error) {
        if (!cancelled) {
          setDesktopVersionOptions([]);
          setDesktopVersionRange(null);
          setDesktopVersionOptionsError(getErrorMessage(error, "加载 FoxWork 版本失败。"));
        }
      } finally {
        if (!cancelled) {
          setDesktopVersionOptionsBusy(false);
        }
      }
    }

    void loadDesktopVersionOptions();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!orgContext || supportedDesktopVersionOptions.length === 0) {
      return;
    }

    setAllowedDesktopVersionsDraft(initialAllowedDesktopVersions(
      getAllowedDesktopVersionsFromMetadata(orgContext.organization.metadata),
      supportedDesktopVersionOptions,
    ).filter((version) => supportedDesktopVersionOptions.includes(version)));
  }, [orgContext, supportedDesktopVersionOptions]);

  useEffect(() => {
    if (!copiedOrgId) {
      return;
    }

    const timeout = window.setTimeout(() => setCopiedOrgId(false), 1600);
    return () => window.clearTimeout(timeout);
  }, [copiedOrgId]);

  const createdAtLabel = useMemo(() => {
    if (!orgContext?.organization.createdAt) {
      return "暂无日期";
    }

    return new Date(orgContext.organization.createdAt).toLocaleDateString("zh-CN");
  }, [orgContext?.organization.createdAt]);

  if (orgBusy && !orgContext) {
    return (
      <div className="mx-auto max-w-[860px] p-8">
        <div className="rounded-[28px] border border-gray-200 bg-white px-6 py-10 text-[15px] text-gray-500">
          正在加载公司设置...
        </div>
      </div>
    );
  }

  if (!activeOrg || !orgContext) {
    return (
      <div className="mx-auto max-w-[860px] p-8">
        <div className="rounded-[28px] border border-red-200 bg-red-50 px-6 py-10 text-[15px] text-red-700">
          {getErrorMessage(orgError, "暂时无法加载公司设置。")}
        </div>
      </div>
    );
  }

  const organizationId = orgContext.organization.id;
  const organizationName = orgContext.organization.name;

  async function handleCopyOrgId() {
    await navigator.clipboard.writeText(organizationId);
    setCopiedOrgId(true);
  }

  function handleDomainRestrictionToggle(nextValue: boolean) {
    if (!canManageSettings) {
      return;
    }

    if (!nextValue && hasDraftDomains) {
      return;
    }

    setPageError(null);
    clearOrgSettingsCompletion();
    setDomainRestrictionsEnabled(nextValue);
    setDomainEditModeEnabled(nextValue && !currentAllowedDomains?.length);
  }

  async function handleSaveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPageError(null);
    clearOrgSettingsCompletion();

    if (!canManageSettings) {
      setPageError("Only workspace owners and super-admins can change settings.");
      return;
    }

    try {
      await updateOrganizationSettings({
        name: orgNameDraft,
        allowedEmailDomains: domainRestrictionsEnabled
          ? draftAllowedDomains
          : null,
        requireSso: requireSsoEnabled,
        ...(supportedDesktopVersionOptions.length > 0
          ? {
              allowedDesktopVersions: allDesktopVersionsAllowed
                ? null
                : supportedDesktopVersionOptions.filter((version) =>
                    selectedDesktopVersions.has(version),
                  ),
            }
          : {}),
      });
      setDomainEditModeEnabled(false);
    } catch (error) {
      setPageError(getErrorMessage(error, "更新公司设置失败，请重试。"));
    }
  }

  function openDeleteDialog() {
    setPageError(null);
    clearOrgSettingsCompletion();
    setDeleteConfirmationName("");
    setDeleteError(null);
    setDeleteDialogOpen(true);
  }

  function closeDeleteDialog() {
    setDeleteDialogOpen(false);
    setDeleteConfirmationName("");
    setDeleteError(null);
  }

  async function handleDeleteOrganization() {
    if (deleteConfirmationName !== organizationName) {
      return;
    }

    setPageError(null);
    clearOrgSettingsCompletion();
    setDeleteError(null);

    try {
      await deleteOrganization();
      closeDeleteDialog();
      await refreshOrgData();
    } catch (error) {
      setDeleteError(
        error instanceof Error
          ? error.message
          : "Could not delete organization.",
      );
    }
  }

  return (
    <DashboardPageTemplate
      icon={SlidersHorizontal}
      title="公司设置"
      description={(
        <span className="flex w-full items-baseline justify-between gap-4">
          <span>管理公司身份、访问规则、登录方式和客户端版本。</span>
          {denVersion ? (
            <span
              className="font-normal tabular-nums text-gray-300"
              data-den-runtime-version={denVersion}
              title={`公司服务版本 ${denVersion}`}
            >
              公司服务 {denVersion}
            </span>
          ) : null}
        </span>
      )}
      colors={["#D9F99D", "#0F172A", "#0F766E", "#FDE68A"]}
    >
      {orgContext && !orgContext.entitlements.orgControls ? (
        <EnterprisePlanNotice feature="强制 SSO 和桌面版本控制" />
      ) : null}
      {pageError ? (
        <DenNotice message={pageError} className="mb-6" />
      ) : null}
      {pageSuccess ? (
        <div className="mb-6 rounded-[24px] border border-emerald-200 bg-emerald-50 px-5 py-4 text-[14px] text-emerald-700">
          {pageSuccess}
        </div>
      ) : null}

      <form className="grid min-w-0 grid-cols-1 gap-6" onSubmit={handleSaveSettings}>
        <DenCard size="spacious" className="grid gap-6">
          <div className="grid gap-2">
            <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-gray-400">
              基础信息
            </p>
            <h2 className="text-[24px] font-semibold tracking-[-0.04em] text-gray-900">
              公司身份
            </h2>
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
            <label className="grid gap-3">
              <span className="text-[14px] font-medium text-gray-700">
                公司名称
              </span>
              <DenInput
                type="text"
                value={orgNameDraft}
                onChange={(event) => setOrgNameDraft(event.target.value)}
                minLength={2}
                maxLength={120}
                disabled={!canManageSettings}
                required
              />
            </label>

            <div className="grid gap-3">
              <span className="text-[14px] font-medium text-gray-700">ID</span>
              <div className="flex gap-2">
                <DenInput
                  value={organizationId}
                  readOnly
                  aria-label="公司 ID"
                  className="font-mono text-[13px]"
                />
                <DenButton
                  variant="secondary"
                  type="button"
                  icon={copiedOrgId ? Check : Copy}
                  onClick={() => void handleCopyOrgId()}
                >
                  {copiedOrgId ? "已复制" : "复制"}
                </DenButton>
              </div>
            </div>
          </div>
        </DenCard>

        <DenCard size="spacious" className="grid gap-6">
          <div className="flex items-start justify-between gap-4">
            <div className="grid gap-2">
              <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                加入规则
              </p>
              <h2 className="text-[24px] font-semibold tracking-[-0.04em] text-gray-900">
                允许的邮箱域名
              </h2>
              <p className="text-[14px] text-gray-500">
                只允许使用指定邮箱域名的员工加入公司。
              </p>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <span className="text-[13px] font-medium text-gray-500">
                {domainRestrictionsEnabled ? "已开启" : "已关闭"}
              </span>
              <SettingsToggle
                label="限制允许加入的邮箱域名"
                checked={domainRestrictionsEnabled}
                disabled={
                  !canManageSettings || (domainRestrictionsEnabled && hasDraftDomains)
                }
                onChange={handleDomainRestrictionToggle}
              />
            </div>
          </div>

          {domainRestrictionsEnabled && domainEditModeEnabled ? (
            <label className="grid gap-3">
              <span className="text-[14px] font-medium text-gray-700">
                域名允许列表
              </span>
              <span className="text-[10px] text-gray-500">
                每行填写一个域名，也可以使用逗号分隔
              </span>
              <DenTextarea
                value={allowedDomainsDraft}
                onChange={(event) => setAllowedDomainsDraft(event.target.value)}
                rows={6}
                disabled={!canManageSettings}
                placeholder={"company.com\npartner.org"}
              />
            </label>
          ) : null}

          {domainRestrictionsEnabled && !domainEditModeEnabled ? (
            <div className="grid gap-3 rounded-[24px] border border-dashed border-gray-200 bg-gray-50 px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                {currentAllowedDomains && currentAllowedDomains.length > 0 ? (
                  <div className="flex flex-wrap w-full gap-2">
                    {currentAllowedDomains.map((domain) => (
                      <span
                        key={domain}
                        className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[13px] text-gray-700"
                      >
                        {domain}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-[14px] text-gray-600">
                    尚未配置邮箱域名。
                  </p>
                )}
                {canManageSettings ? (
                  <DenButton
                    type="button"
                    size="sm"
                    variant="secondary"
                    icon={Pencil}
                    onClick={() => {
                      setPageError(null);
                      clearOrgSettingsCompletion();
                      setDomainEditModeEnabled(true);
                    }}
                  >
                    编辑
                  </DenButton>
                ) : null}
              </div>
            </div>
          ) : null}
        </DenCard>

        <DenCard size="spacious" className="grid gap-6">
          <div className="grid gap-2">
            <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-gray-400">
              身份认证
            </p>
            <h2 className="text-[24px] font-semibold tracking-[-0.04em] text-gray-900">
              单点登录要求
            </h2>
            <p className="text-[14px] text-gray-500">
              当员工邮箱域名匹配公司设置时，要求使用公司的单点登录入口。
            </p>
          </div>

          <div className="flex items-start justify-between gap-4 rounded-[24px] border border-gray-200 bg-white px-5 py-4">
            <div className="grid gap-1 pr-4">
              <p className="text-[15px] font-medium text-gray-900">匹配公司域名时强制使用 SSO</p>
              <p className="text-[13px] text-gray-500">
                使用匹配邮箱域名的员工通过邮箱和密码登录时，会自动转到公司 SSO 流程。
              </p>
            </div>
            <SettingsToggle
              label="公司强制使用 SSO"
              checked={requireSsoEnabled}
              disabled={!canManageSettings}
              onChange={setRequireSsoEnabled}
            />
          </div>
        </DenCard>

        <DenCard size="spacious" className="grid gap-6">
          <div className="grid gap-2">
            <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-gray-400">
              FoxWork 客户端
            </p>
            <h2 className="text-[24px] font-semibold tracking-[-0.04em] text-gray-900">
              允许登录的 FoxWork 版本
            </h2>
            <p className="text-[14px] text-gray-500">
              选择可以登录公司服务的 FoxWork 版本。
            </p>
            {desktopVersionRange ? (
              <p className="text-[10px] text-gray-400">
                当前公司服务支持 FoxWork v{desktopVersionRange.minVersion} 至 v{desktopVersionRange.maxVersion}。
              </p>
            ) : null}
          </div>

          {desktopVersionOptionsBusy ? (
            <div className="rounded-[24px] border border-dashed border-gray-200 bg-gray-50 px-5 py-4 text-[14px] text-gray-500">
              正在加载 FoxWork 版本...
            </div>
          ) : null}

          {desktopVersionOptionsError ? (
            <div className="rounded-[24px] border border-amber-200 bg-amber-50 px-5 py-4 text-[14px] text-amber-800">
              {desktopVersionOptionsError}
            </div>
          ) : null}

          {!desktopVersionOptionsBusy &&
          !desktopVersionOptionsError &&
          desktopVersionOptions.length > 0 ? (
            <div className="grid gap-4">
              <div
                data-testid="desktop-version-list"
                className="grid max-h-[400px] gap-3 overflow-y-auto pr-2"
              >
                {desktopVersionOptions.map((version) => {
                  const checked = selectedDesktopVersions.has(version);
                  const requiresServerUpgrade =
                    desktopVersionRange !== null &&
                    compareDesktopVersions(
                      version,
                      desktopVersionRange.maxVersion,
                    ) > 0;

                  return (
                    <label
                      key={version}
                      data-desktop-version={version}
                      data-supported={!requiresServerUpgrade}
                      className={[
                        "flex items-center justify-between gap-4 rounded-[24px] border px-5 py-4",
                        requiresServerUpgrade
                          ? "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400"
                          : "border-gray-200 bg-white",
                      ].join(" ")}
                    >
                      <div className="grid gap-1">
                        <p
                          className={[
                            "text-[15px] font-medium",
                            requiresServerUpgrade
                              ? "text-gray-400"
                              : "text-gray-900",
                          ].join(" ")}
                        >
                          v{version}
                        </p>
                        {requiresServerUpgrade ? (
                          <p className="text-[12px] text-gray-400">
                            升级公司服务后才能允许此版本
                          </p>
                        ) : null}
                      </div>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!canManageDesktopVersions || requiresServerUpgrade}
                        aria-label={`允许 FoxWork v${version} 登录`}
                        onChange={(event) =>
                          setAllowedDesktopVersionsDraft((current) =>
                            toggleAllowedDesktopVersion(
                              current,
                              version,
                              event.target.checked,
                            ),
                          )
                        }
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}
        </DenCard>

        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-gray-500">
            {!isOwner && canManageDesktopVersions
              ? "管理员可以修改允许登录的 FoxWork 版本，其他设置需要公司所有者操作。"
              : !isOwner
                ? "只有公司所有者和管理员可以修改这些设置。"
                : null}
          </p>
          {access.isAdmin ? (
            <DenButton
              type="submit"
              loading={mutationBusy === "update-organization-settings"}
            >
              保存设置
            </DenButton>
          ) : null}
        </div>
      </form>

      {canDeleteOrganization ? (
        <DenCard size="spacious" className="mt-6 grid gap-5 !border-red-200 bg-red-50/30">
          <div className="grid gap-2">
            <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-red-400">
              Owner controls
            </p>
            <h2 className="text-[24px] font-semibold tracking-[-0.04em] text-red-950">
              Danger zone
            </h2>
            <p className="max-w-2xl text-[14px] leading-6 text-red-700">
              Permanently delete this organization, including members, teams, workers, plugins, and connections. This cannot be undone.
            </p>
          </div>
          <div>
            <DenButton
              type="button"
              variant="destructive"
              icon={Trash2}
              onClick={openDeleteDialog}
            >
              Delete organization
            </DenButton>
          </div>
        </DenCard>
      ) : null}

      <DeleteOrganizationDialog
        open={deleteDialogOpen}
        organizationName={organizationName}
        confirmationName={deleteConfirmationName}
        busy={mutationBusy === "delete-organization"}
        error={deleteError}
        onConfirmationNameChange={setDeleteConfirmationName}
        onClose={closeDeleteDialog}
        onConfirm={() => void handleDeleteOrganization()}
      />
    </DashboardPageTemplate>
  );
}
