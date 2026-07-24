import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  FOXWORK_APP_IDENTIFIER,
  FOXWORK_APP_NAME,
  FOXWORK_PROTOCOL_SCHEME,
  isFoxWorkProtocolUrl,
  isLegacyFoxWorkProtocolUrl,
  resolveFoxWorkBrandConfig,
} from "./foxwork-brand.mjs";

const browserPanelSource = readFileSync(new URL("./browser-panel.mjs", import.meta.url), "utf8");
const mainProcessSource = readFileSync(new URL("./main.mjs", import.meta.url), "utf8");

test("默认发行身份固定为 FoxWork，且不带上游服务回退", () => {
  const config = resolveFoxWorkBrandConfig({});
  assert.equal(FOXWORK_APP_NAME, "FoxWork");
  assert.equal(FOXWORK_APP_IDENTIFIER, "com.foxwork.desktop");
  assert.equal(FOXWORK_PROTOCOL_SCHEME, "foxwork");
  assert.equal(config.appName, "FoxWork");
  assert.equal(config.docsUrl, null);
  assert.equal(config.updateBaseUrl, null);
  assert.equal(config.denBaseUrl, null);
});

test("公司配置可以显式提供 Den、文档和更新地址", () => {
  const config = resolveFoxWorkBrandConfig({
    FOXWORK_DEN_BASE_URL: "http://den.example.test/",
    FOXWORK_DOCS_URL: "https://docs.example.test/guide",
    FOXWORK_UPDATE_BASE_URL: "https://updates.example.test/foxwork/",
    FOXWORK_ALPHA_UPDATE_BASE_URL: "https://updates.example.test/foxwork-alpha/",
    FOXWORK_RELEASE_PAGE_URL: "https://downloads.example.test/foxwork",
  });
  assert.equal(config.denBaseUrl, "http://den.example.test");
  assert.equal(config.docsUrl, "https://docs.example.test/guide");
  assert.equal(config.updateBaseUrl, "https://updates.example.test/foxwork");
  assert.equal(config.alphaUpdateBaseUrl, "https://updates.example.test/foxwork-alpha");
  assert.equal(config.releasePageUrl, "https://downloads.example.test/foxwork");
});

test("新协议和旧协议的兼容范围明确", () => {
  assert.equal(isFoxWorkProtocolUrl("foxwork://connect"), true);
  assert.equal(isFoxWorkProtocolUrl("foxwork-dev://connect"), true);
  assert.equal(isFoxWorkProtocolUrl("openwork://connect"), false);
  assert.equal(isLegacyFoxWorkProtocolUrl("openwork://connect"), true);
  assert.equal(isLegacyFoxWorkProtocolUrl("foxwork://connect"), false);
});

test("桌面原生等待页和浏览器菜单只显示中文文案", () => {
  assert.match(mainProcessSource, /正在关闭 FoxWork 服务/);
  assert.match(mainProcessSource, /正在安全退出本地工作区和后台服务/);
  assert.doesNotMatch(mainProcessSource, /Stopping OpenWork services|Closing local workers/);

  for (const label of ["复制网址", "在浏览器中打开", "关闭标签页", "关闭全部标签页"]) {
    assert.match(browserPanelSource, new RegExp(label));
  }
  assert.doesNotMatch(browserPanelSource, /Copy URL|Open in Browser|Close (?:All )?Tabs?/);
});
