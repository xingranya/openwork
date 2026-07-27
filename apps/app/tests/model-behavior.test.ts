import { describe, expect, test } from "bun:test";

import type { ProviderListItem } from "../src/app/types";
import {
  getModelBehaviorOptions,
  getModelBehaviorSummary,
} from "../src/app/lib/model-behavior";

type ProviderModel = ProviderListItem["models"][string];

const model: ProviderModel = {
  id: "test-model",
  providerID: "openai",
  api: {
    id: "test-model",
    url: "https://example.com",
    npm: "@ai-sdk/openai-compatible",
  },
  name: "Test model",
  capabilities: {
    temperature: true,
    reasoning: true,
    attachment: false,
    toolcall: true,
    input: {
      text: true,
      audio: false,
      image: false,
      video: false,
      pdf: false,
    },
    output: {
      text: true,
      audio: false,
      image: false,
      video: false,
      pdf: false,
    },
    interleaved: false,
  },
  cost: {
    input: 0,
    output: 0,
    cache: {
      read: 0,
      write: 0,
    },
  },
  limit: {
    context: 1,
    output: 1,
  },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
  variants: {
    none: {},
    low: {},
    medium: {},
    high: {},
    xhigh: {},
    max: {},
  },
};

describe("模型思考强度选项", () => {
  test("只保留模型声明的原始强度值，并显示中文标签", () => {
    const options = getModelBehaviorOptions("openai", model);

    expect(options.map(({ value, label }) => ({ value, label }))).toEqual([
      { value: "none", label: "关闭" },
      { value: "low", label: "较轻" },
      { value: "medium", label: "均衡" },
      { value: "high", label: "较深" },
      { value: "xhigh", label: "很深" },
      { value: "max", label: "最深" },
    ]);
  });

  test("公司下发的 Anthropic 模型按运行时协议显示扩展思考", () => {
    const companyClaude: ProviderModel = {
      ...model,
      providerID: "lpr_company-anthropic",
      api: {
        ...model.api,
        npm: "@ai-sdk/anthropic",
      },
      variants: {
        high: {},
        max: {},
      },
    };

    const summary = getModelBehaviorSummary(
      "lpr_company-anthropic",
      companyClaude,
      null,
      "公司模型",
    );

    expect(summary.title).toBe("扩展思考");
    expect(summary.options.map((option) => option.description)).toEqual([
      "使用标准扩展思考预算。",
      "使用最大的扩展思考预算。",
    ]);
  });
});
