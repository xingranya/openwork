import { applyEdits, modify } from "jsonc-parser";
import type { ProviderConfig } from "@opencode-ai/sdk/v2/client";

import type {
  DenOrgLlmProvider,
  DenOrgLlmProviderConnection,
} from "../../../../app/lib/den";
import type { CloudImportedProvider } from "../../../../app/cloud/import-state";

/** 构建并校准公司托管的模型配置，供连接流程和单元测试共同使用。 */

const getStringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.trim().length > 0,
      )
    : [];

const sameStringList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const removeCloudProviderComment = (raw: string, providerId: string) =>
  raw.replace(
    new RegExp(
      `(^[ \t]*)// (?:SeeWayWork 公司模型导入|SeeWayWork[ \\t]+Cloud import):.*\\n\\1(?="${escapeRegExp(providerId)}":)`,
      "m",
    ),
    "$1",
  );

export const getCloudProviderEnv = (config: Record<string, unknown>) =>
  getStringList(config.env);

/**
 * 把连接凭据拆分为本机认证项和需要写入的环境变量。多变量模型以配置中的
 * 第一个环境变量作为主凭据，旧版单凭据载荷继续只写认证项。
 */
export const resolveCloudProviderCredentials = (
  provider: Pick<
    DenOrgLlmProviderConnection,
    "apiKey" | "apiKeys" | "providerConfig"
  >,
) => {
  const apiKeys = provider.apiKeys ?? {};
  const envNames = getCloudProviderEnv(provider.providerConfig);
  const orderedNames = [
    ...envNames.filter((name) => name in apiKeys),
    ...Object.keys(apiKeys).filter((name) => !envNames.includes(name)),
  ];
  const envEntries = orderedNames.flatMap((name) => {
    const value = apiKeys[name]?.trim();
    return value ? [{ key: name, value }] : [];
  });
  const primaryApiKey = provider.apiKey?.trim() || envEntries[0]?.value || "";
  return { envEntries, primaryApiKey };
};

export const getCloudManagedProviderId = (
  provider: Pick<DenOrgLlmProvider, "id" | "providerId" | "source">,
) => (provider.source === "openwork" ? "openwork" : provider.id.trim());

/** 判断模型配置是否由公司导入流程管理。 */
export const isCloudManagedProviderKey = (providerId: string) =>
  /^lpr_/i.test(providerId) || providerId.trim() === "openwork";


export const getProviderModelIds = (
  provider: Pick<DenOrgLlmProvider, "models">,
) =>
  provider.models
    .flatMap((model) => {
      const id = model.id.trim();
      return id ? [id] : [];
    })
    .sort();

export const isCloudProviderOutOfSync = (
  provider: DenOrgLlmProvider,
  importedProvider: CloudImportedProvider,
) =>
  importedProvider.providerId !== getCloudManagedProviderId(provider) ||
  importedProvider.sourceProviderId !== provider.providerId ||
  (importedProvider.source ?? null) !== provider.source ||
  (importedProvider.updatedAt ?? null) !== (provider.updatedAt ?? null) ||
  !sameStringList(
    importedProvider.modelIds,
    // 两侧统一清理空白和空值，避免模型长期被误判为不同步。
    getProviderModelIds(provider),
  );

export const buildCloudProviderConfig = (
  provider: DenOrgLlmProviderConnection,
): ProviderConfig => {
  const models = Object.fromEntries(
    provider.models.map((model) => {
      const next: NonNullable<ProviderConfig["models"]>[string] = {
        id: model.id,
        name: model.name,
      };
      const raw = model.config;
      for (const key of [
        "family",
        "release_date",
        "attachment",
        "reasoning",
        "temperature",
        "tool_call",
        "interleaved",
        "cost",
        "limit",
        "modalities",
        "status",
        "options",
        "headers",
        "provider",
        "variants",
      ] as const) {
        const value = raw[key];
        if (value !== undefined) {
          (next as Record<string, unknown>)[key] = value;
        }
      }
      return [model.id, next];
    }),
  );

  const next: ProviderConfig = {
    id: provider.providerId,
    name: provider.name,
    env: getCloudProviderEnv(provider.providerConfig),
  };

  // SeeWayWork Models are catalog-backed via OPENCODE_MODELS_URL. Den provisions
  // the provider + key with zero model rows — writing `models: {}` can prevent
  // the engine from keeping catalog models, so omit an empty map for openwork.
  if (Object.keys(models).length > 0 || provider.source !== "openwork") {
    next.models = models;
  }

  if (
    typeof provider.providerConfig.npm === "string" &&
    provider.providerConfig.npm.trim()
  ) {
    next.npm = provider.providerConfig.npm;
  }
  if (
    typeof provider.providerConfig.api === "string" &&
    provider.providerConfig.api.trim()
  ) {
    next.api = provider.providerConfig.api;
  }
  if (
    provider.providerConfig.options &&
    typeof provider.providerConfig.options === "object"
  ) {
    next.options = provider.providerConfig.options as Record<string, unknown>;
  }
  if (Array.isArray(provider.providerConfig.whitelist)) {
    next.whitelist = getStringList(provider.providerConfig.whitelist);
  }
  if (Array.isArray(provider.providerConfig.blacklist)) {
    next.blacklist = getStringList(provider.providerConfig.blacklist);
  }

  return next;
};

/** 为公司模型的导入或校准生成按键更新；空值用于删除旧模型项。 */
export const buildRuntimeProviderPatch = (
  provider: DenOrgLlmProviderConnection,
  localProviderId: string,
  previousProviderId?: string | null,
): Record<string, unknown> => {
  const patch: Record<string, unknown> = {};
  if (previousProviderId && previousProviderId !== localProviderId) {
    patch[previousProviderId] = null;
  }
  patch[localProviderId] = buildCloudProviderConfig(provider) as unknown as Record<string, unknown>;
  return patch;
};

export const formatConfigWithoutCloudProvider = (
  raw: string,
  providerId: string,
  disabledProviders: string[],
) => {
  let updated = raw.trim()
    ? raw
    : '{}\n';
  updated = removeCloudProviderComment(updated, providerId);
  const providerEdits = modify(updated, ["provider", providerId], undefined, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  });
  updated = applyEdits(updated, providerEdits);

  const nextDisabled = disabledProviders.filter((id) => id !== providerId);
  const disabledEdits = modify(updated, ["disabled_providers"], nextDisabled, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  });
  updated = applyEdits(updated, disabledEdits);
  return updated.endsWith("\n") ? updated : `${updated}\n`;
};
