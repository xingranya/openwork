import { describe, expect, test } from "bun:test";

import {
  LOCAL_PROVIDER_PLANS,
  buildLocalProviderConfig,
  parseLocalModelIds,
  validateLocalProviderInput,
} from "../src/react-app/domains/connections/provider-auth/local-provider-config";

describe("SeeWayWork 本地模型服务", () => {
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

  test("Anthropic 兼容地址缺少版本路径时自动补齐 v1", () => {
    const resolved = buildLocalProviderConfig({
      kind: "custom-anthropic",
      providerId: "minimax",
      name: "MiniMax",
      baseUrl: "https://api.minimaxi.com/anthropic",
      apiKey: "secret",
      modelIds: ["MiniMax-M3"],
    });

    expect(resolved.config.api).toBe("https://api.minimaxi.com/anthropic/v1");
  });

  test("OpenAI 兼容地址缺少版本路径时自动补齐 v1", () => {
    const resolved = buildLocalProviderConfig({
      kind: "custom-openai",
      providerId: "seeway",
      name: "Seeway",
      baseUrl: "https://ai.seeway.co",
      apiKey: "secret",
      modelIds: ["gpt-5.4"],
    });

    expect(resolved.config.api).toBe("https://ai.seeway.co/v1");
  });

  test("自定义 OpenAI 兼容服务为 GPT 推理模型生成可选强度", () => {
    const resolved = buildLocalProviderConfig({
      kind: "custom-openai",
      providerId: "company-openai",
      name: "公司 OpenAI 网关",
      baseUrl: "https://models.example.com/v1",
      apiKey: "secret",
      modelIds: ["gpt-5.4"],
    });

    expect((resolved.config.models as Record<string, Record<string, unknown>>)["gpt-5.4"]).toEqual({
      id: "gpt-5.4",
      name: "gpt-5.4",
      reasoning: true,
      variants: {
        low: { reasoningEffort: "low" },
        medium: { reasoningEffort: "medium" },
        high: { reasoningEffort: "high" },
      },
    });
  });

  test("本地视觉模型写入图片输入能力并保持文字模型禁用", () => {
    const resolved = buildLocalProviderConfig({
      kind: "custom-openai",
      providerId: "company-openai",
      name: "公司 OpenAI 网关",
      baseUrl: "https://models.example.com/v1",
      apiKey: "secret",
      modelIds: ["vision-model", "text-model"],
      imageInputModelIds: ["vision-model"],
    });

    expect((resolved.config.models as Record<string, Record<string, unknown>>)["vision-model"])
      .toMatchObject({
        attachment: true,
        modalities: { input: ["text", "image"], output: ["text"] },
      });
    expect((resolved.config.models as Record<string, Record<string, unknown>>)["text-model"])
      .toMatchObject({
        attachment: false,
        modalities: { input: ["text"], output: ["text"] },
      });
  });

  test("自定义 Anthropic 兼容服务为 Claude 4.6 生成扩展思考强度", () => {
    const resolved = buildLocalProviderConfig({
      kind: "custom-anthropic",
      providerId: "company-anthropic",
      name: "公司 Anthropic 网关",
      baseUrl: "https://anthropic.example.com/v1",
      apiKey: "secret",
      modelIds: ["claude-sonnet-4-6"],
    });

    expect((resolved.config.models as Record<string, Record<string, unknown>>)["claude-sonnet-4-6"]).toEqual({
      id: "claude-sonnet-4-6",
      name: "claude-sonnet-4-6",
      reasoning: true,
      variants: {
        low: { thinking: { type: "adaptive" }, effort: "low" },
        medium: { thinking: { type: "adaptive" }, effort: "medium" },
        high: { thinking: { type: "adaptive" }, effort: "high" },
        max: { thinking: { type: "adaptive" }, effort: "max" },
      },
    });
  });

  test("自定义 Claude 别名使用安全的扩展思考预算", () => {
    const resolved = buildLocalProviderConfig({
      kind: "custom-anthropic",
      providerId: "company-anthropic",
      name: "公司 Anthropic 网关",
      baseUrl: "https://anthropic.example.com/v1",
      apiKey: "secret",
      modelIds: ["claude-company"],
    });

    expect((resolved.config.models as Record<string, Record<string, unknown>>)["claude-company"]).toEqual({
      id: "claude-company",
      name: "claude-company",
      reasoning: true,
      variants: {
        high: { thinking: { type: "enabled", budgetTokens: 16000 } },
        max: { thinking: { type: "enabled", budgetTokens: 31999 } },
      },
    });
  });

  test("不为 GPT-4 和 Claude 3.5 错误显示推理强度", () => {
    const openai = buildLocalProviderConfig({
      kind: "custom-openai",
      providerId: "company-openai",
      name: "公司 OpenAI 网关",
      baseUrl: "https://models.example.com/v1",
      apiKey: "secret",
      modelIds: ["gpt-4.1"],
    });
    const anthropic = buildLocalProviderConfig({
      kind: "custom-anthropic",
      providerId: "company-anthropic",
      name: "公司 Anthropic 网关",
      baseUrl: "https://anthropic.example.com/v1",
      apiKey: "secret",
      modelIds: ["claude-3-5-sonnet-latest"],
    });

    expect((openai.config.models as Record<string, unknown>)["gpt-4.1"]).toEqual({
      id: "gpt-4.1",
      name: "gpt-4.1",
    });
    expect((anthropic.config.models as Record<string, unknown>)["claude-3-5-sonnet-latest"]).toEqual({
      id: "claude-3-5-sonnet-latest",
      name: "claude-3-5-sonnet-latest",
    });
  });

  test("自定义 GPT 别名仍提供推理强度", () => {
    const resolved = buildLocalProviderConfig({
      kind: "custom-openai",
      providerId: "company-openai",
      name: "公司 OpenAI 网关",
      baseUrl: "https://models.example.com/v1",
      apiKey: "secret",
      modelIds: ["gpt-company"],
    });

    expect((resolved.config.models as Record<string, Record<string, unknown>>)["gpt-company"]).toEqual({
      id: "gpt-company",
      name: "gpt-company",
      reasoning: true,
      variants: {
        low: { reasoningEffort: "low" },
        medium: { reasoningEffort: "medium" },
        high: { reasoningEffort: "high" },
      },
    });
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
