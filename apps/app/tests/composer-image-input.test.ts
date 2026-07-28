import { describe, expect, test } from "bun:test";

import { appendAttachmentTokensToDraft } from "../src/react-app/domains/session/surface/composer/attachment-draft";
import {
  modelRefSupportsImageInput,
  modelSupportsImageInput,
} from "../src/react-app/domains/session/surface/use-model-behavior";

describe("图片附件输入", () => {
  test("粘贴图片后保留可继续输入文字的尾随文本位置", () => {
    expect(appendAttachmentTokensToDraft("", ["image-1"])).toBe("[attachment image-1] ");
    expect(appendAttachmentTokensToDraft("请分析", ["image-1", "image-2"]))
      .toBe("请分析 [attachment image-1][attachment image-2] ");
    expect(appendAttachmentTokensToDraft("请分析 ", ["image-1"]))
      .toBe("请分析 [attachment image-1] ");
  });

  test("只允许声明图片输入能力的模型发送图片", () => {
    expect(modelSupportsImageInput({
      attachment: true,
      modalities: { input: ["text", "image"], output: ["text"] },
    })).toBe(true);
    expect(modelSupportsImageInput({
      attachment: false,
      modalities: { input: ["text"], output: ["text"] },
    })).toBe(false);
    expect(modelSupportsImageInput({ attachment: true })).toBe(true);
    expect(modelSupportsImageInput({
      modalities: { input: ["text", "image"], output: ["text"] },
    })).toBe(true);
    expect(modelSupportsImageInput({})).toBe(false);
  });

  test("识别运行时 ProviderModel 中规范化后的图片输入能力", () => {
    expect(modelSupportsImageInput({
      capabilities: {
        attachment: true,
        input: {
          text: true,
          image: true,
        },
      },
    })).toBe(true);
    expect(modelSupportsImageInput({
      capabilities: {
        attachment: false,
        input: {
          text: true,
          image: false,
        },
      },
    })).toBe(false);
  });

  test("按当前会话选择的模型判断图片能力，而不是沿用全局默认模型", () => {
    const providerCatalog = {
      company: {
        "text-only": {
          capabilities: { input: { text: true, image: false } },
        },
        vision: {
          capabilities: { input: { text: true, image: true } },
        },
      },
    };

    expect(modelRefSupportsImageInput(providerCatalog, {
      providerID: "company",
      modelID: "vision",
    })).toBe(true);
    expect(modelRefSupportsImageInput(providerCatalog, {
      providerID: "company",
      modelID: "text-only",
    })).toBe(false);
  });
});
