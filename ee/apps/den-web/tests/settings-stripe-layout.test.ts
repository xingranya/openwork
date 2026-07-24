import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

function read(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("Den settings destinations", () => {
  test("exposes Brand appearance and Stripe as distinct Settings entries", () => {
    const shell = read("../app/(den)/dashboard/_components/org-dashboard-shell.tsx");
    const routes = read("../app/(den)/_lib/den-org.ts");

    expect(routes).toContain('return `${getOrgDashboardRoute(orgSlug)}/brand-appearance`');
    expect(shell).toContain('label: "品牌外观"');
    expect(shell).toContain('label: "Stripe 账单"');
  });

  test("账单页保留唯一刷新入口并明确显示加载和错误状态", () => {
    const billing = read("../app/(den)/dashboard/_components/billing-dashboard-screen.tsx");
    const refreshLabels = billing.match(/>刷新<\/DenButton>/g) ?? [];

    expect(billing).toContain('data-testid="stripe-billing-screen"');
    expect(billing).toContain('title="Stripe 账单"');
    expect(billing).toContain("正在加载 Stripe 账单详情...");
    expect(billing).toContain("无法加载 Stripe 账单详情");
    expect(billing).toContain("公司前 {seatBilling?.freeSeatCount} 位成员");
    expect(refreshLabels).toHaveLength(1);
  });

  test("无权限时使用完整状态页而不是裸跳转文案", () => {
    const accessLayout = read("../app/(den)/dashboard/(admin)/layout.tsx");

    expect(accessLayout).toContain('data-testid="admin-access-state"');
    expect(accessLayout).toContain("公司服务已就绪");
    expect(accessLayout).not.toContain("正在跳转到管理首页...");
  });
});
