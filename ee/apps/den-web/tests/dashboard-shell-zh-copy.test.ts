import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { formatRoleLabel } from "../app/(den)/_lib/den-org";

function readComponent(name: string) {
  return readFileSync(
    fileURLToPath(new URL(`../app/(den)/dashboard/_components/${name}`, import.meta.url)),
    "utf8",
  );
}

describe("Den 工作区导航中文文案", () => {
  test("工作区选择页只显示自然中文操作文案", () => {
    const source = readComponent("org-selection-screen.tsx");

    expect(source).toContain("选择公司工作区");
    expect(source).toContain("搜索工作区");
    expect(source).toContain("创建或加入工作区");
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

  test("个人资料和成员状态使用 FoxWork 中文文案", () => {
    const profile = readComponent("user-profile-dialog.tsx");
    const member = readComponent("org-member-identity.tsx");

    expect(profile).toContain(">FoxWork<");
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
});
