import { describe, expect, test } from "bun:test";

import { applyModelImageInputCapabilities } from "../src/llm/model-capabilities.js";

const models = [
  {
    id: "vision-model",
    name: "视觉模型",
    config: {
      id: "vision-model",
      name: "视觉模型",
      reasoning: true,
      variants: { high: { reasoningEffort: "high" } },
    },
  },
  {
    id: "text-model",
    name: "文字模型",
    config: {
      id: "text-model",
      name: "文字模型",
      attachment: true,
      modalities: { input: ["text", "image"], output: ["text"] },
    },
  },
];

describe("Den 模型图片输入能力", () => {
  test("按管理员选择启用或关闭图片输入并保留其他模型配置", () => {
    expect(applyModelImageInputCapabilities(models, ["vision-model"])).toEqual([
      {
        id: "vision-model",
        name: "视觉模型",
        config: {
          id: "vision-model",
          name: "视觉模型",
          reasoning: true,
          variants: { high: { reasoningEffort: "high" } },
          attachment: true,
          modalities: { input: ["text", "image"], output: ["text"] },
        },
      },
      {
        id: "text-model",
        name: "文字模型",
        config: {
          id: "text-model",
          name: "文字模型",
          attachment: false,
          modalities: { input: ["text"], output: ["text"] },
        },
      },
    ]);
  });

  test("旧客户端未提交图片能力时保持原配置", () => {
    expect(applyModelImageInputCapabilities(models, undefined)).toEqual(models);
  });
});
