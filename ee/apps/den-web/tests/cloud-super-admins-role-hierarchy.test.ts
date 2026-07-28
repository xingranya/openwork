import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import {
  canRefreshInvitationRole,
  getOrgAccessFlags,
  isAssignableOrgRole,
  roleIncludesCanonicalRole,
  type DenOrgRole,
} from "../app/(den)/_lib/den-org";

function read(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function orgRole(role: string, protectedRole = false, builtIn = true): DenOrgRole {
  return {
    id: role,
    role,
    permission: {},
    builtIn,
    protected: protectedRole,
    createdAt: null,
    updatedAt: null,
  };
}

describe("cloud super-admin role hierarchy", () => {
  test("derives canonical access flags without collapsing custom role strings", () => {
    const owner = getOrgAccessFlags("member", true);
    expect(owner.canonicalRole).toBe("owner");
    expect(owner.isAdmin).toBe(true);
    expect(owner.isSuperAdmin).toBe(false);
    expect(owner.canManageSettings).toBe(true);
    expect(owner.canManageRoles).toBe(true);
    expect(owner.canTransferOwnership).toBe(true);

    const superAdmin = getOrgAccessFlags("qa-reviewer, super-admin", false);
    expect(superAdmin.canonicalRole).toBe("super-admin");
    expect(superAdmin.isAdmin).toBe(true);
    expect(superAdmin.canManageSettings).toBe(true);
    expect(superAdmin.canManageRoles).toBe(true);
    expect(superAdmin.canTransferOwnership).toBe(false);
    expect(roleIncludesCanonicalRole("qa-reviewer, super-admin", "super-admin")).toBe(true);

    const admin = getOrgAccessFlags("admin, qa-reviewer", false);
    expect(admin.canonicalRole).toBe("admin");
    expect(admin.isAdmin).toBe(true);
    expect(admin.canViewSettings).toBe(true);
    expect(admin.canManageSettings).toBe(false);
    expect(admin.canManageRoles).toBe(false);
    expect(admin.canInviteMembers).toBe(true);
    expect(admin.canRemoveMembers).toBe(true);
    expect(admin.canStartSeatCheckout).toBe(true);

    const custom = getOrgAccessFlags("qa-reviewer", false);
    expect(custom.canonicalRole).toBe("member");
    expect(custom.isAdmin).toBe(false);
    expect(custom.canViewSettings).toBe(false);
  });

  test("keeps owner unassignable while allowing super-admin, admin, member, and custom roles", () => {
    expect(isAssignableOrgRole(orgRole("owner"))).toBe(false);
    expect(isAssignableOrgRole(orgRole("owner", true))).toBe(false);
    expect(isAssignableOrgRole(orgRole("super-admin", true))).toBe(true);
    expect(isAssignableOrgRole(orgRole("admin", true))).toBe(true);
    expect(isAssignableOrgRole(orgRole("member", true))).toBe(true);
    expect(isAssignableOrgRole(orgRole("qa-reviewer", false, false))).toBe(true);
    expect(isAssignableOrgRole(orgRole("qa-reviewer", true, false))).toBe(false);
  });

  test("allows admin invitation refresh only for pending member roles", () => {
    const admin = getOrgAccessFlags("admin", false);
    const superAdmin = getOrgAccessFlags("super-admin", false);

    expect(canRefreshInvitationRole("member", admin)).toBe(true);
    expect(canRefreshInvitationRole("admin", admin)).toBe(false);
    expect(canRefreshInvitationRole("super-admin", admin)).toBe(false);
    expect(canRefreshInvitationRole("qa-reviewer", admin)).toBe(false);
    expect(canRefreshInvitationRole("qa-reviewer", superAdmin)).toBe(true);
  });

  test("管理员侧栏提供完整的中文管理入口", () => {
    const shell = read("../app/(den)/dashboard/_components/org-dashboard-shell.tsx");

    for (const label of ["扩展", "应用市场", "数据源", "插件", "MCP 连接", "模型", "平台模型", "模型服务商", "成员", "使用统计", "设置"]) {
      expect(shell).toContain(`label: "${label}"`);
    }

    for (const label of ["常规", "连接诊断", "品牌外观", "桌面策略", "Stripe 账单", "API 密钥", "单点登录（SSO）", "用户同步（SCIM）"]) {
      expect(shell).toContain(`label: "${label}"`);
    }

    expect(shell).toContain("access.canViewSettings");
    expect(shell).toContain("access.isAdmin && activeOrg");
  });

  test("keeps admins read-only across Settings while super-admins inherit mutation flags", () => {
    const orgSettings = read("../app/(den)/dashboard/_components/org-settings-screen.tsx");
    const diagnostics = read("../app/(den)/dashboard/_components/diagnostics-screen.tsx");
    const diagnosticCard = read("../app/(den)/dashboard/_components/egress-diagnostics-card.tsx");
    const brand = read("../app/(den)/dashboard/_components/brand-appearance-screen.tsx");
    const desktopPolicies = read("../app/(den)/dashboard/_components/desktop-policies-screen.tsx");
    const desktopPolicyEditor = read("../app/(den)/dashboard/_components/desktop-policy-editor-screen.tsx");
    const billing = read("../app/(den)/dashboard/_components/billing-dashboard-screen.tsx");
    const apiKeys = read("../app/(den)/dashboard/_components/api-keys-screen.tsx");
    const sso = read("../app/(den)/dashboard/_components/sso-screen.tsx");
    const scim = read("../app/(den)/dashboard/_components/scim-screen.tsx");

    expect(getOrgAccessFlags("super-admin", false).canManageSettings).toBe(true);
    expect(getOrgAccessFlags("admin", false).canManageSettings).toBe(false);
    expect(orgSettings).toContain("const canManageSettings = access.canManageSettings");
    expect(orgSettings).toContain("管理员可以查看设置，只有公司所有者和超级管理员可以修改。");
    expect(orgSettings).toContain("disabled={!canManageDesktopVersions || requiresServerUpgrade}");
    expect(diagnostics).toContain("canView={access.canViewSettings} canManage={access.canManageSettings}");
    expect(diagnosticCard).toContain("disabled={!canManage || loading || !available}");
    expect(diagnosticCard).toContain("只有公司所有者和超级管理员可以运行此诊断。");
    expect(brand).toContain("const canManageBrandAppearance = access.canManageSettings");
    expect(brand).toContain("disabled={!canManageBrandAppearance}");
    expect(desktopPolicies).toContain("const canManage = access.canManageSettings");
    expect(desktopPolicies).toContain("disabled={deleting}");
    expect(desktopPolicyEditor).toContain("const formDisabled = saving || togglingEnabled || !canManage");
    expect(desktopPolicyEditor).toContain("disabled={saving || !canManage}");
    expect(billing).toContain("const canManageBillingSettings = access.canManageSettings");
    expect(billing).toContain("disabled={!canManageBillingSettings}");
    expect(apiKeys).toContain("!access.canViewSettings");
    expect(apiKeys).toContain("!access.canManageApiKeys");
    expect(apiKeys).toContain("disabled={!access.canManageApiKeys || deletingId === apiKey.id}");
    expect(sso).toContain("!access.canViewSettings");
    expect(sso).toContain("!access.canManageSso");
    expect(sso).toContain("disabled={ssoFormDisabled}");
    expect(sso).toContain("客户端密钥");
    expect(scim).toContain("!access.canViewSettings");
    expect(scim).toContain("!access.canManageScim");
    expect(scim).toContain("disabled={!access.canManageScim || !connection}");
  });

  test("supports owner-only transfer to active super-admin members", () => {
    const provider = read("../app/(den)/dashboard/_providers/org-dashboard-provider.tsx");
    const members = read("../app/(den)/dashboard/_components/manage-members-screen.tsx");

    expect(provider).toContain("transferOwnership: (memberId: string) => Promise<void>");
    expect(provider).toContain("/transfer-ownership`");
    expect(provider).toContain("targetAccess.isSuperAdmin");
    expect(provider).toContain("只有公司所有者可以转交所有权。");
    expect(members).toContain("canTransferOwnershipToMember = access.canTransferOwnership && !isInvited && memberAccess.isSuperAdmin");
    expect(members).toContain("将成为唯一所有者，你的账号将变为超级管理员");
    expect(members).toContain('mutationBusy === "transfer-ownership"');
  });
});
