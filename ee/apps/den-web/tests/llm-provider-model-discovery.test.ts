import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const editorSource = readFileSync(
  fileURLToPath(new URL("../app/(den)/dashboard/_components/llm-provider-editor-screen.tsx", import.meta.url)),
  "utf8",
);

describe("自定义模型服务的模型发现", () => {
  test("OpenAI 和 Anthropic 协议都从 Models 接口读取模型", () => {
    expect(editorSource).toContain("requestLlmProviderTestConnection({ api, apiKey: key, protocol: customProtocol })");
    expect(editorSource).not.toContain('customProtocol !== "openai"\n        )');
    expect(editorSource).toContain("从接口模型列表中选择");
  });

  test("探测失败时仍保留手动模型 ID 兜底", () => {
    expect(editorSource).toContain("列表中没有需要的模型，手动填写 ID");
    expect(editorSource).toContain("每行填写一个，也可以用逗号分隔");
  });

  test("接口地址填写后即使没有密钥也会尝试读取模型列表", () => {
    expect(editorSource).toContain("if (!api) {");
    expect(editorSource).toContain("系统会自动读取 Anthropic 兼容接口的模型列表");
    expect(editorSource).not.toContain("请先填写 API 密钥，以读取此接口提供的模型");
  });

  test("匿名探测遇到鉴权失败时提示补充凭据", () => {
    expect(editorSource).toContain("probeCredential");
    expect(editorSource).toContain("此接口需要凭据，请填写 API 密钥后重试。");
    expect(editorSource).toContain('getErrorMessage(probeResult?.hint, "无法使用当前地址和密钥访问接口。")');
  });
});
