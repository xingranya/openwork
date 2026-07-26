type JsonRecord = Record<string, unknown>

export type ModelsDevProviderSummary = {
  id: string
  name: string
  npm: string | null
  env: string[]
  doc: string | null
  api: string | null
  modelCount: number
  allowCustomModelIds: boolean
}

export type ModelsDevModel = {
  id: string
  name: string
  config: JsonRecord
}

export type ModelsDevProvider = {
  id: string
  name: string
  npm: string | null
  env: string[]
  doc: string | null
  api: string | null
  config: JsonRecord
  models: ModelsDevModel[]
  allowCustomModelIds: boolean
}

function createProvider(input: {
  id: string
  name: string
  env: string
  api: string
  doc: string
  models: string[]
}): ModelsDevProvider {
  const models = input.models.map((modelId) => ({
    id: modelId,
    name: modelId,
    config: { id: modelId, name: modelId },
  }))
  const config = {
    id: input.id,
    name: input.name,
    npm: "@ai-sdk/openai-compatible",
    env: [input.env],
    api: input.api,
    doc: input.doc,
  }

  return {
    ...config,
    config,
    models,
    allowCustomModelIds: true,
  }
}

// 员工和管理员只看到公司批准的常用服务。模型 ID 可补充填写，
// 因此无需依赖外部大目录，也不会因供应商发布新模型而阻断配置。
const COMPANY_MODEL_PROVIDERS: ModelsDevProvider[] = [
  createProvider({
    id: "deepseek",
    name: "DeepSeek",
    env: "DEEPSEEK_API_KEY",
    api: "https://api.deepseek.com",
    doc: "https://api-docs.deepseek.com/zh-cn/",
    models: ["deepseek-chat", "deepseek-reasoner"],
  }),
  createProvider({
    id: "alibaba-cn",
    name: "阿里云百炼",
    env: "DASHSCOPE_API_KEY",
    api: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    doc: "https://help.aliyun.com/zh/model-studio/",
    models: ["qwen-plus", "qwen-max", "qwen3-coder-plus"],
  }),
  createProvider({
    id: "volcengine-ark",
    name: "火山方舟",
    env: "ARK_API_KEY",
    api: "https://ark.cn-beijing.volces.com/api/v3",
    doc: "https://www.volcengine.com/docs/82379",
    models: ["doubao-seed-1-6", "doubao-seed-1-6-thinking"],
  }),
  createProvider({
    id: "zhipuai",
    name: "智谱",
    env: "ZHIPUAI_API_KEY",
    api: "https://open.bigmodel.cn/api/paas/v4",
    doc: "https://docs.bigmodel.cn/",
    models: ["glm-4.7", "glm-4.5-air", "glm-4.5-flash"],
  }),
  createProvider({
    id: "moonshotai-cn",
    name: "月之暗面",
    env: "MOONSHOT_API_KEY",
    api: "https://api.moonshot.cn/v1",
    doc: "https://platform.moonshot.cn/docs/",
    models: ["kimi-k2.5", "kimi-k2-turbo-preview"],
  }),
]

const COMPANY_MODEL_PROVIDERS_BY_ID = new Map(
  COMPANY_MODEL_PROVIDERS.map((provider) => [provider.id, provider]),
)

export async function listModelsDevProviders(): Promise<ModelsDevProviderSummary[]> {
  return COMPANY_MODEL_PROVIDERS.map((provider) => ({
    id: provider.id,
    name: provider.name,
    npm: provider.npm,
    env: provider.env,
    doc: provider.doc,
    api: provider.api,
    modelCount: provider.models.length,
    allowCustomModelIds: provider.allowCustomModelIds,
  }))
}

export async function getModelsDevProvider(providerId: string): Promise<ModelsDevProvider | null> {
  return COMPANY_MODEL_PROVIDERS_BY_ID.get(providerId) ?? null
}
