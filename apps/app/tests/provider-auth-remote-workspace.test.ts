import { describe, expect, test } from "bun:test";

import {
  OpenworkServerError,
  type OpenworkServerClient,
} from "../src/app/lib/openwork-server";
import type { Client, WorkspaceDisplay } from "../src/app/types";
import { buildProviderAuthEntries } from "../src/react-app/domains/connections/provider-auth/provider-auth-modal";
import { createProviderAuthStore } from "../src/react-app/domains/connections/provider-auth/store";

describe("工作区模型服务", () => {
  test("远程工作区允许提交自定义模型配置，并在缺少配置权限时说明原因", async () => {
    let runtimeProviderWriteCount = 0;
    const remoteClient = {
      setRuntimeProviders: async () => {
        runtimeProviderWriteCount += 1;
        throw new OpenworkServerError(
          401,
          "missing_host_token",
          "Missing host token",
        );
      },
    } as OpenworkServerClient;
    const workspace = {
      id: "rem_design",
      name: "设计远程工作区",
      path: "/workspace/design",
      preset: "starter",
      workspaceType: "remote",
    } as WorkspaceDisplay;
    const store = createProviderAuthStore({
      client: () => ({}) as Client,
      providers: () => [],
      providerDefaults: () => ({}),
      providerConnectedIds: () => [],
      disabledProviders: () => [],
      checkDesktopAppRestriction: () => false,
      selectedWorkspaceDisplay: () => workspace,
      providerBaseUrl: () => "https://worker.example.test/workspace/design/opencode",
      selectedWorkspaceRoot: () => workspace.path,
      runtimeWorkspaceId: () => "design",
      openworkServer: {
        getSnapshot: () => ({
          openworkServerStatus: "connected" as const,
          openworkServerClient: remoteClient,
          openworkServerCapabilities: { config: { write: true } },
        }),
      },
      setProviders: () => {},
      setProviderDefaults: () => {},
      setProviderConnectedIds: () => {},
      setDisabledProviders: () => {},
      markOpencodeConfigReloadRequired: () => {},
    });

    await expect(store.submitLocalProvider({
      kind: "custom-openai",
      providerId: "designer-gateway",
      name: "设计模型网关",
      baseUrl: "https://models.example.test",
      apiKey: "test-key",
      modelIds: ["vision-1"],
    })).rejects.toThrow("无法将新模型保存到该工作区");

    expect(store.getSnapshot().providerAuthError).toContain("无法将新模型保存到该工作区");
    expect(runtimeProviderWriteCount).toBe(1);
  });

  test("所有工作区同样展示公司模型和自定义模型配置入口", () => {
    const entries = buildProviderAuthEntries({
      providers: [
        { id: "additional-model", name: "其他已配置模型", env: ["ADDITIONAL_MODEL_KEY"] },
        { id: "lpr_company", name: "公司统一模型", env: [] },
      ],
      connectedProviderIds: ["additional-model"],
      authMethods: {
        "additional-model": [{ type: "api", label: "API 密钥" }],
        lpr_company: [{
          type: "cloud",
          label: "公司管理",
          cloudProviderId: "company-models",
        }],
      },
    });
    const names = entries.map((entry) => entry.name);

    expect(names).toContain("公司统一模型");
    expect(names).toContain("其他已配置模型");
    expect(names).toContain("自定义 OpenAI 兼容协议");
  });
});
