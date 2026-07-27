import { describe, expect, test } from "bun:test";

import { buildSessionPromptRuntimeOptions } from "../src/react-app/domains/session/sync/session-prompt-runtime-options";

describe("会话模型推理强度请求", () => {
  test("把员工选择的推理强度传给运行时", () => {
    expect(buildSessionPromptRuntimeOptions({
      model: { providerID: "lpr_company", modelID: "gpt-5.4" },
      agent: "build",
      variant: "high",
      system: "公司上下文",
    })).toEqual({
      model: { providerID: "lpr_company", modelID: "gpt-5.4" },
      agent: "build",
      variant: "high",
      system: "公司上下文",
    });
  });

  test("未选择推理强度时不发送空参数", () => {
    expect(buildSessionPromptRuntimeOptions({
      model: null,
      agent: null,
      variant: null,
      system: null,
    })).toEqual({});
  });
});
