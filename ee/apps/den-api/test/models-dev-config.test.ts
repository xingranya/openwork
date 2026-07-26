import { expect, test } from "bun:test"
import { getModelsDevProvider, listModelsDevProviders } from "../src/llm/models-dev.js"

test("公司模型目录只提供批准的五个国内常用服务", async () => {
  const providers = await listModelsDevProviders()

  expect(providers.map((provider) => provider.id)).toEqual([
    "deepseek",
    "alibaba-cn",
    "volcengine-ark",
    "zhipuai",
    "moonshotai-cn",
  ])
  expect(providers.map((provider) => provider.name)).toEqual([
    "DeepSeek",
    "阿里云百炼",
    "火山方舟",
    "智谱",
    "月之暗面",
  ])
  expect(providers.every((provider) => provider.modelCount <= 3)).toBe(true)
  expect(providers.every((provider) => provider.allowCustomModelIds)).toBe(true)
})

test("常用服务使用公司内置地址且不暴露目录外供应商", async () => {
  expect((await getModelsDevProvider("deepseek"))?.api).toBe("https://api.deepseek.com")
  expect((await getModelsDevProvider("volcengine-ark"))?.env).toEqual(["ARK_API_KEY"])
  expect(await getModelsDevProvider("openai")).toBeNull()
})
