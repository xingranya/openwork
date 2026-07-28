"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
    ArrowLeft,
    CodeXml,
    Cpu,
    Search,
    User,
    Users,
} from "lucide-react";
import { DenButton } from "../../_components/ui/button";
import { DenCombobox } from "../../_components/ui/combobox";
import { DenInput } from "../../_components/ui/input";
import { DenSelectableRow } from "../../_components/ui/selectable-row";
import { UnderlineTabs } from "../../_components/ui/tabs";
import { DenTextarea } from "../../_components/ui/textarea";
import { getErrorMessage, getRequestError, requestJson } from "../../_lib/den-flow";
import {
    getLlmProviderRoute,
    getLlmProvidersRoute,
} from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import {
    buildGuidedCustomProviderConfig,
    buildGuidedProviderEnvName,
    modelConfigSupportsImageInput,
    parseGuidedModelIds,
    readEnvNamesFromCustomProviderText,
    readGuidedCustomProviderFields,
    readGuidedCustomProviderFieldsFromText,
    slugifyProviderId,
    validateGuidedCustomProvider,
    type GuidedProviderProtocol,
} from "./llm-provider-guided";
import {
    buildCustomProviderTemplate,
    buildEditableCustomProviderText,
    getProviderApiBase,
    requestLlmProviderTestConnection,
    type LlmProviderModelVerification,
    type LlmProviderProbeResult,
    getProviderDocUrl,
    getProviderEnvNames,
    getProviderNpmPackage,
    requestLlmProviderCatalog,
    requestLlmProviderCatalogDetail,
    useOrgLlmProviders,
    type DenLlmProvider,
    type DenModelsDevProviderDetail,
    type DenModelsDevProviderSummary,
} from "./llm-provider-data";

const SOURCE_TABS = [
    { value: "models_dev" as const, label: "国内常用服务", icon: Cpu },
    { value: "custom" as const, label: "自定义协议", icon: CodeXml },
];

const CUSTOM_PROTOCOL_OPTIONS = [
    {
        value: "openai",
        label: "OpenAI 兼容协议",
        description: "适用于兼容 OpenAI 接口格式的模型服务",
    },
    {
        value: "anthropic",
        label: "Anthropic 兼容协议",
        description: "适用于兼容 Anthropic 接口格式的模型服务",
    },
];

type EditableLlmProviderSource = (typeof SOURCE_TABS)[number]["value"];

function getLockMemberId(
    provider: DenLlmProvider | null,
    currentMemberId: string | null,
) {
    return provider?.createdByOrgMembershipId ?? currentMemberId;
}

function DefaultAccessToggle({
    checked,
    onChange,
}: {
    checked: boolean;
    onChange: (checked: boolean) => void;
}) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label="默认对所有成员启用"
            onClick={() => onChange(!checked)}
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-[#0f172a]/20 focus:ring-offset-2 ${
                checked
                    ? "border-[#0f172a] bg-[#0f172a]"
                    : "border-gray-200 bg-gray-200"
            }`}
        >
            <span
                aria-hidden="true"
                className={`inline-block h-5 w-5 rounded-full bg-white shadow-[0_2px_6px_-1px_rgba(15,23,42,0.3)] transition-transform ${
                    checked ? "translate-x-6" : "translate-x-1"
                }`}
            />
        </button>
    );
}

export function LlmProviderEditorScreen({
    llmProviderId,
}: {
    llmProviderId?: string;
}) {
    const router = useRouter();
    const { orgId, orgSlug, orgContext, runReauthableAction } = useOrgDashboard();
    const { llmProviders, busy, error, reloadProviders } =
        useOrgLlmProviders(orgId);
    const provider = useMemo(
        () =>
            llmProviderId
                ? (llmProviders.find((entry) => entry.id === llmProviderId) ??
                  null)
                : null,
        [llmProviderId, llmProviders],
    );
    const [source, setSource] = useState<EditableLlmProviderSource>("models_dev");
    const [accessTab, setAccessTab] = useState<"teams" | "people">("teams");
    const [accessQuery, setAccessQuery] = useState("");
    const [catalogProviders, setCatalogProviders] = useState<
        DenModelsDevProviderSummary[]
    >([]);
    const [catalogBusy, setCatalogBusy] = useState(false);
    const [catalogError, setCatalogError] = useState<string | null>(null);
    const [selectedProviderId, setSelectedProviderId] = useState("");
    const [catalogDetail, setCatalogDetail] =
        useState<DenModelsDevProviderDetail | null>(null);
    const [detailBusy, setDetailBusy] = useState(false);
    const [detailError, setDetailError] = useState<string | null>(null);
    const [providerName, setProviderName] = useState("");
    const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
    const [imageInputModelIds, setImageInputModelIds] = useState<string[]>([]);
    const [catalogCustomModelsText, setCatalogCustomModelsText] = useState("");
    const [modelQuery, setModelQuery] = useState("");
    const [customConfigText, setCustomConfigText] = useState(
        buildCustomProviderTemplate(),
    );
    const [customMode, setCustomMode] = useState<"form" | "json">("form");
    const [customProtocol, setCustomProtocol] = useState<GuidedProviderProtocol>("openai");
    const [customProviderId, setCustomProviderId] = useState("");
    const [customProviderIdTouched, setCustomProviderIdTouched] = useState(false);
    const [customBaseUrl, setCustomBaseUrl] = useState("");
    const [customModelsText, setCustomModelsText] = useState("");
    const [customEnvNames, setCustomEnvNames] = useState<string[]>([]);
    const [customJsonHint, setCustomJsonHint] = useState<string | null>(null);
    const [probeState, setProbeState] = useState<"idle" | "probing" | "ok" | "failed">("idle");
    const [probeResult, setProbeResult] = useState<LlmProviderProbeResult | null>(null);
    const [selectedCustomModelIds, setSelectedCustomModelIds] = useState<string[]>([]);
    const [customModelQuery, setCustomModelQuery] = useState("");
    const [customManualModels, setCustomManualModels] = useState(false);
    const lastProbeKeyRef = useRef("");
    // Azure 目录服务填写资源名称和密钥后，只显示该资源实际部署的模型。
    const [azureProbeState, setAzureProbeState] = useState<"idle" | "probing" | "ok" | "failed">("idle");
    const [azureProbeResult, setAzureProbeResult] = useState<LlmProviderProbeResult | null>(null);
    const lastAzureProbeKeyRef = useRef("");
    const [apiKey, setApiKey] = useState("");
    const [apiKeyValues, setApiKeyValues] = useState<Record<string, string>>({});
    const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
    const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
    const [defaultEnabled, setDefaultEnabled] = useState(true);
    const [saveBusy, setSaveBusy] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [verifyBusy, setVerifyBusy] = useState(false);
    const [verifyFailures, setVerifyFailures] = useState<LlmProviderModelVerification[]>([]);
    // 保存精确输入对应的验证结果，确认继续保存时不重复发起模型请求。
    const verifiedRef = useRef<{ key: string; npm: string } | null>(null);

    useEffect(() => {
        if (!orgId) {
            setCatalogProviders([]);
            return;
        }

        let canceled = false;
        setCatalogBusy(true);
        setCatalogError(null);
        void requestLlmProviderCatalog(orgId)
            .then((providers) => {
                if (!canceled) {
                    setCatalogProviders(providers);
                }
            })
            .catch((loadError) => {
                if (!canceled) {
                    setCatalogError(getErrorMessage(loadError, "加载模型服务目录失败。"));
                }
            })
            .finally(() => {
                if (!canceled) {
                    setCatalogBusy(false);
                }
            });

        return () => {
            canceled = true;
        };
    }, [orgId]);

    useEffect(() => {
        if (provider) {
            setSource(provider.source === "custom" ? "custom" : "models_dev");
            setSelectedProviderId(provider.providerId);
            setProviderName(provider.name);
            setSelectedModelIds(provider.models.map((entry) => entry.id));
            setImageInputModelIds(
                provider.models
                    .filter((entry) => modelConfigSupportsImageInput(entry.config))
                    .map((entry) => entry.id),
            );
            setCatalogCustomModelsText("");
            setSelectedMemberIds(
                provider.access.members.map((entry) => entry.orgMembershipId),
            );
            setSelectedTeamIds(
                provider.access.teams.map((entry) => entry.teamId),
            );
            setDefaultEnabled(provider.defaultEnabled);
            setCustomConfigText(
                provider.source === "custom"
                    ? buildEditableCustomProviderText(provider)
                    : buildCustomProviderTemplate(),
            );
            if (provider.source === "custom") {
                // 简单配置在引导表单中打开；复杂配置改用 JSON 编辑器，避免丢失字段。
                const guided = readGuidedCustomProviderFields({
                    ...provider.providerConfig,
                    models: provider.models.map((entry) => entry.config),
                });
                if (guided) {
                    setCustomMode("form");
                    setCustomProviderId(guided.providerId);
                    setCustomProviderIdTouched(true);
                    setCustomBaseUrl(guided.baseUrl);
                    setCustomModelsText(guided.modelIds.join("\n"));
                    setImageInputModelIds(guided.imageInputModelIds ?? []);
                    setCustomEnvNames(guided.envNames);
                    setCustomProtocol(guided.protocol);
                } else {
                    setCustomMode("json");
                }
            }
            setCustomJsonHint(null);
            setApiKey("");
            setApiKeyValues({});
            return;
        }

        setSource("models_dev");
        setSelectedProviderId("");
        setProviderName("");
        setSelectedModelIds([]);
        setImageInputModelIds([]);
        setCatalogCustomModelsText("");
        setSelectedMemberIds(
            orgContext?.currentMember.id ? [orgContext.currentMember.id] : [],
        );
        setSelectedTeamIds([]);
        setDefaultEnabled(true);
        setCustomConfigText(buildCustomProviderTemplate());
        setCustomMode("form");
        setCustomProtocol("openai");
        setCustomProviderId("");
        setCustomProviderIdTouched(false);
        setCustomBaseUrl("");
        setCustomModelsText("");
        setCustomEnvNames([]);
        setCustomJsonHint(null);
        setApiKey("");
        setApiKeyValues({});
    }, [orgContext?.currentMember.id, provider]);

    useEffect(() => {
        if (source !== "models_dev" || !orgId || !selectedProviderId) {
            setCatalogDetail(null);
            setDetailError(null);
            setDetailBusy(false);
            return;
        }

        let canceled = false;
        setDetailBusy(true);
        setDetailError(null);
        void requestLlmProviderCatalogDetail(orgId, selectedProviderId)
            .then((detail) => {
                if (!canceled) {
                    setCatalogDetail(detail);
                }
            })
            .catch((loadError) => {
                if (!canceled) {
                    setCatalogDetail(null);
                    setDetailError(getErrorMessage(loadError, "加载模型服务详情失败。"));
                }
            })
            .finally(() => {
                if (!canceled) {
                    setDetailBusy(false);
                }
            });

        return () => {
            canceled = true;
        };
    }, [orgId, selectedProviderId, source]);

    const currentMemberId = orgContext?.currentMember.id ?? null;
    const lockedMemberId = getLockMemberId(provider, currentMemberId);

    // models.dev 列出完整 Azure 目录，但实际请求只能使用公司资源中的部署。
    const isAzureCatalog =
        source === "models_dev" &&
        catalogDetail !== null &&
        getProviderNpmPackage(catalogDetail.config) === "@ai-sdk/azure";
    const azureCatalogEnvNames = isAzureCatalog
        ? getProviderEnvNames(catalogDetail.config)
        : [];
    const azureResourceEnv =
        azureCatalogEnvNames.find((name) => name.includes("RESOURCE_NAME")) ?? null;
    const azureKeyEnv =
        azureCatalogEnvNames.find((name) => name !== azureResourceEnv) ?? null;
    const azureResourceName = azureResourceEnv
        ? (apiKeyValues[azureResourceEnv] ?? "").trim()
        : "";
    const azureApiKey = azureKeyEnv ? (apiKeyValues[azureKeyEnv] ?? "").trim() : "";

    useEffect(() => {
        if (!isAzureCatalog) {
            setAzureProbeState("idle");
            setAzureProbeResult(null);
            lastAzureProbeKeyRef.current = "";
            return;
        }
        if (
            !azureResourceName ||
            !azureApiKey ||
            !/^[a-z0-9][a-z0-9.-]*$/i.test(azureResourceName)
        ) {
            setAzureProbeState("idle");
            setAzureProbeResult(null);
            return;
        }
        const probeKey = `${azureResourceName}::${azureApiKey}`;
        if (lastAzureProbeKeyRef.current === probeKey) return;
        const timer = window.setTimeout(() => {
            lastAzureProbeKeyRef.current = probeKey;
            setAzureProbeState("probing");
            requestLlmProviderTestConnection({
                api: `https://${azureResourceName}.openai.azure.com`,
                apiKey: azureApiKey,
            })
                .then((result) => {
                    if (lastAzureProbeKeyRef.current !== probeKey) return;
                    setAzureProbeResult(result);
                    setAzureProbeState(result.ok ? "ok" : "failed");
                    if (result.ok) {
                        // 移除该资源没有实际提供的部署。
                        setSelectedModelIds((current) =>
                            current.filter((id) =>
                                result.models.some((model) => model.id === id),
                            ),
                        );
                    }
                })
                .catch(() => {
                    if (lastAzureProbeKeyRef.current !== probeKey) return;
                    setAzureProbeResult(null);
                    setAzureProbeState("failed");
                });
        }, 700);
        return () => window.clearTimeout(timer);
    }, [isAzureCatalog, azureResourceName, azureApiKey]);

    // Azure 探测成功后显示真实部署，否则使用 models.dev 目录。
    const catalogModelOptions = useMemo(() => {
        if (isAzureCatalog && azureProbeState === "ok" && azureProbeResult) {
            return azureProbeResult.models.map((model) => ({
                id: model.id,
                name: model.id,
                config: {},
            }));
        }
        return catalogDetail?.models ?? [];
    }, [isAzureCatalog, azureProbeState, azureProbeResult, catalogDetail?.models]);

    const filteredModels = useMemo(() => {
        const normalizedQuery = modelQuery.trim().toLowerCase();
        if (!normalizedQuery) {
            return catalogModelOptions;
        }

        return catalogModelOptions.filter(
            (model) =>
                model.name.toLowerCase().includes(normalizedQuery) ||
                model.id.toLowerCase().includes(normalizedQuery),
        );
    }, [catalogModelOptions, modelQuery]);

    const filteredTeams = useMemo(() => {
        const teams = orgContext?.teams ?? [];
        const normalizedQuery = accessQuery.trim().toLowerCase();
        if (!normalizedQuery) {
            return teams;
        }

        return teams.filter((team) =>
            team.name.toLowerCase().includes(normalizedQuery),
        );
    }, [accessQuery, orgContext?.teams]);

    const filteredMembers = useMemo(() => {
        const members = orgContext?.members ?? [];
        const normalizedQuery = accessQuery.trim().toLowerCase();
        if (!normalizedQuery) {
            return members;
        }

        return members.filter(
            (member) =>
                member.user.name.toLowerCase().includes(normalizedQuery) ||
                member.user.email.toLowerCase().includes(normalizedQuery),
        );
    }, [accessQuery, orgContext?.members]);

    const catalogProviderOptions = useMemo(
        () =>
            catalogProviders.map((catalogProvider) => ({
                value: catalogProvider.id,
                label: catalogProvider.name,
                description: catalogProvider.id,
                meta: `${catalogProvider.modelCount} 个模型`,
            })),
        [catalogProviders],
    );

    const resolvedCustomProviderId = customProviderIdTouched
        ? customProviderId.trim()
        : slugifyProviderId(providerName);

    const resolvedCatalogModelIds = [
        ...new Set([
            ...selectedModelIds,
            ...parseGuidedModelIds(catalogCustomModelsText),
        ]),
    ];

    // 多环境变量服务为每个变量显示独立输入，并通过 `apiKeys` 一并保存。
    const credentialEnvNames =
        source === "models_dev"
            ? catalogDetail
                ? getProviderEnvNames(catalogDetail.config)
                : provider && provider.source === "models_dev"
                  ? getProviderEnvNames(provider.providerConfig)
                  : []
            : customMode === "form"
              ? customEnvNames.length > 0
                  ? customEnvNames
                  : resolvedCustomProviderId
                    ? [buildGuidedProviderEnvName(resolvedCustomProviderId)]
                    : []
              : readEnvNamesFromCustomProviderText(customConfigText);

    // 多环境变量服务沿用 models.dev 的首个变量作为接口探测凭据。
    const probeCredential =
        credentialEnvNames.length > 1
            ? (apiKeyValues[credentialEnvNames[0]] ?? "").trim()
            : apiKey.trim();

    // 优先保存探测结果中选择的模型，手动模式则解析输入文本。
    const resolvedCustomModelIds =
        probeState === "ok" && !customManualModels
            ? selectedCustomModelIds
            : parseGuidedModelIds(customModelsText);
    const configurableModelIds = source === "models_dev"
        ? resolvedCatalogModelIds
        : customMode === "form"
          ? resolvedCustomModelIds
          : [];
    const activeImageInputModelIds = imageInputModelIds.filter((modelId) =>
        configurableModelIds.includes(modelId),
    );
    const configurableModelIdsKey = configurableModelIds.join("\u0000");

    useEffect(() => {
        const allowedModelIds = new Set(configurableModelIds);
        setImageInputModelIds((current) => {
            const next = current.filter((modelId) => allowedModelIds.has(modelId));
            return next.length === current.length ? current : next;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- 模型 ID 集合稳定后再清理已取消模型的能力选择
    }, [configurableModelIdsKey]);

    // 仅当输入仍与失败验证一致时允许继续保存，修改后必须重新验证。
    const currentVerifyKey = [
        customBaseUrl.trim(),
        probeCredential,
        resolvedCustomModelIds.join(","),
    ].join("::");
    const saveAnywayArmed =
        verifyFailures.length > 0 && verifiedRef.current?.key === currentVerifyKey;

    // 基础地址和密钥齐全后延迟探测接口，并加载接口实际提供的模型。
    useEffect(() => {
        if (
            source !== "custom" ||
            customMode !== "form" ||
            (customProtocol !== "openai" && customProtocol !== "anthropic")
        ) {
            setProbeState("idle");
            setProbeResult(null);
            return;
        }
        const api = customBaseUrl.trim();
        const key = probeCredential;
        if (!api) {
            setProbeState("idle");
            setProbeResult(null);
            return;
        }
        const probeKey = `${customProtocol}::${api}::${key}`;
        if (lastProbeKeyRef.current === probeKey) return;
        const timer = window.setTimeout(() => {
            lastProbeKeyRef.current = probeKey;
            setProbeState("probing");
            requestLlmProviderTestConnection({ api, apiKey: key, protocol: customProtocol })
                .then((result) => {
                    if (lastProbeKeyRef.current !== probeKey) return;
                    setProbeResult(result);
                    setProbeState(result.ok ? "ok" : "failed");
                    if (result.ok) {
                        if (result.normalizedApi && result.normalizedApi !== api) {
                            // 记录修正后的地址，避免字段更新后重复探测。
                            lastProbeKeyRef.current = `${customProtocol}::${result.normalizedApi}::${key}`;
                            setCustomBaseUrl(result.normalizedApi);
                        }
                        // 已保存的模型仍存在时保留选择。
                        setSelectedCustomModelIds((current) => {
                            const base = current.length
                                ? current
                                : parseGuidedModelIds(customModelsText);
                            return base.filter((id) =>
                                result.models.some((model) => model.id === id),
                            );
                        });
                    }
                })
                .catch(() => {
                    if (lastProbeKeyRef.current !== probeKey) return;
                    setProbeResult(null);
                    setProbeState("failed");
                });
        }, 700);
        return () => window.clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在接口或密钥变化时探测
    }, [source, customMode, customProtocol, customBaseUrl, probeCredential]);

    const filteredProbeModels = useMemo(() => {
        const models = probeResult?.models ?? [];
        const query = customModelQuery.trim().toLowerCase();
        if (!query) return models;
        return models.filter((model) => model.id.toLowerCase().includes(query));
    }, [customModelQuery, probeResult?.models]);

    function switchCustomModeToJson() {
        const modelIds = resolvedCustomModelIds;
        if (!validateGuidedCustomProvider({
            providerId: resolvedCustomProviderId,
            baseUrl: customBaseUrl,
            modelIds,
            protocol: customProtocol,
        })) {
            setCustomConfigText(
                JSON.stringify(
                    buildGuidedCustomProviderConfig({
                        providerId: resolvedCustomProviderId,
                        name: providerName,
                        baseUrl: customBaseUrl,
                        modelIds,
                        imageInputModelIds: activeImageInputModelIds,
                        envNames: customEnvNames,
                        protocol: customProtocol,
                    }),
                    null,
                    2,
                ),
            );
        }
        setCustomJsonHint(null);
        setCustomMode("json");
    }

    function switchCustomModeToForm() {
        const guided = readGuidedCustomProviderFieldsFromText(customConfigText);
        if (!guided) {
            setCustomJsonHint(
                "此配置包含表单无法表示的高级字段，请继续使用 JSON 编辑。",
            );
            return;
        }
        setCustomProviderId(guided.providerId);
        setCustomProviderIdTouched(true);
        setCustomBaseUrl(guided.baseUrl);
        setCustomModelsText(guided.modelIds.join("\n"));
        setImageInputModelIds(guided.imageInputModelIds ?? []);
        setCustomEnvNames(guided.envNames);
        setCustomProtocol(guided.protocol);
        setCustomJsonHint(null);
        setCustomMode("form");
    }

    async function saveProvider() {
        if (!orgId) {
            setSaveError("没有找到公司信息。");
            return;
        }

        if (provider?.source === "openwork") {
            setSaveError("公司统一模型服务由公司模型页面管理。");
            return;
        }

        if (!providerName.trim()) {
            setSaveError("请填写模型服务名称。");
            return;
        }

        if (source === "models_dev") {
            if (!selectedProviderId) {
                setSaveError("请选择模型服务。");
                return;
            }
            if (!resolvedCatalogModelIds.length) {
                setSaveError("请至少选择或填写一个模型 ID。");
                return;
            }
        }

        if (source === "custom" && customMode === "form") {
            const validationError = validateGuidedCustomProvider({
                providerId: resolvedCustomProviderId,
                baseUrl: customBaseUrl,
                modelIds: resolvedCustomModelIds,
                protocol: customProtocol,
            });
            if (validationError) {
                setSaveError(validationError);
                return;
            }
        }

        if (source === "custom" && customMode === "json" && !customConfigText.trim()) {
            setSaveError("请粘贴自定义模型服务配置。");
            return;
        }

        // 保存前逐个验证所选模型。Azure 上拒绝 max_tokens 的模型会切换为
        // OpenAI 请求格式；两种格式都失败时显示模型错误并要求人工确认。
        let guidedNpm: string | null = null;
        if (
            source === "custom" &&
            customMode === "form" &&
            customProtocol === "openai" &&
            probeCredential
        ) {
            const verifyKey = [
                customBaseUrl.trim(),
                probeCredential,
                resolvedCustomModelIds.join(","),
            ].join("::");
            if (verifiedRef.current?.key === verifyKey) {
                guidedNpm = verifiedRef.current.npm;
            } else {
                setSaveError(null);
                setVerifyBusy(true);
                setSaveBusy(true);
                try {
                    const result = await requestLlmProviderTestConnection({
                        api: customBaseUrl.trim(),
                        apiKey: probeCredential,
                        modelIds: resolvedCustomModelIds,
                    });
                    const verifications = result.verifications;
                    const npm = verifications.some(
                        (entry) => entry.status === "adjusted",
                    )
                        ? "@ai-sdk/openai"
                        : "@ai-sdk/openai-compatible";
                    verifiedRef.current = { key: verifyKey, npm };
                    guidedNpm = npm;
                    const failures = verifications.filter(
                        (entry) => entry.status === "failed",
                    );
                    setVerifyFailures(failures);
                    if (failures.length > 0) {
                        setSaveError(
                            "部分模型未通过连接测试。请修改模型列表，或确认仍要保存。",
                        );
                        return;
                    }
                } catch {
                    // 验证用于发现配置问题；网络或超时异常不阻止保存。
                    verifiedRef.current = { key: verifyKey, npm: "@ai-sdk/openai-compatible" };
                    setVerifyFailures([]);
                } finally {
                    setVerifyBusy(false);
                    setSaveBusy(false);
                }
            }
        }

        setSaveError(null);
        try {
            await runReauthableAction("save-llm-provider", async () => {
            setSaveBusy(true);
            const body: Record<string, unknown> = {
                name: providerName.trim(),
                source,
                defaultEnabled,
                memberIds: [...new Set(selectedMemberIds)],
                teamIds: [...new Set(selectedTeamIds)],
            };

            if (source === "models_dev") {
                body.providerId = selectedProviderId;
                body.modelIds = resolvedCatalogModelIds;
            } else if (customMode === "form") {
                body.customConfig = buildGuidedCustomProviderConfig({
                    providerId: resolvedCustomProviderId,
                    name: providerName,
                    baseUrl: customBaseUrl,
                    modelIds: resolvedCustomModelIds,
                    imageInputModelIds: activeImageInputModelIds,
                    envNames: customEnvNames,
                    npm: guidedNpm,
                    protocol: customProtocol,
                });
            } else {
                body.customConfigText = customConfigText;
            }
            if (source === "models_dev" || customMode === "form") {
                body.imageInputModelIds = activeImageInputModelIds;
            }

            if (credentialEnvNames.length > 1) {
                // 空白变量不提交，由服务端保留已保存的值。
                const entries = credentialEnvNames
                    .map((envName) => [envName, (apiKeyValues[envName] ?? "").trim()] as const)
                    .filter(([, value]) => value.length > 0);
                if (entries.length > 0) {
                    body.apiKeys = Object.fromEntries(entries);
                }
            } else if (apiKey.trim() || !provider) {
                body.apiKey = apiKey.trim();
            }

            const path = provider
                ? `/v1/llm-providers/${encodeURIComponent(provider.id)}`
                : `/v1/llm-providers`;
            const method = provider ? "PATCH" : "POST";

            const { response, payload } = await requestJson(
                path,
                {
                    method,
                    body: JSON.stringify(body),
                },
                20000,
            );

            if (!response.ok) {
                throw getRequestError(payload, response, `保存模型服务失败（${response.status}）。`);
            }

            const nextProvider =
                payload &&
                typeof payload === "object" &&
                payload &&
                "llmProvider" in payload &&
                payload.llmProvider &&
                typeof payload.llmProvider === "object"
                    ? (payload.llmProvider as { id?: unknown })
                    : null;
            const nextProviderId =
                typeof nextProvider?.id === "string"
                    ? nextProvider.id
                    : (provider?.id ?? null);
            if (!nextProviderId) {
                throw new Error(
                    "模型服务已保存，但公司服务没有返回模型服务 ID。",
                );
            }

            await reloadProviders();
            router.push(getLlmProviderRoute(orgSlug, nextProviderId));
            router.refresh();
            });
        } catch (nextError) {
            setSaveError(
                nextError instanceof Error
                    ? nextError.message
                    : "保存模型服务失败。",
            );
        } finally {
            setSaveBusy(false);
        }
    }

    if (busy && llmProviderId && !provider) {
        return (
            <div className="mx-auto max-w-[1180px] px-6 py-8 md:px-8">
                <div className="rounded-[28px] border border-gray-200 bg-white px-6 py-10 text-[15px] text-gray-500">
                    正在加载模型服务详情...
                </div>
            </div>
        );
    }

    if (llmProviderId && !provider) {
        return (
            <div className="mx-auto max-w-[1180px] px-6 py-8 md:px-8">
                <div className="rounded-[28px] border border-red-200 bg-red-50 px-6 py-4 text-[15px] text-red-700">
                    {getErrorMessage(error, "没有找到这个模型服务。")}
                </div>
            </div>
        );
    }

    const providerDoc = catalogDetail
        ? getProviderDocUrl(catalogDetail.config)
        : null;
    const providerApiBase = catalogDetail
        ? getProviderApiBase(catalogDetail.config)
        : null;

    // 独立凭据区与自定义模型引导表单共用以下输入组件。
    const credentialFields = credentialEnvNames.length > 1 ? (
                    <div className="grid gap-6">
                        <p className="text-[14px] text-gray-500">
                            此模型服务需要多个环境变量。请分别填写；留空的变量会保留原值。
                        </p>
                        {credentialEnvNames.map((envName) => {
                            const configured =
                                provider?.configuredEnvKeys.includes(envName) ??
                                false;
                            return (
                                <label key={envName} className="grid gap-3">
                                    <span className="flex flex-wrap items-center gap-2 text-[14px] font-medium text-gray-700">
                                        <code className="rounded bg-gray-100 px-2 py-0.5 font-mono text-[12px]">
                                            {envName}
                                        </code>
                                        {configured ? (
                                            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700">
                                                已保存
                                            </span>
                                        ) : null}
                                    </span>
                                    <DenInput
                                        type="password"
                                        value={apiKeyValues[envName] ?? ""}
                                        onChange={(event) =>
                                            setApiKeyValues((current) => ({
                                                ...current,
                                                [envName]: event.target.value,
                                            }))
                                        }
                                        placeholder={
                                            configured
                                                ? "留空以保留当前值"
                                                : `填写 ${envName} 的值`
                                        }
                                    />
                                </label>
                            );
                        })}
                    </div>
                ) : (
                    <label className="grid gap-3">
                        <span className="text-[14px] font-medium text-gray-700">
                            API 密钥或凭据
                        </span>
                        <DenInput
                            type="password"
                            value={apiKey}
                            onChange={(event) => setApiKey(event.target.value)}
                            placeholder={
                                provider?.hasApiKey
                                    ? "留空以保留当前凭据"
                                    : "粘贴模型服务凭据"
                            }
                        />
                    </label>
                );

    return (
        <div className="mx-auto max-w-[1180px] px-6 py-8 md:px-8">
            <div className="mb-8 flex flex-col gap-3">
                <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                    {provider ? "编辑模型服务" : "添加模型服务"}
                </p>
                <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                    <div>
                        <h1 className="text-[34px] font-semibold tracking-[-0.07em] text-gray-950">
                            {provider
                                ? (providerName.trim() || provider.name)
                                : "添加模型服务"}
                        </h1>
                        <p className="mt-3 max-w-[720px] text-[16px] leading-8 text-gray-500">
                            选择国内常用服务，或配置自定义协议，再设置模型和使用范围。
                        </p>
                    </div>
                </div>
            </div>

            <div className="mb-8 flex items-center justify-between gap-4">
                <Link
                    href={
                        provider
                            ? getLlmProviderRoute(orgSlug, provider.id)
                            : getLlmProvidersRoute(orgSlug)
                    }
                    className="inline-flex items-center gap-2 text-[15px] font-medium text-gray-500 transition hover:text-gray-900"
                >
                    <ArrowLeft className="h-5 w-5" />
                    返回
                </Link>

                <DenButton
                    loading={saveBusy}
                    onClick={() => void saveProvider()}
                >
                    {verifyBusy
                        ? "正在验证模型..."
                        : saveAnywayArmed
                          ? "仍然保存"
                          : provider
                            ? "保存模型服务"
                            : "创建模型服务"}
                </DenButton>
            </div>

            {saveError ? (
                <div className="mb-6 rounded-[28px] border border-red-200 bg-red-50 px-6 py-4 text-[14px] text-red-700">
                    <p>{saveError}</p>
                    {saveAnywayArmed ? (
                        <ul className="mt-2 grid gap-1">
                            {verifyFailures.map((failure) => (
                                <li key={failure.id}>
                                    <span className="font-medium">{failure.id}</span>
                                    {failure.message ? `：${getErrorMessage(failure.message, "模型连接测试失败。")}` : null}
                                </li>
                            ))}
                        </ul>
                    ) : null}
                </div>
            ) : null}

            <section className="mb-8 rounded-[36px] border border-gray-200 bg-white p-8 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.24)]">
                <label className="grid gap-3">
                    <span className="text-[14px] font-medium text-gray-700">
                        名称
                    </span>
                    <DenInput
                        value={providerName}
                        onChange={(event) => setProviderName(event.target.value)}
                        placeholder="填写便于识别的名称"
                        autoComplete="off"
                    />
                </label>
                <p className="mt-3 text-[13px] text-gray-500">
                    使用清晰名称，方便员工辨认正在使用的密钥或模型服务配置。
                </p>
            </section>

            <section className="mb-8 rounded-[36px] border border-gray-200 bg-white p-8 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.24)]">
                <h2 className="mb-6 text-[24px] font-semibold tracking-[-0.05em] text-gray-950">
                    模型服务类型
                </h2>
                <UnderlineTabs
                    tabs={SOURCE_TABS}
                    activeTab={source}
                    onChange={setSource}
                />

                {source === "models_dev" ? (
                    <div className="mt-8 grid gap-6">
                        <div className="grid gap-3">
                            <span className="text-[14px] font-medium text-gray-700">
                                模型服务
                            </span>
                            <DenCombobox
                                value={selectedProviderId}
                                options={catalogProviderOptions}
                                onChange={(value) => {
                                    setSelectedProviderId(value);
                                    setSelectedModelIds([]);
                                    setImageInputModelIds([]);
                                    setCatalogCustomModelsText("");
                                }}
                                ariaLabel="模型服务"
                                placeholder="选择模型服务..."
                                searchPlaceholder="搜索模型服务..."
                                emptyLabel="没有匹配的模型服务"
                            />
                        </div>

                        {catalogBusy ? (
                            <p className="text-[14px] text-gray-500">
                                正在加载常用模型服务...
                            </p>
                        ) : null}
                        {catalogError ? (
                            <p className="text-[14px] text-red-600">
                                {catalogError}
                            </p>
                        ) : null}

                        {detailBusy ? (
                            <p className="text-[14px] text-gray-500">
                                正在加载服务信息...
                            </p>
                        ) : null}
                        {detailError ? (
                            <p className="text-[14px] text-red-600">
                                {detailError}
                            </p>
                        ) : null}

                        {catalogDetail ? (
                            <div className="rounded-[28px] bg-gray-50 p-6">
                                <div className="grid gap-4 md:grid-cols-2">
                                    <div>
                                        <p className="text-[12px] font-semibold uppercase text-gray-400">
                                            API 基础地址
                                        </p>
                                        <p className="mt-2">
                                            <span className="inline-flex max-w-full break-all rounded-md bg-white px-3 py-1.5 font-mono text-[11px] leading-5 text-gray-700 ring-1 ring-inset ring-gray-200">
                                                {providerApiBase ?? "未设置"}
                                            </span>
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-[12px] font-semibold uppercase text-gray-400">
                                            文档地址
                                        </p>
                                        <p className="mt-2">
                                            <span className="inline-flex max-w-full break-all rounded-md bg-white px-3 py-1.5 font-mono text-[11px] leading-5 text-gray-700 ring-1 ring-inset ring-gray-200">
                                                {providerDoc ?? "未设置"}
                                            </span>
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ) : null}
                    </div>
                ) : customMode === "form" ? (
                    <div className="mt-8 grid gap-6">
                        <p className="text-[15px] text-gray-500">
                            选择接口协议，并填写服务地址、密钥和模型 ID。
                        </p>

                        <div className="grid gap-3">
                            <span className="text-[14px] font-medium text-gray-700">
                                接口协议
                            </span>
                            <DenCombobox
                                value={customProtocol}
                                options={CUSTOM_PROTOCOL_OPTIONS}
                                onChange={(value) =>
                                    setCustomProtocol(
                                        value === "anthropic" ? "anthropic" : "openai",
                                    )
                                }
                                ariaLabel="接口协议"
                                placeholder="选择接口协议"
                                searchPlaceholder="搜索接口协议..."
                                emptyLabel="没有匹配的接口协议"
                            />
                        </div>

                        <label className="grid gap-3">
                            <span className="text-[14px] font-medium text-gray-700">
                                模型服务 ID
                            </span>
                            <DenInput
                                value={resolvedCustomProviderId}
                                onChange={(event) => {
                                    setCustomProviderId(event.target.value);
                                    setCustomProviderIdTouched(true);
                                }}
                                placeholder="例如：company-models"
                                autoComplete="off"
                                spellCheck={false}
                            />
                        </label>
                        <p className="-mt-3 text-[13px] text-gray-500">
                            用于识别此服务的短名称，会根据上方名称自动生成。
                        </p>

                        {credentialFields}
                        <p className="-mt-3 text-[13px] text-gray-500">
                            填写后会检查接口并读取可用模型，供你直接选择。凭据只会加密保存并下发给获授权的 FoxWork。
                        </p>

                        <label className="grid gap-3">
                            <span className="text-[14px] font-medium text-gray-700">
                                基础地址
                            </span>
                            <DenInput
                                value={customBaseUrl}
                                onChange={(event) =>
                                    setCustomBaseUrl(event.target.value)
                                }
                                placeholder={
                                    customProtocol === "anthropic"
                                        ? "https://anthropic.example.com/v1"
                                        : "https://models.example.com/v1"
                                }
                                autoComplete="off"
                                spellCheck={false}
                            />
                        </label>
                        <p className="-mt-3 text-[13px] text-gray-500">
                            {customProtocol === "anthropic"
                                ? "模型服务的 Anthropic 兼容接口地址，通常以"
                                : "模型服务的 OpenAI 兼容接口地址，通常以"}{" "}
                            <code className="rounded bg-gray-100 px-1 py-0.5">
                                /v1
                            </code>
                            结尾。
                        </p>

                        {customProtocol === "anthropic" ? (
                            <p className="-mt-2 text-[13px] text-gray-500">
                                系统会自动读取 Anthropic 兼容接口的模型列表，你只需勾选要开放的模型。
                            </p>
                        ) : null}
                        {probeState === "probing" ? (
                            <p className="-mt-2 text-[13px] text-gray-500">
                                正在检查接口...
                            </p>
                        ) : null}
                        {probeState === "ok" && probeResult ? (
                            <p className="-mt-2 text-[13px] text-emerald-700">
                                接口可以访问，共有 {probeResult.models.length} 个可用模型。
                            </p>
                        ) : null}
                        {probeState === "failed" ? (
                            <p className="-mt-2 text-[13px] text-red-600">
                                {probeCredential
                                    ? getErrorMessage(probeResult?.hint, "无法使用当前地址和密钥访问接口。")
                                    : "此接口需要凭据，请填写 API 密钥后重试。"}
                            </p>
                        ) : null}
                        {probeState === "idle" && customBaseUrl.trim() ? (
                            <p className="-mt-2 text-[13px] text-gray-500">
                                正在准备读取此接口提供的模型列表；如果服务需要认证，请补充 API 密钥。
                            </p>
                        ) : null}

                        {probeState === "ok" && probeResult && !customManualModels ? (
                            <div className="grid gap-3">
                                <div className="flex flex-wrap items-center gap-3">
                                    <span className="text-[14px] font-medium text-gray-700">
                                        模型
                                    </span>
                                    <span className="rounded-full bg-gray-200 px-3 py-1 text-[12px] font-medium text-gray-700">
                                        {resolvedCustomModelIds.length}{" "}
                                        个已选择
                                    </span>
                                </div>
                                <DenInput
                                    type="search"
                                    icon={Search}
                                    value={customModelQuery}
                                    onChange={(event) => setCustomModelQuery(event.target.value)}
                                    placeholder="搜索模型..."
                                />
                                {filteredProbeModels.length ? (
                                    <div className="max-h-72 overflow-y-auto overflow-hidden rounded-[16px] border border-gray-200 bg-white divide-y divide-gray-200">
                                        {filteredProbeModels.map((model) => {
                                            const selected = selectedCustomModelIds.includes(model.id);
                                            return (
                                                <DenSelectableRow
                                                    key={model.id}
                                                    selected={selected}
                                                    title={model.id}
                                                    description={
                                                        probeResult.vendor === "azure"
                                                            ? "Azure 部署"
                                                            : probeResult.vendor === "anthropic"
                                                                ? "Anthropic 模型"
                                                                : "模型"
                                                    }
                                                    onClick={() =>
                                                        setSelectedCustomModelIds((current) =>
                                                            current.includes(model.id)
                                                                ? current.filter((entry) => entry !== model.id)
                                                                : [...current, model.id],
                                                        )
                                                    }
                                                />
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <p className="text-[13px] text-gray-500">
                                        没有匹配“{customModelQuery}”的模型。
                                    </p>
                                )}
                                <button
                                    type="button"
                                    onClick={() => setCustomManualModels(true)}
                                    className="justify-self-start text-[13px] font-medium text-gray-500 underline underline-offset-2 transition hover:text-gray-900"
                                >
                                    列表中没有需要的模型，手动填写 ID
                                </button>
                            </div>
                        ) : (
                            <>
                                <label className="grid gap-3">
                                    <span className="text-[14px] font-medium text-gray-700">
                                        模型 ID
                                    </span>
                                    <DenTextarea
                                        value={customModelsText}
                                        onChange={(event) =>
                                            setCustomModelsText(event.target.value)
                                        }
                                        rows={4}
                                        placeholder={
                                            customProtocol === "anthropic"
                                                ? "例如：claude-company\n每行一个模型 ID"
                                                : "例如：company-chat\n每行一个模型 ID"
                                        }
                                    />
                                </label>
                                <p className="-mt-3 text-[13px] text-gray-500">
                                    每行填写一个，也可以用逗号分隔。请填写接口实际提供的模型 ID。
                                </p>
                                {probeState === "ok" && probeResult ? (
                                    <button
                                        type="button"
                                        onClick={() => setCustomManualModels(false)}
                                        className="-mt-2 justify-self-start text-[13px] font-medium text-gray-500 underline underline-offset-2 transition hover:text-gray-900"
                                    >
                                        改为从接口模型列表中选择
                                    </button>
                                ) : null}
                            </>
                        )}

                        <button
                            type="button"
                            onClick={switchCustomModeToJson}
                            className="justify-self-start text-[13px] font-medium text-gray-500 underline underline-offset-2 transition hover:text-gray-900"
                        >
                            高级：使用 JSON 编辑
                        </button>
                    </div>
                ) : (
                    <div className="mt-8 grid gap-3">
                        <span className="text-[14px] font-medium text-gray-700">
                            自定义模型服务 JSON / JSONC
                        </span>
                        <DenTextarea
                            value={customConfigText}
                            onChange={(event) =>
                                setCustomConfigText(event.target.value)
                            }
                            rows={18}
                        />
                        <p className="text-[13px] text-gray-500">
                            可粘贴单个模型服务配置块或完整的 FoxWork 模型服务 JSON，模型映射会自动导入。
                        </p>
                        {customJsonHint ? (
                            <p className="text-[13px] text-amber-700">
                                {customJsonHint}
                            </p>
                        ) : null}
                        <button
                            type="button"
                            onClick={switchCustomModeToForm}
                            className="justify-self-start text-[13px] font-medium text-gray-500 underline underline-offset-2 transition hover:text-gray-900"
                        >
                            改用引导表单
                        </button>
                    </div>
                )}
            </section>

            {/* 自定义模型表单在接口前收集凭据，以便管理员输入时立即探测。 */}
            {source === "custom" && customMode === "form" ? null : (
                <section className="mb-8 rounded-[36px] border border-gray-200 bg-white p-8 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.24)]">
                    <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <h2 className="text-[24px] font-semibold tracking-[-0.05em] text-gray-950">
                                凭据
                            </h2>
                        </div>
                        {provider?.hasApiKey ? (
                            <span className="rounded-full bg-emerald-50 px-4 py-2 text-[13px] font-medium text-emerald-700">
                                已保存现有凭据
                            </span>
                        ) : null}
                    </div>

                    {credentialFields}
                </section>
            )}

            {source === "models_dev" ? (
                <section className="mb-8 rounded-[36px] border border-gray-200 bg-white p-8 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.24)]">
                    <div>
                        <div>
                            <div className="flex flex-wrap items-center gap-3">
                                <h2 className="text-[24px] font-semibold tracking-[-0.05em] text-gray-950">
                                    模型
                                </h2>
                                {catalogDetail ? (
                                    <span className="rounded-full bg-gray-200 px-3 py-1 text-[12px] font-medium text-gray-700">
                                        {resolvedCatalogModelIds.length}{" "}
                                        {resolvedCatalogModelIds.length === 1
                                            ? "个已选择"
                                            : "个已选择"}
                                    </span>
                                ) : null}
                            </div>
                            <p className="mt-2 text-[15px] text-gray-500">
                                选择要向公司开放的具体模型。
                            </p>
                            {isAzureCatalog ? (
                                azureProbeState === "ok" && azureProbeResult ? (
                                    <p className="mt-2 text-[13px] text-emerald-700">
                                        当前 Azure 资源有 {azureProbeResult.models.length} 个可用部署。
                                    </p>
                                ) : azureProbeState === "probing" ? (
                                    <p className="mt-2 text-[13px] text-gray-500">
                                        正在检查 Azure 资源中的部署...
                                    </p>
                                ) : azureProbeState === "failed" ? (
                                    <p className="mt-2 text-[13px] text-red-600">
                                        {getErrorMessage(azureProbeResult?.hint, "无法读取此资源的部署，请检查资源名称和密钥。")}
                                    </p>
                                ) : (
                                    <p className="mt-2 text-[13px] text-gray-500">
                                        请先填写资源名称和 API 密钥，以读取该资源实际提供的部署。
                                    </p>
                                )
                            ) : null}
                        </div>

                        <div className="mt-6">
                            <DenInput
                                type="search"
                                icon={Search}
                                value={modelQuery}
                                onChange={(event) =>
                                    setModelQuery(event.target.value)
                                }
                                placeholder="搜索模型..."
                            />
                        </div>
                    </div>

                    {catalogDetail ? (
                        filteredModels.length ? (
                            <div className="mt-4">
                                <div className="overflow-hidden rounded-[16px] border border-gray-200 bg-white divide-y divide-gray-200">
                                    {filteredModels.map((model) => {
                                        const selected =
                                            selectedModelIds.includes(model.id);
                                        return (
                                            <DenSelectableRow
                                                key={model.id}
                                                selected={selected}
                                                title={model.name}
                                                description={model.id}
                                                onClick={() =>
                                                    setSelectedModelIds(
                                                        (current) =>
                                                            current.includes(
                                                                model.id,
                                                            )
                                                                ? current.filter(
                                                                      (entry) =>
                                                                          entry !==
                                                                          model.id,
                                                                  )
                                                                : [
                                                                      ...current,
                                                                      model.id,
                                                                  ],
                                                    )
                                                }
                                            />
                                        );
                                    })}
                                </div>
                            </div>
                        ) : (
                            <div className="mt-4 rounded-[24px] border border-dashed border-gray-200 bg-gray-50 px-5 py-6 text-[15px] text-gray-500">
                                没有匹配“
                                <span className="font-medium text-gray-700">
                                    {modelQuery}
                                </span>
                                ”的模型。
                            </div>
                        )
                    ) : (
                        <div className="mt-4 rounded-[24px] border border-dashed border-gray-200 bg-gray-50 px-5 py-6 text-[15px] text-gray-500">
                            请选择模型服务后查看可用模型。
                        </div>
                    )}

                    {catalogDetail?.allowCustomModelIds ? (
                        <div className="mt-6 grid gap-3">
                            <label className="grid gap-3">
                                <span className="text-[14px] font-medium text-gray-700">
                                    补充模型 ID
                                </span>
                                <DenTextarea
                                    value={catalogCustomModelsText}
                                    onChange={(event) =>
                                        setCatalogCustomModelsText(event.target.value)
                                    }
                                    rows={3}
                                    placeholder="填写控制台中的模型 ID 或推理接入点 ID"
                                />
                            </label>
                            <p className="text-[13px] text-gray-500">
                                内置列表中没有所需模型时填写。每行一个，也可以用逗号分隔。
                            </p>
                        </div>
                    ) : null}
                </section>
            ) : null}

            {source === "models_dev" || customMode === "form" ? (
                <section className="mb-8 border-y border-gray-200 py-8">
                    <div>
                        <h2 className="text-[24px] font-semibold text-gray-950">
                            图片输入
                        </h2>
                        <p className="mt-2 text-[15px] leading-6 text-gray-500">
                            无法从模型列表判断时，请根据服务商说明手动勾选“支持图片输入”。
                        </p>
                    </div>

                    {configurableModelIds.length > 0 ? (
                        <div className="mt-6 divide-y divide-gray-200 border-y border-gray-200">
                            {configurableModelIds.map((modelId) => {
                                const checked = activeImageInputModelIds.includes(modelId);
                                return (
                                    <label
                                        key={modelId}
                                        className="flex cursor-pointer items-center justify-between gap-4 py-4"
                                    >
                                        <span className="min-w-0 break-all text-[14px] font-medium text-gray-900">
                                            {modelId}
                                        </span>
                                        <span className="flex shrink-0 items-center gap-2 text-[13px] text-gray-600">
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={(event) => {
                                                    const nextChecked = event.target.checked;
                                                    setImageInputModelIds((current) => nextChecked
                                                        ? [...new Set([...current, modelId])]
                                                        : current.filter((entry) => entry !== modelId));
                                                }}
                                                className="h-4 w-4 accent-gray-950"
                                            />
                                            支持图片输入
                                        </span>
                                    </label>
                                );
                            })}
                        </div>
                    ) : (
                        <p className="mt-5 text-[14px] text-gray-500">
                            请先选择要向员工开放的模型。
                        </p>
                    )}
                </section>
            ) : null}

            <section className="rounded-[36px] border border-gray-200 bg-white p-8 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.24)]">
                <div>
                    <h2 className="text-[24px] font-semibold tracking-[-0.05em] text-gray-950">
                        配置使用权限
                    </h2>
                    <p className="mt-2 text-[15px] text-gray-500">
                        设置全员默认策略，并保留下方明确授权作为关闭默认策略后的使用范围。
                    </p>
                </div>

                <div className="mt-8 flex items-start justify-between gap-6 rounded-[24px] border border-gray-200 bg-gray-50 px-5 py-5">
                    <div>
                        <p className="text-[15px] font-medium text-gray-900">
                            默认对所有成员启用
                        </p>
                        <p className="mt-1 text-[13px] leading-5 text-gray-500">
                            开启后，当前员工和以后加入公司的员工都能使用。关闭时不会删除下方已明确授权的成员或团队。
                        </p>
                    </div>
                    <DefaultAccessToggle
                        checked={defaultEnabled}
                        onChange={setDefaultEnabled}
                    />
                </div>

                <div className="mt-8 grid w-80 grid-cols-2 rounded-xl bg-gray-200 p-1 text-[13px] font-medium text-gray-500">
                    <button
                        type="button"
                        onClick={() => {
                            setAccessTab("teams");
                            setAccessQuery("");
                        }}
                        className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 transition ${accessTab === "teams" ? "bg-white text-gray-900 shadow-sm" : "hover:text-gray-700"}`}
                    >
                        <Users className="h-4 w-4" />
                        {`团队（${selectedTeamIds.length}）`}
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setAccessTab("people");
                            setAccessQuery("");
                        }}
                        className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 transition ${accessTab === "people" ? "bg-white text-gray-900 shadow-sm" : "hover:text-gray-700"}`}
                    >
                        <User className="h-4 w-4" />
                        {`成员（${selectedMemberIds.length}）`}
                    </button>
                </div>

                <div className="mt-6">
                    <DenInput
                        type="search"
                        icon={Search}
                        value={accessQuery}
                        onChange={(event) => setAccessQuery(event.target.value)}
                        placeholder={
                            accessTab === "teams"
                                ? "搜索团队..."
                                : "搜索成员..."
                        }
                    />
                </div>

                {accessTab === "teams" ? (
                    orgContext?.teams.length ? (
                        filteredTeams.length ? (
                            <div className="mt-4 overflow-hidden rounded-[16px] border border-gray-200 bg-white divide-y divide-gray-200">
                                {filteredTeams.map((team) => {
                                    const selected = selectedTeamIds.includes(team.id);
                                    return (
                                        <DenSelectableRow
                                            key={team.id}
                                            selected={selected}
                                            leading={
                                                <Users className="h-4 w-4 text-gray-400" />
                                            }
                                            title={team.name}
                                            description={`${team.memberIds.length} 位成员`}
                                            onClick={() =>
                                                setSelectedTeamIds((current) =>
                                                    current.includes(team.id)
                                                        ? current.filter(
                                                              (entry) =>
                                                                  entry !== team.id,
                                                          )
                                                        : [...current, team.id],
                                                )
                                            }
                                        />
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="mt-4 rounded-[24px] border border-dashed border-gray-200 bg-gray-50 px-5 py-6 text-[15px] text-gray-500">
                                没有匹配“
                                <span className="font-medium text-gray-700">
                                    {accessQuery}
                                </span>
                                ”的团队。
                            </div>
                        )
                    ) : (
                        <div className="mt-4 rounded-[24px] border border-dashed border-gray-200 bg-gray-50 px-5 py-6 text-[15px] text-gray-500">
                            请先在成员页面创建团队，再分配团队权限。
                        </div>
                    )
                ) : orgContext?.members.length ? (
                    filteredMembers.length ? (
                        <div className="mt-4 overflow-hidden rounded-[16px] border border-gray-200 bg-white divide-y divide-gray-200">
                            {filteredMembers.map((member) => {
                                const selected = selectedMemberIds.includes(
                                    member.id,
                                );
                                const locked = lockedMemberId === member.id;
                                return (
                                    <DenSelectableRow
                                        key={member.id}
                                        disabled={locked}
                                        selected={selected}
                                        leading={
                                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0f172a] text-[11px] font-semibold uppercase text-white">
                                                {member.user.name
                                                    .split(" ")
                                                    .map((part) => part[0])
                                                    .join("")
                                                    .slice(0, 2)}
                                            </div>
                                        }
                                        descriptionBelow
                                        title={member.user.name}
                                        description={member.user.email}
                                        aside={
                                            locked ? (
                                                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-500">
                                                    固定授权
                                                </span>
                                            ) : undefined
                                        }
                                        onClick={() =>
                                            setSelectedMemberIds((current) =>
                                                current.includes(member.id)
                                                    ? current.filter(
                                                          (entry) =>
                                                              entry !== member.id,
                                                      )
                                                    : [...current, member.id],
                                            )
                                        }
                                    />
                                );
                            })}
                        </div>
                    ) : (
                        <div className="mt-4 rounded-[24px] border border-dashed border-gray-200 bg-gray-50 px-5 py-6 text-[15px] text-gray-500">
                            没有匹配“
                            <span className="font-medium text-gray-700">
                                {accessQuery}
                            </span>
                            ”的成员。
                        </div>
                    )
                ) : (
                    <div className="mt-4 rounded-[24px] border border-dashed border-gray-200 bg-gray-50 px-5 py-6 text-[15px] text-gray-500">
                        暂无可分配的成员。
                    </div>
                )}
            </section>
        </div>
    );
}
