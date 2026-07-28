import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { formatPermissionLabel, formatRoleLabel } from "../app/(den)/_lib/den-org";

function readComponent(name: string) {
  return readFileSync(
    fileURLToPath(new URL(`../app/(den)/dashboard/_components/${name}`, import.meta.url)),
    "utf8",
  );
}

describe("Den 公司导航中文文案", () => {
  test("公司选择页只显示自然中文操作文案", () => {
    const source = readComponent("org-selection-screen.tsx");

    expect(source).toContain("选择公司");
    expect(source).toContain("搜索公司");
    expect(source).toContain("创建或加入公司");
    expect(source).toContain("退出登录");
    expect(source).not.toContain("Choose an organization");
    expect(source).not.toContain("Create or join");
    expect(source).not.toContain("Sign out");
  });

  test("管理员导航、页面标题和辅助说明不回退到英文", () => {
    const source = readComponent("org-dashboard-shell.tsx");

    expect(source).toContain('label: "扩展"');
    expect(source).toContain('label: "模型"');
    expect(source).toContain('label: "成员"');
    expect(source).toContain('label: "设置"');
    expect(source).toContain("问题反馈");
    expect(source).toContain("使用文档");
    expect(source).not.toContain('label: "Extensions"');
    expect(source).not.toContain('label: "Models"');
    expect(source).not.toContain('label: "Members"');
    expect(source).not.toContain('label: "Settings"');
    expect(source).not.toContain("Preparing workspace");
  });

  test("个人资料和成员状态使用 SeeWayWork 中文文案", () => {
    const profile = readComponent("user-profile-dialog.tsx");
    const member = readComponent("org-member-identity.tsx");

    expect(profile).toContain(">SeeWayWork<");
    expect(profile).toContain('title = "个人资料"');
    expect(profile).toContain("正在保存...");
    expect(member).toContain("管理员");
    expect(member).toContain("已邀请");
  });

  test("已知角色和自定义角色不会泄露内部键名", () => {
    expect(formatRoleLabel("owner")).toBe("所有者");
    expect(formatRoleLabel("member,security-admin")).toBe("成员、安全管理员");
    expect(formatRoleLabel("billing-admin")).toBe("账单管理员");
    expect(formatRoleLabel("custom-reviewer")).toBe("自定义角色");
    expect(formatRoleLabel("")).toBe("成员");
  });

  test("成员、团队和角色管理页不显示英文操作或权限键名", () => {
    const source = readComponent("manage-members-screen.tsx");

    expect(source).toContain('title="成员管理"');
    expect(source).toContain('label: "添加成员"');
    expect(source).toContain('label: "创建团队"');
    expect(source).toContain('label: "添加角色"');
    expect(source).not.toContain('title="Members"');
    expect(source).not.toContain("Copy invite link");
    expect(source).not.toContain("Read only");
    expect(formatPermissionLabel("organization")).toBe("公司");
    expect(formatPermissionLabel("security_configuration")).toBe("安全设置");
    expect(formatPermissionLabel("update")).toBe("修改");
    expect(formatPermissionLabel("unknown")).toBe("其他权限");
  });
});
