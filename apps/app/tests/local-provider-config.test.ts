import { describe, expect, test } from "bun:test";

import {
  LOCAL_PROVIDER_PLANS,
  buildLocalProviderConfig,
  parseLocalModelIds,
  validateLocalProviderInput,
} from "../src/react-app/domains/connections/provider-auth/local-provider-config";

describe("FoxWork 本地模型服务", () => {
  test("只提供五家国内常用服务和两种自定义协议", () => {
    expect(LOCAL_PROVIDER_PLANS.map((plan) => plan.kind)).toEqual([
      "deepseek",
      "alibaba-cn",
      "volcengine-ark",
      "zhipuai",
      "moonshotai-cn",
      "custom-openai",
      "custom-anthropic",
    ]);
  });

  test("国内常用服务使用固定地址并允许自定义模型 ID", () => {
    const resolved = buildLocalProviderConfig({
      kind: "deepseek",
      providerId: "ignored",
      name: "ignored",
      baseUrl: "https://ignored.example.com",
      apiKey: "secret",
      modelIds: ["deepseek-chat", "new-model"],
    });

    expect(resolved.providerId).toBe("deepseek");
    expect(resolved.config.api).toBe("https://api.deepseek.com");
    expect(resolved.config.npm).toBe("@ai-sdk/openai-compatible");
    expect(Object.keys(resolved.config.models as object)).toEqual([
      "deepseek-chat",
      "new-model",
    ]);
  });

  test("自定义 Anthropic 协议保留地址、模型 ID 和独立供应商 ID", () => {
    const resolved = buildLocalProviderConfig({
      kind: "custom-anthropic",
      providerId: "company-anthropic",
      name: "公司 Anthropic 网关",
      baseUrl: "https://anthropic.example.com/v1/",
      apiKey: "secret",
      modelIds: ["claude-company"],
    });

    expect(resolved.providerId).toBe("company-anthropic");
    expect(resolved.config.npm).toBe("@ai-sdk/anthropic");
    expect(resolved.config.api).toBe("https://anthropic.example.com/v1");
    expect(resolved.config.env).toEqual(["COMPANY_ANTHROPIC_API_KEY"]);
  });

  test("模型 ID 去重，并拒绝保留 ID 和缺失字段", () => {
    expect(parseLocalModelIds("m1\nm2,m1")).toEqual(["m1", "m2"]);
    expect(
      validateLocalProviderInput({
        kind: "custom-openai",
        providerId: "openwork",
        name: "自定义服务",
        baseUrl: "https://models.example.com/v1",
        apiKey: "secret",
        modelIds: ["m1"],
      }),
    ).toContain("保留");
  });
});
