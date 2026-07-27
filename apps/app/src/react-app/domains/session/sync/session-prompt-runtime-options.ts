import type { ModelRef } from "@/app/types";

export type SessionPromptRuntimeOptionsInput = {
  model: ModelRef | null | undefined;
  agent: string | null | undefined;
  variant: string | null | undefined;
  system: string | null | undefined;
};

/** 只把当前会话明确选择的模型运行参数发送给推理引擎。 */
export function buildSessionPromptRuntimeOptions(
  input: SessionPromptRuntimeOptionsInput,
) {
  return {
    ...(input.model ? { model: input.model } : {}),
    ...(input.agent ? { agent: input.agent } : {}),
    ...(input.variant ? { variant: input.variant } : {}),
    ...(input.system ? { system: input.system } : {}),
  };
}
