import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { t } from "../src/i18n";
import { ExtensionCard } from "../src/react-app/design-system/extension-card";
import { SettingsBetaBadge } from "../src/react-app/domains/settings/shell/settings-page";

describe("公司连接测试标签", () => {
  test("导航、介绍和连接卡片统一显示中文测试状态", () => {
    const badge = renderToStaticMarkup(<SettingsBetaBadge />);
    const card = renderToStaticMarkup(
      <ExtensionCard name="Team connection" description="Shared through OpenWork Connect" beta />,
    );

    expect(badge).toContain(">测试中<");
    expect(card).toContain(">测试中<");
    expect(t("connect.pitch_body")).toBe("请联系公司管理员启用公司能力。");
  });
});
