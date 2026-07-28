// 扩展清单在此定义重载原因，types.ts 只向应用其余模块重新导出。
export type ReloadReason = "plugins" | "skills" | "mcp" | "config" | "agents" | "commands";

export type OpenWorkExtensionSourceFormat =
  | "openwork-builtin"
  | "openwork-extension-manifest"
  | "claude-plugin"
  | "opencode-plugin"
  | "mcp-directory"
  | "manual";

export type OpenWorkExtensionSource = {
  format: OpenWorkExtensionSourceFormat;
  trusted: boolean;
  origin?: "builtin" | "den" | "workspace" | "local";
  reference?: string;
};

export type OpenWorkExtensionResourceType =
  | "skill"
  | "agent"
  | "command"
  | "tool"
  | "mcp"
  | "opencode-plugin"
  | "provider"
  | "hook"
  | "context"
  | "secret"
  | "file"
  | "local-service"
  | "native-binary";

export type OpenWorkExtensionResource = {
  type: OpenWorkExtensionResourceType;
  id: string;
  label?: string;
  description?: string;
  path?: string;
  command?: string[];
  envKey?: string;
  packageName?: string;
  providerId?: string;
  mcpServerName?: string;
  localCommandRef?: "openwork.computerUseMcp" | "openwork.uiMcp";
  required?: boolean;
};

export type OpenWorkExtensionContributionType =
  | "settings-panel"
  | "setup-instructions"
  | "composer-prompt"
  | "session-side-panel"
  | "session-rail-item"
  | "control-actions"
  | "server-route"
  | "native-capability"
  | "test-action";

export type OpenWorkExtensionContribution = {
  type: OpenWorkExtensionContributionType;
  ref?: string;
  label?: string;
  description?: string;
  prompt?: string;
  location?: "settings-detail" | "composer" | "session-right-pane" | "session-rail" | "server" | "native";
};

export type OpenWorkExtensionSetup = {
  instructions?: string;
  primaryCta?: string;
  secondaryCta?: string;
  requiredEnv?: string[];
  testActionRef?: string;
};

export type OpenWorkExtensionLifecycle = {
  reload?: ReloadReason[];
  detection?: string[];
};

// ---------------------------------------------------------------------------
// 启用条件：以声明式规则判断扩展是否可用
// ---------------------------------------------------------------------------

export type EnablementConditionType =
  | "mcp-connected"
  | "plugin-loaded"
  | "provider-connected"
  | "env-set"
  | "permission-granted"
  | "toggle-enabled";

export type EnablementCondition = {
  type: EnablementConditionType;
  /** 要检查的 MCP 服务名、插件 ID 或环境变量名等引用。 */
  ref: string;
  /** 显示在界面中的可读名称。 */
  label: string;
};

/** 单项启用条件的运行时检查结果。 */
export type EnablementResult = {
  condition: EnablementCondition;
  met: boolean;
};

export type OpenWorkExtensionManifest = {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  preview?: boolean;
  source: OpenWorkExtensionSource;
  icon?: {
    src?: string;
    simpleIconSlug?: string;
  };
  composer?: {
    prompt: string;
  };
  setup?: OpenWorkExtensionSetup;
  resources: OpenWorkExtensionResource[];
  contributions?: OpenWorkExtensionContribution[];
  lifecycle?: OpenWorkExtensionLifecycle;
  /** 全部满足后扩展才可用的声明式条件。 */
  enablement?: EnablementCondition[];
  defaultEnabled?: boolean;
  defaultHidden?: boolean;
  platform?: Array<"darwin" | "linux" | "windows" | "web">;
};

export type OpenWorkExtensionPlatform = NonNullable<OpenWorkExtensionManifest["platform"]>[number];

export function extensionContribution(
  manifest: OpenWorkExtensionManifest | undefined,
  type: OpenWorkExtensionContributionType,
): OpenWorkExtensionContribution | undefined {
  return manifest?.contributions?.find((contribution) => contribution.type === type);
}

export function extensionResource(
  manifest: OpenWorkExtensionManifest | undefined,
  type: OpenWorkExtensionResourceType,
): OpenWorkExtensionResource | undefined {
  return manifest?.resources.find((resource) => resource.type === type);
}

export function isTrustedBuiltInExtension(manifest: OpenWorkExtensionManifest | undefined): boolean {
  return manifest?.source.origin === "builtin" && manifest.source.trusted;
}

export const BUILT_IN_OPENWORK_EXTENSION_MANIFESTS: OpenWorkExtensionManifest[] = [
  {
    schemaVersion: 1,
    id: "openwork-browser",
    name: "内置浏览器",
    description: "在 FoxWork 内直接打开网页，并让 AI 帮你浏览和操作。",
    source: { format: "openwork-builtin", origin: "builtin", trusted: true },
    icon: { src: "/openwork-mark.svg" },
    composer: { prompt: "使用内置浏览器" },
    setup: {
      instructions: "桌面工作区已默认启用内置浏览器，无需额外配置。",
    },
    resources: [
      {
        type: "opencode-plugin",
        id: "opencode-chrome-devtools",
        packageName: "opencode-chrome-devtools",
        required: true,
      },
    ],
    contributions: [
      { type: "settings-panel", ref: "openwork.browser.settings", location: "settings-detail" },
      { type: "session-side-panel", ref: "openwork.browser.panel", location: "session-right-pane" },
      { type: "composer-prompt", prompt: "使用内置浏览器", location: "composer" },
    ],
    enablement: [
      { type: "toggle-enabled", ref: "openwork-browser", label: "已启用" },
    ],
    lifecycle: { reload: ["plugins", "agents"], detection: ["plugin:opencode-chrome-devtools"] },
    defaultEnabled: true,
    platform: ["darwin", "linux", "windows"],
  },
  {
    schemaVersion: 1,
    id: "computer-use",
    name: "电脑操作",
    description: "在 Mac 上通过辅助功能、截图、鼠标和键盘操作本机应用。",
    preview: true,
    source: { format: "openwork-builtin", origin: "builtin", trusted: true },
    icon: { src: "/openwork-mark.svg" },
    composer: { prompt: "使用电脑操作功能" },
    setup: {
      instructions: "此功能仅支持 Mac。请按系统提示授予辅助功能和屏幕录制权限，再连接当前工作区中的电脑操作 MCP。",
      primaryCta: "连接电脑操作 MCP",
      secondaryCta: "检查 macOS 权限",
      testActionRef: "openwork.computerUse.healthCheck",
    },
    resources: [
      {
        type: "mcp",
        id: "computer-use-mcp",
        label: "电脑操作 MCP",
        mcpServerName: "computer-use",
        command: ["npx", "-y", "@openwork/handsfree", "mcp"],
        localCommandRef: "openwork.computerUseMcp",
        required: true,
      },
      {
        type: "native-binary",
        id: "computer-use-native",
        label: "macOS 辅助功能组件",
        packageName: "@openwork/handsfree",
        required: true,
      },
    ],
    contributions: [
      { type: "setup-instructions", ref: "openwork.computerUse.setup", location: "settings-detail" },
      { type: "native-capability", ref: "openwork.computerUse.axPermissions", label: "辅助功能和屏幕录制" },
      { type: "test-action", ref: "openwork.computerUse.healthCheck", label: "检查电脑操作 MCP" },
      { type: "composer-prompt", prompt: "使用电脑操作功能", location: "composer" },
    ],
    enablement: [
      { type: "mcp-connected", ref: "computer-use", label: "MCP 服务已连接" },
      { type: "permission-granted", ref: "accessibility", label: "已授予辅助功能权限" },
      { type: "permission-granted", ref: "screenRecording", label: "已授予屏幕录制权限" },
    ],
    lifecycle: { reload: ["mcp"], detection: ["mcp:computer-use"] },
    platform: ["darwin"],
  },
  {
    schemaVersion: 1,
    id: "openai-image-gen",
    name: "图片生成",
    description: "使用已配置的 OpenAI 图片模型生成图片。",
    source: { format: "openwork-builtin", origin: "builtin", trusted: true },
    icon: { src: "/ext-openai.svg" },
    composer: { prompt: "使用图片生成功能" },
    setup: {
      instructions: "添加 OpenAI API 密钥后，AI 即可在会话中生成图片。",
      primaryCta: "启用图片生成",
      secondaryCta: "生成测试图片",
      requiredEnv: ["OPENAI_API_KEY"],
      testActionRef: "openwork.imageGen.testGenerate",
    },
    resources: [
      { type: "secret", id: "openai-api-key", envKey: "OPENAI_API_KEY", required: true },
      { type: "local-service", id: "openai-image-generation-service", label: "OpenAI 图片生成服务", required: true },
      { type: "tool", id: "openai-image-generate", label: "图片生成", required: true },
    ],
    contributions: [
      { type: "settings-panel", ref: "openwork.imageGen.settings", location: "settings-detail" },
      { type: "test-action", ref: "openwork.imageGen.testGenerate", label: "生成测试图片" },
      { type: "composer-prompt", prompt: "使用图片生成功能", location: "composer" },
    ],
    enablement: [
      { type: "env-set", ref: "OPENAI_API_KEY", label: "OpenAI API 密钥" },
    ],
    lifecycle: { reload: ["config"], detection: ["env:OPENAI_API_KEY"] },
  },
  {
    schemaVersion: 1,
    id: "openwork-voice",
    name: "语音模式",
    description: "通过实时语音面板与 FoxWork 对话并操作界面。",
    preview: true,
    source: { format: "openwork-builtin", origin: "builtin", trusted: true },
    icon: { src: "/openwork-mark.svg" },
    composer: { prompt: "使用语音模式" },
    setup: {
      instructions: "语音模式使用 OpenAI Realtime。保存 OpenAI API 密钥后，在会话侧栏打开语音面板即可说话或输入语音指令。",
      primaryCta: "保存 OpenAI 密钥",
      secondaryCta: "测试实时语音",
      requiredEnv: ["OPENAI_REALTIME_API_KEY", "OPENAI_API_KEY"],
      testActionRef: "openwork.voice.testRealtime",
    },
    resources: [
      { type: "secret", id: "openai-realtime-api-key", envKey: "OPENAI_REALTIME_API_KEY", required: false },
      { type: "secret", id: "openai-api-key", envKey: "OPENAI_API_KEY", required: true },
      { type: "local-service", id: "openwork-voice-realtime-session", label: "实时语音连接服务", required: true },
    ],
    contributions: [
      { type: "settings-panel", ref: "openwork.voice.settings", location: "settings-detail" },
      { type: "session-side-panel", ref: "openwork.voice.panel", location: "session-right-pane" },
      { type: "session-rail-item", ref: "openwork.voice.rail", label: "语音模式", location: "session-rail" },
      { type: "server-route", ref: "POST /voice/realtime/session", location: "server" },
      { type: "control-actions", ref: "openwork.voice.controlActions" },
      { type: "test-action", ref: "openwork.voice.testRealtime", label: "测试实时语音" },
      { type: "composer-prompt", prompt: "使用语音模式", location: "composer" },
    ],
    enablement: [
      { type: "toggle-enabled", ref: "openwork-voice", label: "已启用" },
      { type: "env-set", ref: "OPENAI_API_KEY", label: "OpenAI API 密钥" },
    ],
    lifecycle: { reload: ["config"], detection: ["env:OPENAI_REALTIME_API_KEY", "env:OPENAI_API_KEY"] },
  },
  {
    schemaVersion: 1,
    id: "google-workspace",
    name: "Google Workspace 办公套件",
    description: "让 AI 协助处理会议、指定的云端文件和 Gmail 草稿。",
    preview: true,
    source: { format: "openwork-builtin", origin: "builtin", trusted: true },
    icon: { simpleIconSlug: "google" },
    composer: { prompt: "使用 Google Workspace" },
    setup: {
      instructions: "连接 Google 账号后，即可在 FoxWork 中使用日历、云端文件和 Gmail 草稿。",
      primaryCta: "连接 Google Workspace",
      secondaryCta: "测试连接",
      testActionRef: "openwork.googleWorkspace.testConnection",
    },
    resources: [
      { type: "provider", id: "google-oauth", label: "Google 账号", providerId: "google-workspace", required: true },
      { type: "local-service", id: "google-workspace-connector", label: "安全本地连接", required: true },
      { type: "tool", id: "google-calendar-read", label: "日历", required: true },
      { type: "tool", id: "google-gmail-drafts", label: "Gmail 草稿", required: true },
      { type: "tool", id: "google-drive-selected-files", label: "指定的云端文件", required: true },
      { type: "tool", id: "google-gmail-read", label: "读取 Gmail（可选）", required: false },
      { type: "tool", id: "google-drive-full", label: "访问全部云端文件（可选）", required: false },
      { type: "tool", id: "google-calendar-events", label: "日历事件（可选）", required: false },
      { type: "tool", id: "google-chat", label: "Google Chat（可选）", required: false },
    ],
    contributions: [
      { type: "settings-panel", ref: "openwork.googleWorkspace.settings", location: "settings-detail" },
      { type: "test-action", ref: "openwork.googleWorkspace.testConnection", label: "测试 Google Workspace" },
      { type: "composer-prompt", prompt: "使用 Google Workspace", location: "composer" },
    ],
    lifecycle: { reload: ["config"], detection: ["provider:google-workspace"] },
  },
  {
    schemaVersion: 1,
    id: "ollama",
    name: "Ollama 本地模型",
    description: "连接运行在 http://localhost:11434 的本地模型服务。",
    source: { format: "openwork-builtin", origin: "builtin", trusted: true },
    icon: { src: "/ext-ollama.svg" },
    composer: { prompt: "使用 Ollama 本地模型" },
    setup: {
      instructions: "在本机运行 Ollama，选择或下载模型后，将它添加为本地模型服务。",
      primaryCta: "添加 Ollama 模型",
      secondaryCta: "下载模型",
    },
    resources: [
      { type: "local-service", id: "ollama-api", label: "Ollama API 服务", description: "http://localhost:11434", required: true },
      { type: "provider", id: "ollama", providerId: "ollama", packageName: "@ai-sdk/openai-compatible", required: true },
    ],
    contributions: [
      { type: "settings-panel", ref: "openwork.ollama.settings", location: "settings-detail" },
      { type: "test-action", ref: "openwork.ollama.listModels", label: "检查本地模型" },
      { type: "composer-prompt", prompt: "使用 Ollama 本地模型", location: "composer" },
    ],
    enablement: [
      { type: "provider-connected", ref: "ollama", label: "Ollama 模型服务" },
    ],
    lifecycle: { reload: ["config"], detection: ["provider:ollama"] },
  },
];
