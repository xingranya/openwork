type JsonRecord = Record<string, unknown>

export type ModelReasoningDefaultsInput = {
  modelId: string
  npm: string
  config?: JsonRecord
}

const GPT5_FAMILY_RE = /(?:^|\/)gpt-5(?:[.-]|$)/i
const GPT_ALIAS_RE = /(?:^|\/)gpt-(?!\d)/i
const GPT5_VERSION_RE = /(?:^|\/)gpt-5[.-](\d+)(?:[.-]|$)/i
const GPT5_PRO_RE = /(?:^|\/)gpt-5[.-]?pro(?:[.-]|$)/i
const GPT5_VERSIONED_PRO_RE = /(?:^|\/)gpt-5[.-]\d+[.-]pro(?:[.-]|$)/i
const WIDELY_SUPPORTED_EFFORTS = ["low", "medium", "high"]
const OPENAI_GPT5_1_EFFORTS = ["none", ...WIDELY_SUPPORTED_EFFORTS]
const OPENAI_GPT5_2_PLUS_EFFORTS = [...OPENAI_GPT5_1_EFFORTS, "xhigh"]
const OPENAI_GPT5_PRO_EFFORTS = ["high"]
const OPENAI_GPT5_PRO_2_PLUS_EFFORTS = ["medium", "high", "xhigh"]
const OPENAI_GPT5_CHAT_EFFORTS = ["medium"]
const OPENAI_GPT5_CODEX_XHIGH_EFFORTS = [...WIDELY_SUPPORTED_EFFORTS, "xhigh"]
const OPENAI_GPT5_CODEX_3_PLUS_EFFORTS = ["none", ...OPENAI_GPT5_CODEX_XHIGH_EFFORTS]
const ANTHROPIC_ADAPTIVE_46_MARKERS = [
  "opus-4-6",
  "opus-4.6",
  "4-6-opus",
  "4.6-opus",
  "sonnet-4-6",
  "sonnet-4.6",
  "4-6-sonnet",
  "4.6-sonnet",
]

const reasoningEffortVariants = (efforts: string[]) =>
  Object.fromEntries(
    efforts.map((effort) => [effort, { reasoningEffort: effort }]),
  )

const openaiReasoningVariants = (efforts: string[]) =>
  Object.fromEntries(
    efforts.map((effort) => [
      effort,
      {
        reasoningEffort: effort,
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
    ]),
  )

const anthropicAdaptiveVariants = (
  efforts: string[],
  summarizeThinking = false,
) =>
  Object.fromEntries(
    efforts.map((effort) => [
      effort,
      {
        thinking: {
          type: "adaptive",
          ...(summarizeThinking ? { display: "summarized" } : {}),
        },
        effort,
      },
    ]),
  )

const anthropicBudgetVariants = () => ({
  high: {
    thinking: { type: "enabled", budgetTokens: 16_000 },
  },
  max: {
    thinking: { type: "enabled", budgetTokens: 31_999 },
  },
})

const anthropicEffortVariants = (efforts: string[]) =>
  Object.fromEntries(efforts.map((effort) => [effort, { effort }]))

const isKnownClaudeWithoutExtendedThinking = (modelId: string) => {
  const version = /(?:^|\/)claude-3(?:[.-](\d+))?(?:[.-]|$)/i.exec(modelId)
  if (!version) return false
  return Number(version[1] ?? 0) < 7
}

const isAnthropicOpus47OrLater = (modelId: string) => {
  const version = /opus-(\d+)[.-](\d+)(?:[.@-]|$)|claude-(\d+)[.-](\d+)-opus(?:[.@-]|$)/i.exec(modelId)
  if (!version) return false
  const major = Number(version[1] ?? version[3])
  const minor = Number(version[2] ?? version[4])
  return major > 4 || (major === 4 && minor >= 7)
}

const gpt5Version = (modelId: string) =>
  Number(GPT5_VERSION_RE.exec(modelId)?.[1]) || undefined

const versionedGpt5Efforts = (modelId: string) => {
  if (GPT5_VERSIONED_PRO_RE.test(modelId)) return OPENAI_GPT5_PRO_2_PLUS_EFFORTS
  const version = gpt5Version(modelId)
  if (version === undefined) return undefined
  return version === 1 ? OPENAI_GPT5_1_EFFORTS : OPENAI_GPT5_2_PLUS_EFFORTS
}

const gpt5CodexEfforts = (modelId: string) => {
  if (!GPT5_FAMILY_RE.test(modelId) || !modelId.includes("codex")) return undefined
  const version = gpt5Version(modelId)
  if (version !== undefined && version >= 3) return OPENAI_GPT5_CODEX_3_PLUS_EFFORTS
  if (modelId.includes("codex-max") || (version !== undefined && version >= 2)) {
    return OPENAI_GPT5_CODEX_XHIGH_EFFORTS
  }
  return WIDELY_SUPPORTED_EFFORTS
}

const openaiGpt5Efforts = (modelId: string) => {
  const normalized = modelId.toLowerCase()
  if (normalized.includes("-chat")) {
    return gpt5Version(normalized) === undefined ? [] : OPENAI_GPT5_CHAT_EFFORTS
  }
  if (GPT5_PRO_RE.test(normalized)) return OPENAI_GPT5_PRO_EFFORTS
  return gpt5CodexEfforts(normalized) ?? versionedGpt5Efforts(normalized) ?? [
    "minimal",
    ...WIDELY_SUPPORTED_EFFORTS,
  ]
}

const isGptReasoningModel = (modelId: string) =>
  GPT5_FAMILY_RE.test(modelId) || GPT_ALIAS_RE.test(modelId)

/**
 * 为员工或公司新增的模型补齐运行时可识别的推理强度默认值。
 * 管理员已经显式填写推理能力或变体时保持原配置不变。
 */
export function applyModelReasoningDefaults(
  input: ModelReasoningDefaultsInput,
): JsonRecord {
  const config = { ...(input.config ?? {}) }
  if ("reasoning" in config || "variants" in config) return config

  if (
    input.npm === "@ai-sdk/openai-compatible" &&
    isGptReasoningModel(input.modelId)
  ) {
    return {
      ...config,
      reasoning: true,
      variants: reasoningEffortVariants(["low", "medium", "high"]),
    }
  }

  if (input.npm === "@ai-sdk/openai" && isGptReasoningModel(input.modelId)) {
    return {
      ...config,
      reasoning: true,
      variants: openaiReasoningVariants(
        GPT5_FAMILY_RE.test(input.modelId)
          ? openaiGpt5Efforts(input.modelId)
          : WIDELY_SUPPORTED_EFFORTS,
      ),
    }
  }

  const modelId = input.modelId.toLowerCase()
  if (
    input.npm === "@ai-sdk/anthropic" &&
    (isAnthropicOpus47OrLater(modelId) || modelId.includes("fable-5"))
  ) {
    return {
      ...config,
      reasoning: true,
      variants: anthropicAdaptiveVariants(
        ["low", "medium", "high", "xhigh", "max"],
        true,
      ),
    }
  }

  if (
    input.npm === "@ai-sdk/anthropic" &&
    ANTHROPIC_ADAPTIVE_46_MARKERS.some((marker) => modelId.includes(marker))
  ) {
    return {
      ...config,
      reasoning: true,
      variants: anthropicAdaptiveVariants(["low", "medium", "high", "max"]),
    }
  }

  if (
    input.npm === "@ai-sdk/anthropic" &&
    ["opus-4-5", "opus-4.5"].some((marker) => modelId.includes(marker))
  ) {
    return {
      ...config,
      reasoning: true,
      variants: anthropicEffortVariants(WIDELY_SUPPORTED_EFFORTS),
    }
  }

  if (
    input.npm === "@ai-sdk/anthropic" &&
    modelId.includes("claude") &&
    !isKnownClaudeWithoutExtendedThinking(modelId)
  ) {
    return {
      ...config,
      reasoning: true,
      variants: anthropicBudgetVariants(),
    }
  }

  return config
}
