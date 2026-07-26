import { describe, expect, test } from "bun:test";

import { buildOpenworkRuntimeConfigObject } from "../openwork-runtime-config.js";
import { openworkBrowserAutomationPluginPath } from "../openwork-extensions-plugin-path.js";
import {
  buildAccessibilitySnapshot,
  formatBrowserEvaluationResult,
  serializeBrowserEvaluationValue,
  type AccessibilityNode,
} from "./openwork-browser-automation-lib.js";

function axNode(input: AccessibilityNode): AccessibilityNode {
  return input;
}

describe("FoxWork 浏览器页面结构", () => {
  test("根据 parentId 恢复缺失的子节点关系", () => {
    const snapshot = buildAccessibilitySnapshot([
      axNode({ nodeId: "root", role: { value: "RootWebArea" }, name: { value: "示例页面" } }),
      axNode({ nodeId: "wrapper", parentId: "root", ignored: true, role: { value: "none" } }),
      axNode({ nodeId: "button", parentId: "wrapper", backendDOMNodeId: 42, role: { value: "button" }, name: { value: "继续" } }),
      axNode({ nodeId: "input", parentId: "root", backendDOMNodeId: 43, role: { value: "textbox" }, name: { value: "邮箱" } }),
    ]);

    expect(snapshot.text).toContain('RootWebArea "示例页面"');
    expect(snapshot.text).toContain('button "继续"');
    expect(snapshot.text).toContain('textbox "邮箱"');
    expect(snapshot.byUid.size).toBe(3);
    expect([...snapshot.byUid.values()].find((node) => node.name === "继续")?.backendNodeId).toBe(42);
  });

  test("同时合并 childIds 与 parentId 且不重复节点", () => {
    const snapshot = buildAccessibilitySnapshot([
      axNode({ nodeId: "root", childIds: ["button"], role: { value: "RootWebArea" } }),
      axNode({ nodeId: "button", parentId: "root", backendDOMNodeId: 7, role: { value: "button" }, name: { value: "提交" } }),
    ]);

    expect(snapshot.text.match(/button "提交"/g)).toHaveLength(1);
  });
});

describe("FoxWork 浏览器脚本结果", () => {
  test("DOM 元素转为包含标签、属性和文字的可读对象", () => {
    const element = {
      nodeType: 1,
      nodeName: "BUTTON",
      textContent: "  提交表单  ",
      attributes: [
        { name: "id", value: "submit" },
        { name: "aria-label", value: "提交" },
      ],
      disabled: false,
    };

    const result = serializeBrowserEvaluationValue.call(element);
    const text = formatBrowserEvaluationResult(result);

    expect(text).toContain('"type": "element"');
    expect(text).toContain('"nodeName": "BUTTON"');
    expect(text).toContain('"aria-label": "提交"');
    expect(text).toContain('"text": "提交表单"');
    expect(text).not.toBe("{}");
  });

  test("DOM 集合逐项序列化", () => {
    const values = [
      { nodeType: 1, nodeName: "A", textContent: "首页", attributes: [] },
      { nodeType: 1, nodeName: "A", textContent: "帮助", attributes: [] },
    ];
    const collection = {
      length: values.length,
      item(index: number) {
        return values[index] ?? null;
      },
    };

    const result = serializeBrowserEvaluationValue.call(collection);
    expect(formatBrowserEvaluationResult(result)).toContain('"text": "帮助"');
  });
});

test("运行配置使用随安装包分发的浏览器插件", async () => {
  const config = await buildOpenworkRuntimeConfigObject();
  const plugins = Array.isArray(config.plugin) ? config.plugin : [];

  expect(plugins).toContain(openworkBrowserAutomationPluginPath());
  expect(plugins).not.toContain("opencode-chrome-devtools");
});
