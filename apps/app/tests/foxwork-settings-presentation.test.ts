import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

import { employeeFacingProvider } from "../src/react-app/domains/settings/pages/ai-view";
import { resolveProviderDisplayName } from "../src/app/utils";

const advancedViewSource = readFileSync(
  fileURLToPath(new URL("../src/react-app/domains/settings/pages/advanced-view.tsx", import.meta.url)),
  "utf8",
);
const mcpViewSource = readFileSync(
  fileURLToPath(new URL("../src/react-app/domains/settings/pages/mcp-view.tsx", import.meta.url)),
  "utf8",
);
const settingsRouteSource = readFileSync(
  fileURLToPath(new URL("../src/react-app/shell/settings-route.tsx", import.meta.url)),
  "utf8",
);
const sessionRouteSource = readFileSync(
  fileURLToPath(new URL("../src/react-app/shell/session-route.tsx", import.meta.url)),
  "utf8",
);
const sessionPageSource = readFileSync(
  fileURLToPath(new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url)),
  "utf8",
);
const uiStateStoreSource = readFileSync(
  fileURLToPath(new URL("../src/react-app/shell/ui-state-store.ts", import.meta.url)),
  "utf8",
);
const skillsViewSource = readFileSync(
  fileURLToPath(new URL("../src/react-app/domains/settings/pages/skills-view.tsx", import.meta.url)),
  "utf8",
);
const extensionsStoreSource = readFileSync(
  fileURLToPath(new URL("../src/react-app/domains/settings/state/extensions-store.ts", import.meta.url)),
  "utf8",
);
const foxworkChineseCopySource = readFileSync(
  fileURLToPath(new URL("../src/i18n/locales/foxwork-zh-supplement.ts", import.meta.url)),
  "utf8",
);

describe("FoxWork 设置页对外呈现", () => {
  test("bundled free model providers do not expose upstream names or ids", () => {
    expect(employeeFacingProvider({ id: "opencode", name: "OpenCode Zen" })).toEqual({
      name: "FoxWork 免费模型",
      id: null,
    });
    expect(employeeFacingProvider({ id: "opencodego", name: "OpenCode Go" })).toEqual({
      name: "FoxWork 轻量模型",
      id: null,
    });
    expect(resolveProviderDisplayName("opencode")).toBe("FoxWork 免费模型");
  });

  test("keeps normal provider labels intact", () => {
    expect(employeeFacingProvider({ id: "deepseek", name: "DeepSeek" })).toEqual({
      name: "DeepSeek",
      id: "deepseek",
    });
  });

  test("raw diagnostics are visible only in developer mode", () => {
    expect(advancedViewSource).toContain("{props.developerMode ? (");
    expect(advancedViewSource).toContain("<AdvancedCloudMcpDiagnosticsSection");
    expect(advancedViewSource).toContain("<AdvancedRuntimeMigrationSection");
  });

  test("Skills 使用独立设置页并与扩展页分开", () => {
    expect(mcpViewSource).toContain("添加 MCP 服务");
    expect(mcpViewSource).not.toContain("浏览在线技能");
    expect(mcpViewSource).not.toContain("导入本地技能");
    expect(mcpViewSource).not.toContain('"Skills（技能）"');
    expect(settingsRouteSource).toContain('case "skills":');
    expect(settingsRouteSource).toContain("<SkillsView");
    expect(settingsRouteSource).not.toContain('browseOnlineSkills={() => navigateSettingsPath("skills")}');
  });

  test("技能在会话侧栏中拥有位于扩展上方的独立入口", () => {
    const skillsButton = sessionPageSource.indexOf('title="技能"');
    const extensionsButton = sessionPageSource.indexOf('title="扩展"');

    expect(skillsButton).toBeGreaterThan(-1);
    expect(extensionsButton).toBeGreaterThan(skillsButton);
    expect(sessionPageSource).toContain('activeSidePanel === "skills" && props.skillsSlot');
    expect(sessionPageSource).toContain('activeSidePanel === "extensions" && props.extensionsSlot');
    expect(sessionRouteSource).toContain('skillsSlot={');
    expect(sessionRouteSource).toContain('initialPath="skills"');
    expect(sessionRouteSource).toContain('extensionsSlot={');
    expect(sessionRouteSource).toContain('initialPath="extensions"');
    expect(uiStateStoreSource).toContain('["panel", "skills", "extensions", "voice"]');
  });

  test("在线技能通过 Den 使用魔搭目录并在安装前执行本地安全检查", () => {
    expect(skillsViewSource).toContain('t("skills.online_title")');
    expect(skillsViewSource).toContain('t("skills.online_audit_before_install")');
    expect(extensionsStoreSource).toContain("client.listSkillsCatalog");
    expect(extensionsStoreSource).toContain("client.getSkillsCatalogAudit");
    expect(extensionsStoreSource).toContain("client.getSkillsCatalogDetail");
    expect(extensionsStoreSource).toContain("openworkClient.installCatalogSkill");
    expect(skillsViewSource).not.toContain("different-ai/openwork-hub");
    expect(foxworkChineseCopySource).toContain("魔搭技能广场");
    expect(foxworkChineseCopySource).not.toContain("skills.sh 官方目录");
  });

  test("在线技能卡片在窄侧栏中保持操作区可读", () => {
    expect(skillsViewSource).toContain(
      'className="flex min-w-0 flex-wrap items-center gap-3 border-t border-dls-border pt-4"',
    );
    expect(skillsViewSource).toContain('className={`${tagClass} shrink-0 gap-1 whitespace-nowrap`}');
    expect(skillsViewSource).toContain('className="ml-auto flex shrink-0 items-center gap-2"');
    expect(skillsViewSource).toContain(
      'className={`${installingHubSkill === skill.id ? pillSecondaryClass : pillPrimaryClass} shrink-0 whitespace-nowrap`}',
    );
    expect(skillsViewSource).toContain('aria-label={t("skills.online_view_source")}');
  });
});
