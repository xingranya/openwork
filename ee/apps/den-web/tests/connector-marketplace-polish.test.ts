import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

function readDashboardComponent(name: string) {
  return readFileSync(
    fileURLToPath(new URL(`../app/(den)/dashboard/_components/${name}`, import.meta.url)),
    "utf8",
  );
}

describe("connector and marketplace polish", () => {
  test("应用市场位于前面，公司连接入口使用中文名称", () => {
    const shell = readDashboardComponent("org-dashboard-shell.tsx");
    const marketplaceIndex = shell.indexOf('{ href: getMarketplacesRoute(activeOrg.slug), label: "应用市场" }');
    const sourcesIndex = shell.indexOf('{ href: getIntegrationsRoute(activeOrg.slug), label: "数据源" }');
    const pluginsIndex = shell.indexOf('{ href: getPluginsRoute(activeOrg.slug), label: "插件" }');
    const connectorsIndex = shell.indexOf('{ href: getMcpConnectionsRoute(activeOrg.slug), label: "MCP 连接", badge: "测试版" }');

    expect(marketplaceIndex).toBeGreaterThan(-1);
    expect(marketplaceIndex).toBeLessThan(sourcesIndex);
    expect(sourcesIndex).toBeLessThan(pluginsIndex);
    expect(pluginsIndex).toBeLessThan(connectorsIndex);
  });

  test("只保留一个添加 MCP 操作并使用确认过的连接文案", () => {
    const screen = readDashboardComponent("mcp-connections-screen.tsx");

    expect(screen).toContain('title="公司连接"');
    expect(screen).toContain('badgeLabel="测试中"');
    expect(screen).toContain('description="添加可由全体成员或指定团队使用的 MCP 服务。"');
    expect(screen).toContain("添加 MCP");
    expect(screen).not.toContain("<ImportPluginConnectionDialog");
  });

  test("adds plugins from a marketplace and carries that marketplace into the editor", () => {
    const detail = readDashboardComponent("marketplace-detail-screen.tsx");
    const editor = readDashboardComponent("plugin-editor-screen.tsx");

    expect(detail).toContain("添加插件");
    expect(detail).toContain("?marketplaceId=${encodeURIComponent(marketplace.id)}");
    expect(editor).toContain('searchParams.get("marketplaceId")');
  });

  test("reuses Quick add on the admin dashboard and opens the selected connector flow", () => {
    const home = readDashboardComponent("dashboard-home-screen.tsx");
    const overview = readDashboardComponent("dashboard-overview-screen.tsx");
    const connectorScreen = readDashboardComponent("mcp-connections-screen.tsx");

    expect(home).toContain("return access.isAdmin ? <DashboardOverviewScreen /> : <MemberDashboardScreen />");
    expect(overview).toContain("<ConnectorQuickAddGrid");
    expect(overview).toContain("?quickAdd=${encodeURIComponent(id)}");
    expect(connectorScreen).toContain('searchParams.get("quickAdd")');
  });
});
