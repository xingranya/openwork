/**
 * Den 管理后台的自定义模型服务引导配置。
 *
 * 管理员填写少量字段描述 OpenAI 或 Anthropic 兼容接口，系统生成 API 已支持的
 * 公司模型目录风格配置；高级场景仍可直接粘贴或编辑 JSON。
 */

type JsonRecord = Record<string, unknown>;

export const GUIDED_PROVIDER_NPM = "@ai-sdk/openai-compatible";
export const GUIDED_PROVIDER_NPM_OPENAI = "@ai-sdk/openai";
export const GUIDED_PROVIDER_NPM_ANTHROPIC = "@ai-sdk/anthropic";

const GUIDED_PROVIDER_NPM_PACKAGES = new Set([
    GUIDED_PROVIDER_NPM,
    GUIDED_PROVIDER_NPM_OPENAI,
    GUIDED_PROVIDER_NPM_ANTHROPIC,
]);

const GUIDED_PROVIDER_CONFIG_KEYS = new Set(["id", "name", "npm", "env", "api", "doc"]);
const GUIDED_MODEL_KEYS = new Set(["id", "name"]);

export type GuidedCustomProviderFields = {
    providerId: string;
    baseUrl: string;
    modelIds: string[];
    envNames: string[];
    npm: string;
    protocol: GuidedProviderProtocol;
};

export type GuidedProviderProtocol = "openai" | "anthropic";

export function guidedProviderNpmForProtocol(protocol: GuidedProviderProtocol): string {
    return protocol === "anthropic" ? GUIDED_PROVIDER_NPM_ANTHROPIC : GUIDED_PROVIDER_NPM;
}

export function guidedProviderProtocolFromNpm(npm: string): GuidedProviderProtocol | null {
    if (npm === GUIDED_PROVIDER_NPM_ANTHROPIC) return "anthropic";
    if (npm === GUIDED_PROVIDER_NPM || npm === GUIDED_PROVIDER_NPM_OPENAI) return "openai";
    return null;
}

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function slugifyProviderId(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

export function isValidGuidedProviderId(value: string): boolean {
    return /^[a-z0-9][a-z0-9_-]*$/i.test(value);
}

export function parseGuidedModelIds(text: string): string[] {
    return [
        ...new Set(
            text
                .split(/[\n,]+/)
                .map((entry) => entry.trim())
                .filter(Boolean),
        ),
    ];
}

export function buildGuidedProviderEnvName(providerId: string): string {
    const normalized = providerId
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
    return `${normalized || "CUSTOM_PROVIDER"}_API_KEY`;
}

export function validateGuidedCustomProvider(input: {
    providerId: string;
    baseUrl: string;
    modelIds: string[];
    protocol?: GuidedProviderProtocol;
}): string | null {
    if (!input.providerId.trim()) {
        return "请填写模型服务 ID，例如 azure-foundry。";
    }
    if (!isValidGuidedProviderId(input.providerId.trim())) {
        return "模型服务 ID 只能包含英文字母、数字、短横线和下划线。";
    }
    if (!input.baseUrl.trim()) {
        return input.protocol === "anthropic"
            ? "请填写 Anthropic 兼容接口的基础地址。"
            : "请填写 OpenAI 兼容接口的基础地址。";
    }
    if (!/^https?:\/\//i.test(input.baseUrl.trim())) {
        return "基础地址必须以 http:// 或 https:// 开头。";
    }
    if (input.modelIds.length === 0) {
        return "请至少填写一个模型 ID。";
    }
    return null;
}

export function buildGuidedCustomProviderConfig(input: {
    providerId: string;
    name: string;
    baseUrl: string;
    modelIds: string[];
    envNames?: string[] | null;
    /** AI SDK 软件包；验证时可能切换为 OpenAI 软件包。 */
    npm?: string | null;
    protocol?: GuidedProviderProtocol;
}): JsonRecord {
    const providerId = input.providerId.trim();
    const envNames = (input.envNames ?? [])
        .map((entry) => entry.trim())
        .filter(Boolean);
    return {
        id: providerId,
        name: input.name.trim() || providerId,
        npm: input.npm && GUIDED_PROVIDER_NPM_PACKAGES.has(input.npm)
            ? input.npm
            : guidedProviderNpmForProtocol(input.protocol ?? "openai"),
        env: envNames.length > 0 ? envNames : [buildGuidedProviderEnvName(providerId)],
        api: input.baseUrl.trim().replace(/\/+$/, ""),
        models: input.modelIds.map((modelId) => ({ id: modelId, name: modelId })),
    };
}

/**
 * 尝试把模型服务配置还原为引导表单字段。若配置包含表单无法表示的内容，
 * 返回 null 并改用 JSON 编辑，避免静默丢失数据。
 */
export function readGuidedCustomProviderFields(
    config: unknown,
): GuidedCustomProviderFields | null {
    if (!isRecord(config)) {
        return null;
    }

    const providerId = asString(config.id);
    if (!providerId) {
        return null;
    }

    const npm = asString(config.npm);
    if (!npm || !GUIDED_PROVIDER_NPM_PACKAGES.has(npm)) {
        return null;
    }
    const protocol = guidedProviderProtocolFromNpm(npm);
    if (!protocol) {
        return null;
    }

    for (const key of Object.keys(config)) {
        if (key === "models") continue;
        if (!GUIDED_PROVIDER_CONFIG_KEYS.has(key)) {
            return null;
        }
    }

    const baseUrl = asString(config.api);
    if (!baseUrl) {
        return null;
    }

    const env = Array.isArray(config.env)
        ? config.env.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        : [];

    const models = Array.isArray(config.models) ? config.models : null;
    if (!models || models.length === 0) {
        return null;
    }

    const modelIds: string[] = [];
    for (const model of models) {
        if (typeof model === "string") {
            modelIds.push(model);
            continue;
        }
        if (!isRecord(model)) {
            return null;
        }
        const id = asString(model.id);
        if (!id) {
            return null;
        }
        const name = asString(model.name);
        if (name !== null && name !== id) {
            return null;
        }
        for (const key of Object.keys(model)) {
            if (!GUIDED_MODEL_KEYS.has(key)) {
                return null;
            }
        }
        modelIds.push(id);
    }

    return {
        providerId,
        baseUrl,
        modelIds,
        envNames: env,
        npm,
        protocol,
    };
}

/**
 * 从粘贴的模型服务 JSON 中宽松提取环境变量名，供编辑器逐项显示凭据输入。
 * 文本无法解析或没有环境变量时返回空数组。
 */
export function readEnvNamesFromCustomProviderText(text: string): string[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return [];
    }

    if (!isRecord(parsed)) {
        return [];
    }

    let block: JsonRecord = parsed;
    if (isRecord(parsed.provider)) {
        const entries = Object.values(parsed.provider).filter(isRecord);
        if (entries.length !== 1) {
            return [];
        }
        block = entries[0];
    }

    return Array.isArray(block.env)
        ? block.env.filter(
              (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
          )
        : [];
}

/**
 * 把粘贴的 JSON 解析为引导表单字段。支持单独的模型服务配置块，也支持
 * opencode 风格的 `{ "provider": { "<id>": { ... } } }` 外层结构。
 */
export function readGuidedCustomProviderFieldsFromText(
    text: string,
): GuidedCustomProviderFields | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return null;
    }

    if (isRecord(parsed) && isRecord(parsed.provider)) {
        const entries = Object.entries(parsed.provider).filter(
            (entry): entry is [string, JsonRecord] => isRecord(entry[1]),
        );
        if (entries.length !== 1) {
            return null;
        }
        const [providerId, block] = entries[0];
        return readGuidedCustomProviderFields({ id: providerId, ...block });
    }

    return readGuidedCustomProviderFields(parsed);
}
