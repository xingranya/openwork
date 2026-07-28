"use client";

import { type ElementType, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Circle,
  Link,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  Send,
  Settings,
  Shield,
  Trash2,
  User,
  Users,
} from "lucide-react";
import {
  DEN_ROLE_PERMISSION_OPTIONS,
  canRefreshInvitationRole,
  formatPermissionLabel,
  formatRoleLabel,
  getJoinOrgRoute,
  getOrgAccessFlags,
  isAssignableOrgRole,
  getMembersRoute,
  splitRoleString,
  type DenOrgMember,
} from "../../_lib/den-org";
import { type OrgLimitError, type OrgPaymentRequiredError, getOrgLimitError, getOrgPaymentRequiredError } from "../../_lib/den-flow";
import { buildDenFeedbackUrl } from "../../_lib/feedback";
import { OrgLimitDialog } from "../../_components/org-limit-dialog";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { UnderlineTabs } from "../../_components/ui/tabs";
import { DashboardPageTemplate } from "../../_components/ui/dashboard-page-template";
import { DenButton } from "../../_components/ui/button";
import { DenCard } from "../../_components/ui/card";
import { DenInput } from "../../_components/ui/input";
import { DenNotice } from "../../_components/ui/notice";
import { DenSelect } from "../../_components/ui/select";
import { createOrganizationInstallLink } from "../../_lib/install-link-data";
import { OrgMemberIdentity } from "./org-member-identity";

type MembersTab = "members" | "teams" | "roles";

function clonePermissionRecord(value: Record<string, string[]>) {
  return Object.fromEntries(
    Object.entries(value).map(([resource, actions]) => [
      resource,
      [...actions],
    ]),
  );
}

function toggleAction(
  value: Record<string, string[]>,
  resource: string,
  action: string,
  enabled: boolean,
) {
  const next = clonePermissionRecord(value);
  const current = new Set(next[resource] ?? []);

  if (enabled) {
    current.add(action);
  } else {
    current.delete(action);
  }

  next[resource] = [...current];
  return next;
}

function ActionButton({
  children,
  tone = "default",
  size = "sm",
  icon,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  tone?: "default" | "danger";
  size?: "md" | "sm";
  icon?: ElementType<{ size?: number; className?: string }>;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <DenButton
      variant={tone === "danger" ? "destructive" : "secondary"}
      size={size}
      icon={icon}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </DenButton>
  );
}

function SummaryCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "dark";
}) {
  return (
    <div
      className={`rounded-[24px] border px-5 py-4 ${tone === "dark" ? "border-[#0f172a] bg-[#0f172a] text-white" : "border-gray-200 bg-white text-gray-900"}`}
    >
      <p
        className={`text-[12px] font-semibold uppercase tracking-[0.16em] ${tone === "dark" ? "text-white/60" : "text-gray-400"}`}
      >
        {label}
      </p>
      <p className="mt-3 text-[24px] font-semibold tracking-[-0.05em]">
        {value}
      </p>
    </div>
  );
}

export function ManageMembersScreen() {
  const {
    activeOrg,
    orgContext,
    orgBusy,
    orgError,
    mutationBusy,
    inviteMember,
    startSeatCheckout,
    cancelInvitation,
    updateMemberRole,
    removeMember,
    transferOwnership,
    createTeam,
    updateTeam,
    deleteTeam,
    createRole,
    updateRole,
    deleteRole,
    runReauthableAction,
  } = useOrgDashboard();
  const [activeTab, setActiveTab] = useState<MembersTab>("members");
  const [pageError, setPageError] = useState<string | null>(null);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [openMemberMenuId, setOpenMemberMenuId] = useState<string | null>(null);
  const [memberRoleDraft, setMemberRoleDraft] = useState("member");
  const [editingMemberTeamsId, setEditingMemberTeamsId] = useState<string | null>(null);
  const [memberTeamsDraft, setMemberTeamsDraft] = useState<Set<string>>(new Set());
  const [showTeamForm, setShowTeamForm] = useState(false);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [teamNameDraft, setTeamNameDraft] = useState("");
  const [teamMemberDraft, setTeamMemberDraft] = useState<string[]>([]);
  const [showRoleForm, setShowRoleForm] = useState(false);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [roleNameDraft, setRoleNameDraft] = useState("");
  const [rolePermissionDraft, setRolePermissionDraft] = useState<
    Record<string, string[]>
  >({});
  const [limitDialogError, setLimitDialogError] = useState<OrgLimitError | null>(null);
  const [seatBillingDialogError, setSeatBillingDialogError] = useState<OrgPaymentRequiredError | null>(null);
  const [installLinkBusy, setInstallLinkBusy] = useState(false);
  const [installLinkCopied, setInstallLinkCopied] = useState(false);
  const [installLinkShareUrl, setInstallLinkShareUrl] = useState<string | null>(null);
  const [installLinkShareCopied, setInstallLinkShareCopied] = useState(false);

  const assignableRoles = useMemo(
    () => (orgContext?.roles ?? []).filter(isAssignableOrgRole),
    [orgContext?.roles],
  );

  const access = useMemo(
    () =>
      getOrgAccessFlags(
        orgContext?.currentMember.role ?? "member",
        orgContext?.currentMember.isOwner ?? false,
        orgContext?.roles,
      ),
    [orgContext?.currentMember.isOwner, orgContext?.currentMember.role, orgContext?.roles],
  );
  const canStartSeatCheckout = access.canStartSeatCheckout;

  const tabCounts: Record<MembersTab, number> = {
    members: orgContext?.members.length ?? 0,
    teams: orgContext?.teams.length ?? 0,
    roles: orgContext?.roles.length ?? 0,
  };

  const teamMemberNames = useMemo(() => {
    const membersById = new Map(
      (orgContext?.members ?? []).map((member) => [
        member.id,
        member.user.name,
      ]),
    );
    return new Map(
      (orgContext?.teams ?? []).map((team) => [
        team.id,
        team.memberIds
          .map((memberId) => membersById.get(memberId))
          .filter((value): value is string => Boolean(value)),
      ]),
    );
  }, [orgContext?.members, orgContext?.teams]);

  const invitationsById = useMemo(
    () => new Map((orgContext?.invitations ?? []).map((invitation) => [invitation.id, invitation])),
    [orgContext?.invitations],
  );

  const feedbackHref = useMemo(
    () =>
      buildDenFeedbackUrl({
        pathname: activeOrg ? getMembersRoute(activeOrg.slug) : "/organization",
        orgSlug: activeOrg?.slug ?? null,
        topic: "workspace-limits",
      }),
    [activeOrg],
  );

  function resetInviteForm() {
    setInviteEmail("");
    setInviteRole(access.canManageRoles ? assignableRoles[0]?.role ?? "member" : "member");
    setShowInviteForm(false);
  }

  function resetMemberEditor() {
    setEditingMemberId(null);
    setMemberRoleDraft(access.canManageRoles ? assignableRoles[0]?.role ?? "member" : "member");
  }

  function resetTeamEditor() {
    setEditingTeamId(null);
    setTeamNameDraft("");
    setTeamMemberDraft([]);
    setShowTeamForm(false);
  }

  function resetRoleEditor() {
    setEditingRoleId(null);
    setRoleNameDraft("");
    setRolePermissionDraft({});
    setShowRoleForm(false);
  }

  function selectInstallLinkShareInput() {
    const input = document.getElementById("install-link-share-url");
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.select();
    }
  }

  async function handleInstallLinkShareCopy() {
    if (!installLinkShareUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(installLinkShareUrl);
      setInstallLinkShareCopied(true);
      window.setTimeout(() => setInstallLinkShareCopied(false), 1800);
    } catch {
      selectInstallLinkShareInput();
    }
  }

  async function handleCopyInstallLink() {
    if (!activeOrg) {
      return;
    }

    let mintedInstallPageUrl: string | null = null;
    setPageError(null);
    setInstallLinkCopied(false);
    setInstallLinkShareUrl(null);
    setInstallLinkShareCopied(false);
    setInstallLinkBusy(true);
    try {
      await runReauthableAction("copy-install-link", async () => {
        mintedInstallPageUrl = await createOrganizationInstallLink(activeOrg.id);
      });

      if (!mintedInstallPageUrl) {
        throw new Error("公司服务没有返回完整的安装链接。");
      }

      // 剪贴板写入放在重验队列之外：重验后的重试没有临时用户激活，
      // 部分浏览器也会直接拒绝程序写入。链接已经生成成功，因此写入失败时
      // 改为展示链接供员工手动复制，不暴露浏览器底层错误。
      try {
        await navigator.clipboard.writeText(mintedInstallPageUrl);
        setInstallLinkCopied(true);
        window.setTimeout(() => setInstallLinkCopied(false), 1800);
      } catch {
        setInstallLinkShareUrl(mintedInstallPageUrl);
      }
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "无法复制安装链接。");
    } finally {
      setInstallLinkBusy(false);
    }
  }

  async function handleTransferOwnership(member: DenOrgMember) {
    const targetName = member.user.name || member.user.email;
    const confirmed = window.confirm(
      `确定把公司所有权转交给 ${targetName} 吗？转交后，${targetName} 将成为唯一所有者，你的账号将变为超级管理员。`,
    );
    if (!confirmed) {
      return;
    }

    setPageError(null);
    try {
      await transferOwnership(member.id);
      setOpenMemberMenuId(null);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "无法转交公司所有权。");
    }
  }

  useEffect(() => {
    if (!access.canManageRoles) {
      setInviteRole("member");
      setMemberRoleDraft("member");
      return;
    }

    if (!assignableRoles[0]) {
      return;
    }

    setInviteRole((current) =>
      assignableRoles.some((role) => role.role === current)
        ? current
        : assignableRoles[0].role,
    );
    setMemberRoleDraft((current) =>
      assignableRoles.some((role) => role.role === current)
        ? current
        : assignableRoles[0].role,
    );
  }, [access.canManageRoles, assignableRoles]);

  if (orgBusy && !orgContext) {
    return (
      <div className="mx-auto max-w-[1200px] px-6 py-8 md:px-8">
        <div className="rounded-[28px] border border-gray-200 bg-white px-6 py-10 text-[15px] text-gray-500">
          正在加载公司成员信息...
        </div>
      </div>
    );
  }

  if (!orgContext || !activeOrg) {
    return (
      <div className="mx-auto max-w-[1200px] px-6 py-8 md:px-8">
        <div className="rounded-[28px] border border-red-200 bg-red-50 px-6 py-4 text-[15px] text-red-700">
          {orgError ?? "暂时无法获取公司成员信息。"}
        </div>
      </div>
    );
  }

  const inviteForm =
    showInviteForm && access.canInviteMembers ? (
      <DenCard className="mb-6">
        <form
          className={`grid gap-4 lg:items-end ${access.canManageRoles ? "lg:grid-cols-[minmax(0,1.4fr)_220px_auto]" : "lg:grid-cols-[minmax(0,1fr)_220px_auto]"}`}
          onSubmit={async (event) => {
            event.preventDefault();
            setPageError(null);
            try {
              await inviteMember({ email: inviteEmail, role: access.canManageRoles ? inviteRole : "member" });
              resetInviteForm();
            } catch (error) {
              const paymentRequiredError = getOrgPaymentRequiredError(error);
              if (paymentRequiredError) {
                setSeatBillingDialogError(paymentRequiredError);
                return;
              }

              const limitError = getOrgLimitError(error);
              if (limitError) {
                setLimitDialogError(limitError);
                return;
              }

              setPageError(
                error instanceof Error
                  ? error.message
                  : "无法邀请成员。",
              );
            }
          }}
        >
          <label className="grid gap-3">
            <span className="text-[14px] font-medium text-gray-700">邮箱</span>
            <DenInput
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="name@company.com"
              required
            />
          </label>
          <label className="grid gap-3">
            <span className="text-[14px] font-medium text-gray-700">角色</span>
            <DenSelect value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}>
              {assignableRoles.map((role) => (
                <option key={role.id} value={role.role}>
                  {formatRoleLabel(role.role)}
                </option>
              ))}
            </DenSelect>
          </label>
          <div className="flex gap-2 lg:justify-end">
            <ActionButton size="md" onClick={resetInviteForm}>取消</ActionButton>
            <DenButton type="submit" loading={mutationBusy === "invite-member"}>
              发送邀请
            </DenButton>
          </div>
        </form>
      </DenCard>
    ) : null;

  const editMemberForm =
    editingMemberId && access.canManageRoles ? (
      <DenCard className="mb-6">
        <form
          className="grid gap-4 lg:grid-cols-[240px_auto] lg:items-end"
          onSubmit={async (event) => {
            event.preventDefault();
            setPageError(null);
            try {
              await updateMemberRole(editingMemberId, memberRoleDraft);
              resetMemberEditor();
            } catch (error) {
              setPageError(
                error instanceof Error
                  ? error.message
                  : "无法更新成员角色。",
              );
            }
          }}
        >
          <label className="grid gap-3">
            <span className="text-[14px] font-medium text-gray-700">角色</span>
            <DenSelect value={memberRoleDraft} onChange={(event) => setMemberRoleDraft(event.target.value)}>
              {assignableRoles.map((role) => (
                <option key={role.id} value={role.role}>
                  {formatRoleLabel(role.role)}
                </option>
              ))}
            </DenSelect>
          </label>
          <div className="flex gap-2 lg:justify-end">
            <ActionButton size="md" onClick={resetMemberEditor}>取消</ActionButton>
            <DenButton type="submit" loading={mutationBusy === "update-member-role"}>
              保存成员
            </DenButton>
          </div>
        </form>
      </DenCard>
    ) : null;

  const teamForm =
    (showTeamForm || editingTeamId) && access.canManageTeams ? (
      <DenCard className="mb-6">
        <form
          className="grid gap-6"
          onSubmit={async (event) => {
            event.preventDefault();
            setPageError(null);
            try {
              if (editingTeamId) {
                await updateTeam(editingTeamId, {
                  name: teamNameDraft,
                  memberIds: teamMemberDraft,
                });
              } else {
                await createTeam({
                  name: teamNameDraft,
                  memberIds: teamMemberDraft,
                });
              }
              resetTeamEditor();
            } catch (error) {
              setPageError(
                error instanceof Error ? error.message : "无法保存团队。",
              );
            }
          }}
        >
          <label className="grid gap-3 lg:max-w-[420px]">
            <span className="text-[14px] font-medium text-gray-700">
              团队名称
            </span>
            <DenInput
              type="text"
              value={teamNameDraft}
              onChange={(event) => setTeamNameDraft(event.target.value)}
              placeholder="例如：品牌组"
              required
            />
          </label>

          <div>
            <p className="mb-3 text-[14px] font-medium text-gray-700">
              团队成员
            </p>
            {orgContext.members.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-gray-200 bg-gray-50 px-5 py-6 text-[14px] text-gray-500">
                请先邀请成员，再将成员加入这个团队。
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {orgContext.members.map((member) => {
                  const selected = teamMemberDraft.includes(member.id);
                  return (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => {
                        setTeamMemberDraft((current) =>
                          current.includes(member.id)
                            ? current.filter((entry) => entry !== member.id)
                            : [...current, member.id],
                        );
                      }}
                      className={`flex items-start gap-3 rounded-[22px] border px-4 py-4 text-left transition ${
                        selected
                          ? "border-[#0f172a] bg-[#0f172a] text-white"
                          : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
                      }`}
                    >
                      {selected ? (
                        <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0" />
                      ) : (
                        <Circle className="mt-0.5 h-6 w-6 shrink-0 text-gray-300" />
                      )}
                      <OrgMemberIdentity member={member} inverted={selected} />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <ActionButton size="md" onClick={resetTeamEditor}>取消</ActionButton>
            <DenButton
              type="submit"
              loading={mutationBusy === "create-team" || mutationBusy === "update-team"}
            >
              {editingTeamId ? "保存团队" : "创建团队"}
            </DenButton>
          </div>
        </form>
      </DenCard>
    ) : null;

  const roleForm =
    (showRoleForm || editingRoleId) && access.canManageRoles ? (
      <DenCard className="mb-6">
        <form
          className="grid gap-6"
          onSubmit={async (event) => {
            event.preventDefault();
            setPageError(null);
            try {
              if (editingRoleId) {
                await updateRole(editingRoleId, {
                  roleName: roleNameDraft,
                  permission: rolePermissionDraft,
                });
              } else {
                await createRole({
                  roleName: roleNameDraft,
                  permission: rolePermissionDraft,
                });
              }
              resetRoleEditor();
            } catch (error) {
              setPageError(
                error instanceof Error ? error.message : "无法保存角色。",
              );
            }
          }}
        >
          <label className="grid gap-3 lg:max-w-[420px]">
            <span className="text-[14px] font-medium text-gray-700">
              角色名称
            </span>
            <DenInput
              type="text"
              value={roleNameDraft}
              onChange={(event) => setRoleNameDraft(event.target.value)}
              placeholder="例如：内容审核"
              required
            />
          </label>

          <div className="grid gap-4 xl:grid-cols-3">
            {Object.entries(DEN_ROLE_PERMISSION_OPTIONS).map(
              ([resource, actions]) => (
                <div
                  key={resource}
                  className="rounded-[24px] border border-gray-200 bg-[#f8fafc] p-4"
                >
                  <p className="mb-3 text-[15px] font-semibold text-gray-900">
                    {formatPermissionLabel(resource)}
                  </p>
                  <div className="grid gap-2">
                    {actions.map((action) => {
                      const checked = (
                        rolePermissionDraft[resource] ?? []
                      ).includes(action);
                      return (
                        <label
                          key={`${resource}-${action}`}
                          className="inline-flex items-center gap-2 text-[14px] text-gray-600"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) =>
                              setRolePermissionDraft((current) =>
                                toggleAction(
                                  current,
                                  resource,
                                  action,
                                  event.target.checked,
                                ),
                              )
                            }
                          />
                          <span>{formatPermissionLabel(action)}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ),
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <ActionButton size="md" onClick={resetRoleEditor}>取消</ActionButton>
            <DenButton
              type="submit"
              loading={mutationBusy === "create-role" || mutationBusy === "update-role"}
            >
              {editingRoleId ? "保存角色" : "创建角色"}
            </DenButton>
          </div>
        </form>
      </DenCard>
    ) : null;

  const toolbarAction = (() => {
    if (activeTab === "members" && access.canInviteMembers) {
      return {
        label: "添加成员",
        onClick: () => {
          resetMemberEditor();
          setShowInviteForm((current) => !current);
        },
      };
    }
    if (activeTab === "teams" && access.canManageTeams) {
      return {
        label: "创建团队",
        onClick: () => {
          resetTeamEditor();
          setShowTeamForm((current) => !current);
        },
      };
    }
    if (activeTab === "roles" && access.canManageRoles) {
      return {
        label: "添加角色",
        onClick: () => {
          setShowRoleForm((current) => !current);
          setEditingRoleId(null);
          setRoleNameDraft("");
          setRolePermissionDraft({});
        },
      };
    }
    return null;
  })();

  return (
    <DashboardPageTemplate
      icon={Users}
      title="成员管理"
      description="邀请成员、设置团队和角色，并管理公司访问权限。"
      colors={["#F3EEFF", "#4A1D96", "#7C3AED", "#C4B5FD"]}
    >
      <OrgLimitDialog
        open={Boolean(limitDialogError)}
        title={limitDialogError?.limitType === "members" ? "成员名额已用完" : "远程工作区名额已用完"}
        message={limitDialogError?.limitType === "members" ? "当前方案不能再添加成员。" : "当前方案不能再添加远程工作区。"}
        detail={
          limitDialogError
            ? `已使用 ${limitDialogError.currentCount}/${limitDialogError.limit} 个${limitDialogError.limitType === "members" ? "成员名额" : "远程工作区名额"}。`
            : null
        }
        feedbackHref={feedbackHref}
        onClose={() => setLimitDialogError(null)}
      />
      <OrgLimitDialog
        open={Boolean(seatBillingDialogError)}
        eyebrow="席位计费"
        title="订阅后可添加更多成员"
        message="公司前 5 名成员免费，超出后每名成员每月收费 10 美元。"
        detail={canStartSeatCheckout ? null : "只有公司所有者可以开通订阅。"}
        closeLabel="取消"
        actionLabel="开通订阅"
        actionLoading={mutationBusy === "seat-checkout"}
        actionDisabled={!canStartSeatCheckout}
        onClose={() => setSeatBillingDialogError(null)}
        onAction={() => {
          if (!canStartSeatCheckout) {
            return;
          }
          void startSeatCheckout().catch((error) => {
            setPageError(error instanceof Error ? error.message : "无法打开订阅页面。");
          });
        }}
      />

      {pageError ? (
        <DenNotice message={pageError} className="mb-6" />
      ) : null}

      <UnderlineTabs
        className="mb-6"
        activeTab={activeTab}
        onChange={setActiveTab}
        tabs={[
          { value: "members", label: "成员", icon: User, count: tabCounts.members },
          { value: "teams", label: "团队", icon: Users, count: tabCounts.teams },
          { value: "roles", label: "角色", icon: Shield, count: tabCounts.roles },
        ]}
      />

      {activeTab === "members" ? inviteForm : null}
      {activeTab === "members" ? editMemberForm : null}
      {activeTab === "teams" ? teamForm : null}
      {activeTab === "roles" ? roleForm : null}

      {activeTab === "members" ? (
        <div>
          <div className="mb-6 flex items-center justify-between gap-4">
            <p className="text-[15px] text-gray-400">
              {access.canManageMembers
                ? "邀请成员、调整角色，或移除不再需要访问公司服务的成员。"
                : access.canRemoveMembers
                  ? "邀请成员，或移除公司所有者以外的成员。"
                : "查看公司成员及其当前角色。"}
            </p>
            {toolbarAction ? (
              <div className="flex flex-wrap justify-end gap-2">
                {orgContext.capabilities.installLinks ? (
                  <DenButton
                    data-testid="copy-install-link"
                    variant="secondary"
                    icon={Link}
                    onClick={() => void handleCopyInstallLink()}
                    loading={installLinkBusy || mutationBusy === "copy-install-link"}
                  >
                    {installLinkCopied ? "已复制" : "复制安装链接"}
                  </DenButton>
                ) : null}
                <DenButton icon={Plus} onClick={toolbarAction.onClick}>
                  {toolbarAction.label}
                </DenButton>
              </div>
            ) : null}
          </div>

          {installLinkShareUrl ? (
            <div className="mb-6 rounded-[24px] border border-gray-200 bg-white px-5 py-4">
              <p className="text-[13px] text-gray-500">
                浏览器未允许自动复制，请手动复制下面的链接：
              </p>
              <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center">
                <DenInput
                  id="install-link-share-url"
                  data-testid="install-link-share-url"
                  value={installLinkShareUrl}
                  readOnly
                  aria-label="安装链接"
                  className="font-mono text-[12px]"
                  onFocus={(event) => event.currentTarget.select()}
                  onClick={(event) => event.currentTarget.select()}
                />
                <div className="flex shrink-0 gap-2">
                  <DenButton
                    data-testid="install-link-share-copy"
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleInstallLinkShareCopy()}
                  >
                    {installLinkShareCopied ? "已复制" : "复制"}
                  </DenButton>
                  <DenButton
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setInstallLinkShareUrl(null);
                      setInstallLinkShareCopied(false);
                    }}
                  >
                    完成
                  </DenButton>
                </div>
              </div>
            </div>
          ) : null}

          <div className="overflow-visible rounded-2xl border border-gray-100 bg-white">
            <div className="grid grid-cols-[minmax(0,1fr)_180px_140px_160px] gap-4 border-b border-gray-100 px-6 py-3 text-[11px] font-medium uppercase tracking-wide text-gray-400">
              <span>成员</span>
              <span>角色</span>
              <span>加入时间</span>
              <span />
            </div>

            {orgContext.members.map((member) => {
              const isInvited = !member.joinedAt;
              const inviteId = member.inviteId;
              const inviteToken = inviteId ? invitationsById.get(inviteId)?.inviteToken : null;
              const memberAccess = getOrgAccessFlags(member.role, member.isOwner, orgContext.roles);
              const canResendInvitation = isInvited && canRefreshInvitationRole(member.role, access);
              const canTransferOwnershipToMember = access.canTransferOwnership && !isInvited && memberAccess.isSuperAdmin;
              const canOpenActions = member.isOwner
                ? false
                : isInvited
                  ? canResendInvitation || access.canCancelInvitations
                  : access.canManageRoles || access.canManageTeams || access.canRemoveMembers || canTransferOwnershipToMember;

              return (
                <div key={member.id}>
                <div
                  className="grid grid-cols-[minmax(0,1fr)_180px_140px_160px] items-center gap-4 border-b border-gray-100 px-6 py-3.5 transition hover:bg-gray-50/60 last:border-b-0"
                >
                  <OrgMemberIdentity member={member} />
                  <span className="text-[13px] text-gray-500">
                    {splitRoleString(member.role).map(formatRoleLabel).join(", ")}
                  </span>
                  <span className="text-[13px] text-gray-400">
                    {member.joinedAt
                      ? new Date(member.joinedAt).toLocaleDateString("zh-CN")
                      : "等待加入"}
                  </span>
                  <div className="relative flex items-center justify-end gap-2">
                    {member.isOwner ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-[12px] text-gray-400">
                        <Lock className="h-3 w-3" />
                        已锁定
                      </span>
                    ) : canOpenActions ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setOpenMemberMenuId((current) => current === member.id ? null : member.id)}
                          className="rounded-full p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
                          aria-label={`打开 ${member.user.name} 的操作菜单`}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                        {openMemberMenuId === member.id ? (
                          <div className="absolute right-0 top-9 z-10 w-44 overflow-hidden rounded-2xl border border-gray-100 bg-white p-1.5 text-[13px] shadow-xl shadow-gray-900/10">
                            {isInvited && inviteToken ? (
                              <button
                                type="button"
                                onClick={async () => {
                                  const inviteUrl = new URL(getJoinOrgRoute(inviteToken), window.location.origin).toString();
                                  await navigator.clipboard.writeText(inviteUrl);
                                  setOpenMemberMenuId(null);
                                }}
                                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-gray-600 transition hover:bg-gray-50"
                              >
                                <Link className="h-3.5 w-3.5" />
                                复制邀请链接
                              </button>
                            ) : null}
                            {canResendInvitation ? (
                              <button
                                type="button"
                                onClick={async () => {
                                  setPageError(null);
                                  try {
                                    await inviteMember({ email: member.user.email, role: member.role });
                                    setOpenMemberMenuId(null);
                                  } catch (error) {
                                    setPageError(error instanceof Error ? error.message : "无法重新发送邀请。");
                                  }
                                }}
                                disabled={mutationBusy === "invite-member"}
                                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <Send className="h-3.5 w-3.5" />
                                重新发送邀请
                              </button>
                            ) : null}
                            {isInvited && access.canCancelInvitations && inviteId ? (
                              <button
                                type="button"
                                onClick={async () => {
                                  setPageError(null);
                                  try {
                                    await cancelInvitation(inviteId);
                                    setOpenMemberMenuId(null);
                                  } catch (error) {
                                    setPageError(error instanceof Error ? error.message : "无法取消邀请。");
                                  }
                                }}
                                disabled={mutationBusy === "cancel-invitation"}
                                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                取消邀请
                              </button>
                            ) : null}
                            {!isInvited && access.canManageRoles ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingMemberId(member.id);
                                  setMemberRoleDraft(member.role);
                                  setShowInviteForm(false);
                                  setOpenMemberMenuId(null);
                                }}
                                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-gray-600 transition hover:bg-gray-50"
                              >
                                <Settings className="h-3.5 w-3.5" />
                                修改角色
                              </button>
                            ) : null}
                            {canTransferOwnershipToMember ? (
                              <button
                                type="button"
                                onClick={() => void handleTransferOwnership(member)}
                                disabled={mutationBusy === "transfer-ownership"}
                                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <Shield className="h-3.5 w-3.5" />
                                转交所有权
                              </button>
                            ) : null}
                            {!isInvited && access.canManageTeams ? (
                              <button
                                type="button"
                                onClick={() => {
                                  const currentTeamIds = new Set(
                                    (orgContext?.teams ?? [])
                                      .filter((team) => team.memberIds.includes(member.id))
                                      .map((team) => team.id),
                                  );
                                  setEditingMemberTeamsId(member.id);
                                  setMemberTeamsDraft(currentTeamIds);
                                  setOpenMemberMenuId(null);
                                }}
                                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-gray-600 transition hover:bg-gray-50"
                              >
                                <Users className="h-3.5 w-3.5" />
                                管理团队
                              </button>
                            ) : null}
                            {!isInvited && access.canRemoveMembers ? (
                              <button
                                type="button"
                                onClick={async () => {
                                  setPageError(null);
                                  try {
                                    await removeMember(member.id);
                                    if (editingMemberId === member.id) {
                                      resetMemberEditor();
                                    }
                                    setOpenMemberMenuId(null);
                                  } catch (error) {
                                    setPageError(error instanceof Error ? error.message : "无法移除成员。");
                                  }
                                }}
                                disabled={mutationBusy === "remove-member"}
                                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                移除成员
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-[13px] text-gray-400">只读</span>
                    )}
                  </div>
                </div>
                {editingMemberTeamsId === member.id ? (
                  <div className="col-span-full border-b border-gray-100 bg-gray-50/50 px-6 py-4">
                    <div className="flex flex-wrap items-start gap-4">
                      <div className="flex-1">
                        <p className="mb-2 text-[12px] font-medium uppercase tracking-wide text-gray-400">
                          {member.user.name} 所在的团队
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {(orgContext?.teams ?? []).map((team) => {
                            const selected = memberTeamsDraft.has(team.id);
                            return (
                              <button
                                key={team.id}
                                type="button"
                                onClick={() => {
                                  setMemberTeamsDraft((current) => {
                                    const next = new Set(current);
                                    if (next.has(team.id)) {
                                      next.delete(team.id);
                                    } else {
                                      next.add(team.id);
                                    }
                                    return next;
                                  });
                                }}
                                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition ${selected ? "border-blue-300 bg-blue-50 text-blue-700" : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"}`}
                              >
                                {selected ? (
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                ) : (
                                  <Circle className="h-3.5 w-3.5" />
                                )}
                                {team.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 pt-5">
                        <button
                          type="button"
                          onClick={() => setEditingMemberTeamsId(null)}
                          className="inline-flex h-8 items-center rounded-full border border-gray-200 bg-white px-3.5 text-[13px] font-medium text-gray-600 transition hover:bg-gray-50"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          disabled={mutationBusy === "update-team"}
                          onClick={async () => {
                            setPageError(null);
                            try {
                              // 逐个更新团队成员列表，确保该成员的团队归属与当前选择一致。
                              for (const team of orgContext?.teams ?? []) {
                                const wasInTeam = team.memberIds.includes(member.id);
                                const shouldBeInTeam = memberTeamsDraft.has(team.id);
                                if (wasInTeam === shouldBeInTeam) continue;
                                const nextMemberIds = shouldBeInTeam
                                  ? [...team.memberIds, member.id]
                                  : team.memberIds.filter((id) => id !== member.id);
                                await updateTeam(team.id, { memberIds: nextMemberIds });
                              }
                              setEditingMemberTeamsId(null);
                            } catch (error) {
                              setPageError(error instanceof Error ? error.message : "无法更新团队归属。");
                            }
                          }}
                          className="inline-flex h-8 items-center rounded-full bg-gray-900 px-3.5 text-[13px] font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          保存团队
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {activeTab === "teams" ? (
        <div>
          <div className="mb-6 flex items-center justify-between gap-4">
            <p className="text-[15px] text-gray-400">管理公司内的团队及其成员。</p>
            {toolbarAction ? (
              <DenButton icon={Plus} onClick={toolbarAction.onClick}>
                {toolbarAction.label}
              </DenButton>
            ) : null}
          </div>

          <div className="overflow-x-auto overflow-y-visible rounded-2xl border border-gray-100 bg-white">
            <div className="grid grid-cols-[minmax(0,1fr)_160px_200px] gap-4 border-b border-gray-100 px-6 py-3 text-[11px] font-medium uppercase tracking-wide text-gray-400">
              <span>团队</span>
              <span>成员数</span>
              <span />
            </div>

            {orgContext.teams.length === 0 ? (
              <div className="px-6 py-8 text-center text-[13px] text-gray-400">
                暂无团队。
              </div>
            ) : (
              orgContext.teams.map((team) => (
                <div
                  key={team.id}
                  className="grid grid-cols-[minmax(0,1fr)_160px_200px] items-center gap-4 border-b border-gray-100 px-6 py-3.5 transition hover:bg-gray-50/60 last:border-b-0"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium text-gray-900">
                        {team.name}
                      </span>
                      {team.managedByScim ? (
                        <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-700">
                          由 SCIM 管理
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-[12px] text-gray-400">
                      {teamMemberNames.get(team.id)?.slice(0, 3).join(", ") ||
                        "尚未分配成员"}
                      {(teamMemberNames.get(team.id)?.length ?? 0) > 3
                        ? ` +${(teamMemberNames.get(team.id)?.length ?? 0) - 3}`
                        : ""}
                    </p>
                  </div>
                  <span className="text-[13px] text-gray-400">{`${team.memberIds.length} 名成员`}</span>
                  <div className="flex items-center justify-end gap-3">
                    {team.managedByScim ? (
                      <span className="text-[12px] font-medium text-cyan-700">由身份服务统一管理</span>
                    ) : access.canManageTeams ? (
                      <>
                        <ActionButton
                          icon={Pencil}
                          onClick={() => {
                            setShowTeamForm(false);
                            setEditingTeamId(team.id);
                            setTeamNameDraft(team.name);
                            setTeamMemberDraft(team.memberIds);
                          }}
                        >
                          编辑
                        </ActionButton>
                        <ActionButton
                          tone="danger"
                          icon={Trash2}
                          disabled={mutationBusy === "delete-team"}
                          onClick={async () => {
                            setPageError(null);
                            try {
                              await deleteTeam(team.id);
                              if (editingTeamId === team.id) {
                                resetTeamEditor();
                              }
                            } catch (error) {
                              setPageError(
                                error instanceof Error
                                  ? error.message
                                  : "无法删除团队。",
                              );
                            }
                          }}
                        >
                          {mutationBusy === "delete-team" ? "正在删除..." : "删除"}
                        </ActionButton>
                      </>
                    ) : (
                      <span className="text-[13px] text-gray-400">
                        只读
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}

      {activeTab === "roles" ? (
        <div>
          <div className="mb-6 flex items-center justify-between gap-4">
            <p className="text-[15px] text-gray-400">
              {access.canManageRoles
                ? "系统角色会一直保留，公司所有者可以添加、修改或删除自定义角色。"
                : "你可以查看角色定义，但只有公司所有者可以修改。"}
            </p>
            {toolbarAction ? (
              <DenButton icon={Plus} onClick={toolbarAction.onClick}>
                {toolbarAction.label}
              </DenButton>
            ) : null}
          </div>

          <div className="overflow-x-auto overflow-y-visible rounded-2xl border border-gray-100 bg-white">
            <div className="grid grid-cols-[minmax(0,1fr)_120px_200px] gap-4 border-b border-gray-100 px-6 py-3 text-[11px] font-medium uppercase tracking-wide text-gray-400">
              <span>角色</span>
              <span>类型</span>
              <span />
            </div>

            {orgContext.roles.map((role) => (
              <div
                key={role.id}
                className="grid grid-cols-[minmax(0,1fr)_120px_200px] items-center gap-4 border-b border-gray-100 px-6 py-3.5 transition hover:bg-gray-50/60 last:border-b-0"
              >
                <span className="text-[13px] font-medium text-gray-900">
                  {formatRoleLabel(role.role)}
                </span>
                <span className="text-[13px] text-gray-400">
                  {role.protected
                    ? "系统角色"
                    : role.builtIn
                      ? "默认角色"
                      : "自定义角色"}
                </span>
                <div className="flex items-center justify-end gap-3">
                  {access.canManageRoles && !role.protected ? (
                    <>
                      <ActionButton
                        icon={Pencil}
                        onClick={() => {
                          setShowRoleForm(false);
                          setEditingRoleId(role.id);
                          setRoleNameDraft(role.role);
                          setRolePermissionDraft(
                            clonePermissionRecord(role.permission),
                          );
                        }}
                      >
                        编辑
                      </ActionButton>
                      <ActionButton
                        tone="danger"
                        icon={Trash2}
                        disabled={mutationBusy === "delete-role"}
                        onClick={async () => {
                          setPageError(null);
                          try {
                            await deleteRole(role.id);
                            if (editingRoleId === role.id) {
                              resetRoleEditor();
                            }
                          } catch (error) {
                            setPageError(
                              error instanceof Error
                                ? error.message
                                : "无法删除角色。",
                            );
                          }
                        }}
                      >
                        {mutationBusy === "delete-role" ? "正在删除..." : "删除"}
                      </ActionButton>
                    </>
                  ) : (
                    <span className="text-[13px] text-gray-400">只读</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </DashboardPageTemplate>
  );
}
