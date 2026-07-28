import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("FoxWork 公司服务地址契约", () => {
  test("客户端运行路径不回退到 OpenWork 公网服务", () => {
    const constants = source("../src/app/constants.ts");
    const accountStatusMenu = source("../src/react-app/domains/session/sidebar/account-status-menu.tsx");
    const settingsRoute = source("../src/react-app/shell/settings-route.tsx");
    const feedback = source("../src/app/lib/feedback.ts");

    expect(constants).not.toContain("https://app.openworklabs.com/api/den/mcp/agent");
    expect(accountStatusMenu).not.toContain("https://openworklabs.com/docs");
    expect(accountStatusMenu).toContain("FOXWORK_DOCS_URL");
    expect(settingsRoute).not.toContain("https://github.com/different-ai/openwork/issues");
    expect(feedback).not.toContain("https://openworklabs.com/feedback");
  });

  test("界面控制桥接优先发现 FoxWork 发行路径并兼容旧安装", () => {
    const detail = source("../src/react-app/design-system/extension-detail-modal.tsx");
    const wrapper = source("../../../packages/openwork-ui-mcp/index.mjs");

    expect(detail).toContain("com.foxwork.desktop/openwork-ui-control.json");
    expect(detail).toContain("com.foxwork.desktop.dev/openwork-ui-control.json");
    expect(detail).not.toContain("Application Support/com.differentai.openwork");

    const foxworkIndex = wrapper.indexOf('"com.foxwork.desktop"');
    const legacyIndex = wrapper.indexOf('"com.differentai.openwork"');
    expect(foxworkIndex).toBeGreaterThanOrEqual(0);
    expect(legacyIndex).toBeGreaterThan(foxworkIndex);
  });
});
