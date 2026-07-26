import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { currentLocale, initLocale, LANGUAGES, LANGUAGE_OPTIONS, setLocale, t } from "../src/i18n";
import en from "../src/i18n/locales/en";
import zh from "../src/i18n/locales/zh";

const appearanceSource = readFileSync(
  fileURLToPath(new URL("../src/react-app/domains/settings/pages/appearance-view.tsx", import.meta.url)),
  "utf8",
);
const shellConfigSource = readFileSync(
  fileURLToPath(new URL("../src/react-app/shell/shell-config.tsx", import.meta.url)),
  "utf8",
);
const desktopPoliciesSource = readFileSync(
  fileURLToPath(new URL("../../../packages/types/src/den/desktop-policies.ts", import.meta.url)),
  "utf8",
);
const sessionRouteSource = readFileSync(
  fileURLToPath(new URL("../src/react-app/shell/session-route.tsx", import.meta.url)),
  "utf8",
);
const settingsRouteSource = readFileSync(
  fileURLToPath(new URL("../src/react-app/shell/settings-route.tsx", import.meta.url)),
  "utf8",
);
const forcedSigninSource = readFileSync(
  fileURLToPath(new URL("../src/react-app/domains/cloud/forced-signin-page.tsx", import.meta.url)),
  "utf8",
);
const i18nIndexSource = readFileSync(
  fileURLToPath(new URL("../src/i18n/index.ts", import.meta.url)),
  "utf8",
);
const baseChineseSource = readFileSync(
  fileURLToPath(new URL("../src/i18n/locales/zh.ts", import.meta.url)),
  "utf8",
);

const TECHNICAL_IDENTIFIER_ONLY_KEYS = new Set([
  "composer.mcps_label",
  "composer.skill_source",
  "mcp.auth.callback_placeholder",
  "mcp.logout_label",
  "mcp.quick_connect_context7_title",
  "mcp.quick_connect_linear_title",
  "mcp.quick_connect_notion_title",
  "mcp.quick_connect_sentry_title",
  "mcp.quick_connect_stripe_title",
  "mcp.server_command_placeholder",
  "mcp.server_name_placeholder",
  "mcp.server_url_placeholder",
  "session.permission_detail_url",
  "settings.cap_mcp",
  "settings.cap_skills",
  "settings.debug_opencode_version",
  "settings.opencode_section_label",
  "settings.workspace_config_desc",
  "welcome.organization_server_url_placeholder",
  "connect.marketplace_resource_type_mcp_one",
  "connect.marketplace_resource_type_mcp_other",
  "connect.marketplace_resource_type_skill_one",
  "connect.marketplace_resource_type_skill_other",
  "connect.row_component_mcp_one",
  "connect.row_component_mcp_other",
  "connect.row_component_skill_one",
  "connect.row_component_skill_other",
]);

describe("FoxWork 简体中文界面契约", () => {
  test("语言固定为简体中文且设置页不提供切换入口", () => {
    expect(LANGUAGES).toEqual(["zh"]);
    expect(LANGUAGE_OPTIONS.map((option) => option.value)).toEqual(["zh"]);
    expect(initLocale()).toBe("zh");
    setLocale("en");
    expect(currentLocale()).toBe("zh");
    expect(appearanceSource).not.toContain("LanguageSection");
    expect(i18nIndexSource).not.toMatch(/\.\/locales\/(?:en|ja|vi|pt-BR|th|fr|ca|es|ru)/);
  });

  test("中文资源完整覆盖界面键且占位符一致", () => {
    const englishKeys = Object.keys(en).sort();
    const missingKeys = englishKeys.filter((key) => !(key in zh));
    expect(missingKeys.slice(0, 20), `仍缺少 ${missingKeys.length} 个中文文案键`).toEqual([]);

    for (const key of englishKeys) {
      const englishPlaceholders = [...en[key as keyof typeof en].matchAll(/\{([^}]+)\}/g)]
        .map((match) => match[1])
        .sort();
      const chinesePlaceholders = [...zh[key as keyof typeof zh].matchAll(/\{([^}]+)\}/g)]
        .map((match) => match[1])
        .sort();
      expect(chinesePlaceholders, key).toEqual(englishPlaceholders);
    }
  });

  test("未知翻译键不显示内部键名", () => {
    expect(t("__foxwork_missing_translation__")).toBe("暂不可用");
  });

  test("中文资源不含英文句子或上游品牌回退", () => {
    const englishOnlyKeys = Object.entries(zh)
      .filter(([, value]) => /[A-Za-z]{2}/.test(value) && !/[\u3400-\u9fff]/.test(value))
      .map(([key]) => key)
      .filter((key) => !TECHNICAL_IDENTIFIER_ONLY_KEYS.has(key));
    const upstreamTerms = Object.entries(zh)
      .filter(([, value]) => /OpenWork|OpenCode|Big Pickle|\bCloud\b|组织/.test(value))
      .map(([key]) => key);
    const exposedRuntimeBrandKeys = Object.entries(zh)
      .filter(([, value]) => /opencode/i.test(value))
      .map(([key]) => key);

    expect(englishOnlyKeys).toEqual([]);
    expect(upstreamTerms).toEqual([]);
    expect(exposedRuntimeBrandKeys).toEqual([]);
    expect(baseChineseSource).not.toMatch(/OpenWork|OpenCode|FoxWork Cloud|\bCloud\b/);
  });

  test("单公司模式不限制新增本地或远程工作区", () => {
    expect(shellConfigSource).toContain("addWorkspace: true");
    expect(desktopPoliciesSource).toMatch(
      /id: "allowMultipleWorkspaces",[\s\S]*?defaultValue: true/,
    );
    expect(sessionRouteSource).not.toContain('restriction: "allowMultipleWorkspaces"');
    expect(settingsRouteSource).not.toContain('restriction: "allowMultipleWorkspaces"');
    expect(t("dashboard.create_local_workspace_title")).toBe("本地工作区");
    expect(t("dashboard.create_remote_workspace_title")).toBe("添加远程工作区");
  });

  test("未配置公司地址时登录入口显示中文错误而不是抛出异常", () => {
    expect(forcedSigninSource).toContain("url = buildDenAuthUrl(baseUrl, mode)");
    expect(forcedSigninSource).toContain(
      'setAuthError(toChineseUserMessage(error, t("den.error_base_url")))',
    );
  });
});
