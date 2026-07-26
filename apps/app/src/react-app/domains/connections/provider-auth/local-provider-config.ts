export type LocalProviderKind =
  | "deepseek"
  | "alibaba-cn"
  | "volcengine-ark"
  | "zhipuai"
  | "moonshotai-cn"
  | "custom-openai"
  | "custom-anthropic";

export type LocalProviderPlan = {
  kind: LocalProviderKind;
  name: string;
  protocol: "openai" | "anthropic";
  providerId: string | null;
  api: string | null;
  env: string | null;
  modelIds: string[];
  custom: boolean;
};

export const LOCAL_PROVIDER_PLANS: LocalProviderPlan[] = [
  {
    kind: "deepseek",
    name: "DeepSeek",
    protocol: "openai",
    providerId: "deepseek",
    api: "https://api.deepseek.com",
    env: "DEEPSEEK_API_KEY",
    modelIds: ["deepseek-chat", "deepseek-reasoner"],
    custom: false,
  },
  {
    kind: "alibaba-cn",
    name: "阿里云百炼",
    protocol: "openai",
    providerId: "alibaba-cn",
    api: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    env: "DASHSCOPE_API_KEY",
    modelIds: ["qwen-plus", "qwen-max", "qwen3-coder-plus"],
    custom: false,
  },
  {
    kind: "volcengine-ark",
    name: "火山方舟",
    protocol: "openai",
    providerId: "volcengine-ark",
    api: "https://ark.cn-beijing.volces.com/api/v3",
    env: "ARK_API_KEY",
    modelIds: ["doubao-seed-1-6", "doubao-seed-1-6-thinking"],
    custom: false,
  },
  {
    kind: "zhipuai",
    name: "智谱",
    protocol: "openai",
    providerId: "zhipuai",
    api: "https://open.bigmodel.cn/api/paas/v4",
    env: "ZHIPUAI_API_KEY",
    modelIds: ["glm-4.7", "glm-4.5-air", "glm-4.5-flash"],
    custom: false,
  },
  {
    kind: "moonshotai-cn",
    name: "月之暗面",
    protocol: "openai",
    providerId: "moonshotai-cn",
    api: "https://api.moonshot.cn/v1",
    env: "MOONSHOT_API_KEY",
    modelIds: ["kimi-k2.5", "kimi-k2-turbo-preview"],
    custom: false,
  },
  {
    kind: "custom-openai",
    name: "自定义 OpenAI 兼容协议",
    protocol: "openai",
    providerId: null,
    api: null,
    env: null,
    modelIds: [],
    custom: true,
  },
  {
    kind: "custom-anthropic",
    name: "自定义 Anthropic 兼容协议",
    protocol: "anthropic",
    providerId: null,
    api: null,
    env: null,
    modelIds: [],
    custom: true,
  },
];

export type LocalProviderInput = {
  kind: LocalProviderKind;
  providerId: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  modelIds: string[];
};

export type ResolvedLocalProvider = {
  providerId: string;
  name: string;
  apiKey: string;
  config: Record<string, unknown>;
  modelIds: string[];
};

const getPlan = (kind: LocalProviderKind) =>
  LOCAL_PROVIDER_PLANS.find((plan) => plan.kind === kind) ?? null;

export function parseLocalModelIds(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\n,]+/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
}

function buildEnvName(providerId: string) {
  const normalized = providerId
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${normalized || "CUSTOM_PROVIDER"}_API_KEY`;
}

export function validateLocalProviderInput(input: LocalProviderInput): string | null {
  const plan = getPlan(input.kind);
  if (!plan) return "请选择模型服务。";

  const providerId = (plan.providerId ?? input.providerId).trim();
  if (!providerId) return "请填写模型服务 ID。";
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(providerId)) {
    return "模型服务 ID 只能包含英文字母、数字、短横线和下划线。";
  }
  if (/^lpr_/i.test(providerId) || ["openwork", "opencode"].includes(providerId.toLowerCase())) {
    return "此模型服务 ID 已由 FoxWork 保留，请换一个。";
  }

  const baseUrl = (plan.api ?? input.baseUrl).trim();
  if (!/^https?:\/\//i.test(baseUrl)) {
    return "基础地址必须以 http:// 或 https:// 开头。";
  }
  if (!input.apiKey.trim()) return "请填写 API 密钥。";
  if (input.modelIds.length === 0) return "请至少填写一个模型 ID。";
  return null;
}

export function buildLocalProviderConfig(input: LocalProviderInput): ResolvedLocalProvider {
  const validationError = validateLocalProviderInput(input);
  if (validationError) throw new Error(validationError);

  const plan = getPlan(input.kind)!;
  const providerId = (plan.providerId ?? input.providerId).trim();
  const name = (plan.custom ? input.name : plan.name).trim() || providerId;
  const api = (plan.api ?? input.baseUrl).trim().replace(/\/+$/, "");
  const env = plan.env ?? buildEnvName(providerId);
  const modelIds = [...new Set(input.modelIds.map((id) => id.trim()).filter(Boolean))];
  const models = Object.fromEntries(
    modelIds.map((id) => [id, { id, name: id }]),
  );

  return {
    providerId,
    name,
    apiKey: input.apiKey.trim(),
    modelIds,
    config: {
      id: providerId,
      name,
      npm:
        plan.protocol === "anthropic"
          ? "@ai-sdk/anthropic"
          : "@ai-sdk/openai-compatible",
      env: [env],
      api,
      models,
    },
  };
}
