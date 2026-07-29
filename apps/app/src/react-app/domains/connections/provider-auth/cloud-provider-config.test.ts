declare const describe: (name: string, fn: () => void) => void;
declare const test: (name: string, fn: () => void) => void;
declare const expect: (value: unknown) => {
  toBe: (expected: unknown) => void;
  toEqual: (expected: unknown) => void;
  toMatchObject: (expected: unknown) => void;
};

import type {
  DenOrgLlmProvider,
  DenOrgLlmProviderModel,
} from "../../../../app/lib/den";
import type { CloudImportedProvider } from "../../../../app/cloud/import-state";
import type { DenOrgLlmProviderConnection } from "../../../../app/lib/den";
import {
  buildCloudProviderConfig,
  prepareCloudProviderRuntimeForAuthentication,
  getCloudManagedProviderId,
  getProviderModelIds,
  isCloudProviderOutOfSync,
} from "./cloud-provider-config";

const UPDATED_AT = "2024-02-01T00:00:00.000Z";

const makeModel = (id: string): DenOrgLlmProviderModel => ({
  id,
  name: id,
  config: {},
  createdAt: null,
});

const makeProvider = (
  models: DenOrgLlmProviderModel[],
  updatedAt = UPDATED_AT,
): DenOrgLlmProvider => ({
  id: "lpr_openrouter",
  source: "custom",
  providerId: "openrouter",
  name: "OpenRouter",
  providerConfig: {},
  hasApiKey: true,
  defaultEnabled: false,
  models,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt,
});

const importedFrom = (provider: DenOrgLlmProvider): CloudImportedProvider => ({
  cloudProviderId: provider.id,
  providerId: getCloudManagedProviderId(provider),
  sourceProviderId: provider.providerId,
  name: provider.name,
  source: provider.source,
  updatedAt: provider.updatedAt,
  modelIds: getProviderModelIds(provider),
  importedAt: 1,
});

describe("isCloudProviderOutOfSync", () => {
  test("returns false for an in-sync provider", () => {
    const provider = makeProvider([makeModel("model-a"), makeModel("model-b")]);
    expect(isCloudProviderOutOfSync(provider, importedFrom(provider))).toBe(false);
  });

  test("ignores whitespace and empty live model ids", () => {
    const baselineProvider = makeProvider([makeModel("model-a")]);
    const liveProvider = makeProvider([
      makeModel("model-a "),
      makeModel("   "),
    ]);

    expect(isCloudProviderOutOfSync(liveProvider, importedFrom(baselineProvider))).toBe(false);
  });

  test("returns true for a changed model list", () => {
    const baselineProvider = makeProvider([makeModel("model-a")]);
    const liveProvider = makeProvider([makeModel("model-a"), makeModel("model-b")]);

    expect(isCloudProviderOutOfSync(liveProvider, importedFrom(baselineProvider))).toBe(true);
  });

  test("returns true for a changed updatedAt", () => {
    const baselineProvider = makeProvider([makeModel("model-a")]);
    const liveProvider = makeProvider(
      [makeModel("model-a")],
      "2024-03-01T00:00:00.000Z",
    );

    expect(isCloudProviderOutOfSync(liveProvider, importedFrom(baselineProvider))).toBe(true);
  });
});

describe("buildCloudProviderConfig", () => {
  test("首次导入公司模型时，先投影运行时配置并重载，再保存模型凭据", async () => {
    const provider = {
      ...makeProvider([makeModel("gpt-company")]),
      providerConfig: {
        npm: "@ai-sdk/openai-compatible",
        env: ["COMPANY_OPENAI_API_KEY"],
      },
      apiKey: "company-secret",
      apiKeys: null,
    } satisfies DenOrgLlmProviderConnection;
    const steps: string[] = [];

    await prepareCloudProviderRuntimeForAuthentication({
      provider,
      localProviderId: "lpr_openrouter",
      previousProviderId: null,
      writeRuntimeProviders: async (providers) => {
        expect(providers.lpr_openrouter).toMatchObject({
          id: "openrouter",
          models: { "gpt-company": { id: "gpt-company" } },
        });
        steps.push("运行时配置");
      },
      reloadRuntime: async () => {
        expect(steps).toEqual(["运行时配置"]);
        steps.push("重载运行时");
      },
      saveAuthentication: async (providerId, apiKey) => {
        expect(steps).toEqual(["运行时配置", "重载运行时"]);
        expect(providerId).toBe("lpr_openrouter");
        expect(apiKey).toBe("company-secret");
        steps.push("保存凭据");
      },
    });

    expect(steps).toEqual(["运行时配置", "重载运行时", "保存凭据"]);
  });

  test("完整保留 Den 下发的图片输入能力", () => {
    const provider = makeProvider([{
      ...makeModel("vision-company"),
      config: {
        attachment: true,
        modalities: {
          input: ["text", "image"],
          output: ["text"],
        },
      },
    }]);
    provider.providerConfig = { npm: "@ai-sdk/openai-compatible" };

    expect(buildCloudProviderConfig({
      ...provider,
      apiKey: "secret",
      apiKeys: null,
    })).toEqual({
      id: "openrouter",
      name: "OpenRouter",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "vision-company": {
          id: "vision-company",
          name: "vision-company",
          attachment: true,
          modalities: {
            input: ["text", "image"],
            output: ["text"],
          },
        },
      },
    });
  });

  test("完整保留 Den 下发的推理能力和强度变体", () => {
    const provider = makeProvider([{
      ...makeModel("claude-company"),
      config: {
        reasoning: true,
        variants: {
          high: { thinking: { type: "enabled", budgetTokens: 16000 } },
          max: { thinking: { type: "enabled", budgetTokens: 31999 } },
        },
      },
    }]);
    provider.providerConfig = { npm: "@ai-sdk/anthropic" };

    expect(buildCloudProviderConfig({
      ...provider,
      apiKey: "secret",
      apiKeys: null,
    })).toEqual({
      id: "openrouter",
      name: "OpenRouter",
      env: [],
      npm: "@ai-sdk/anthropic",
      models: {
        "claude-company": {
          id: "claude-company",
          name: "claude-company",
          reasoning: true,
          variants: {
            high: { thinking: { type: "enabled", budgetTokens: 16000 } },
            max: { thinking: { type: "enabled", budgetTokens: 31999 } },
          },
        },
      },
    });
  });
});
