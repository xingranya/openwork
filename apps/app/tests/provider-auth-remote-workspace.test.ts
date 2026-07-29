import { describe, expect, test } from "bun:test";

import {
  OpenworkServerError,
  type OpenworkServerClient,
} from "../src/app/lib/openwork-server";
import type { Client, WorkspaceDisplay } from "../src/app/types";
import { buildProviderAuthEntries } from "../src/react-app/domains/connections/provider-auth/provider-auth-modal";
import { createProviderAuthStore } from "../src/react-app/domains/connections/provider-auth/store";

describe("工作区模型服务", () => {
  test("强制刷新绕过短时间重载节流，确保刚导入的公司模型立即可用", async () => {
    let disposeCount = 0;
    const workspace = {
      id: "local_company",
      name: "本地工作区",
      path: "/workspace/local-company",
      preset: "starter",
      workspaceType: "local",
    } as WorkspaceDisplay;
    const client = {
      instance: {
        dispose: async () => {
          disposeCount += 1;
          return { data: {} };
        },
      },
      global: { health: async () => ({ data: { healthy: true } }) },
      config: { get: async () => ({ data: {} }) },
      provider: {
        list: async () => ({
          data: { all: [], connected: [], default: {} },
        }),
      },
    } as Client;
    const store = createProviderAuthStore({
      client: () => client,
      providers: () => [],
      providerDefaults: () => ({}),
      providerConnectedIds: () => [],
      disabledProviders: () => [],
      checkDesktopAppRestriction: () => false,
      selectedWorkspaceDisplay: () => workspace,
      providerBaseUrl: () => "http://127.0.0.1:43123",
      selectedWorkspaceRoot: () => workspace.path,
      runtimeWorkspaceId: () => "local-company",
      openworkServer: {
        getSnapshot: () => ({
          openworkServerStatus: "disconnected" as const,
          openworkServerClient: null,
          openworkServerCapabilities: null,
        }),
      },
      setProviders: () => {},
      setProviderDefaults: () => {},
      setProviderConnectedIds: () => {},
      setDisabledProviders: () => {},
      markOpencodeConfigReloadRequired: () => {},
    });

    await store.refreshProviders({ dispose: true });
    await store.refreshProviders({ dispose: true, force: true });

    expect(disposeCount).toBe(2);
  });

  test("运行工作区尚未就绪时不同步为已完成", async () => {
    const workspace = {
      id: "rem_company",
      name: "我的远程工作区",
      path: "/workspace/company",
      preset: "starter",
      workspaceType: "remote",
    } as WorkspaceDisplay;
    const store = createProviderAuthStore({
      client: () => null,
      providers: () => [],
      providerDefaults: () => ({}),
      providerConnectedIds: () => [],
      disabledProviders: () => [],
      checkDesktopAppRestriction: () => false,
      selectedWorkspaceDisplay: () => workspace,
      providerBaseUrl: () => "",
      selectedWorkspaceRoot: () => workspace.path,
      runtimeWorkspaceId: () => null,
      openworkServer: {
        getSnapshot: () => ({
          openworkServerStatus: "disconnected" as const,
          openworkServerClient: null,
          openworkServerCapabilities: null,
        }),
      },
      setProviders: () => {},
      setProviderDefaults: () => {},
      setProviderConnectedIds: () => {},
      setDisabledProviders: () => {},
      markOpencodeConfigReloadRequired: () => {},
    });

    const result = await store.runCloudProviderSync("app_launch");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("尚未准备好");
    }
  });

  test("远程工作区重建后自动使用最新绑定保存模型配置", async () => {
    let oldWrites = 0;
    let writes = 0;
    let recoveries = 0;
    const oldClient = {
      setRuntimeProviders: async () => {
        oldWrites += 1;
        throw new OpenworkServerError(404, "workspace_not_found", "Workspace not found");
      },
    } as OpenworkServerClient;
    const newClient = {
      setRuntimeProviders: async () => {
        writes += 1;
      },
    } as OpenworkServerClient;
    const workspace = {
      id: "rem_company",
      name: "我的远程工作区",
      path: "/workspace/company",
      preset: "starter",
      workspaceType: "remote",
    } as WorkspaceDisplay;
    const store = createProviderAuthStore({
      client: () => ({
        auth: { set: async () => ({}) },
        global: { health: async () => ({ data: { healthy: true } }) },
      }) as Client,
      providers: () => [],
      providerDefaults: () => ({}),
      providerConnectedIds: () => [],
      disabledProviders: () => [],
      checkDesktopAppRestriction: () => false,
      selectedWorkspaceDisplay: () => workspace,
      providerBaseUrl: () => "https://worker.example.test/workspace/company/opencode",
      selectedWorkspaceRoot: () => workspace.path,
      runtimeWorkspaceId: () => "workspace-old",
      recoverRuntimeWorkspace: async () => {
        recoveries += 1;
        return {
          baseUrl: "https://worker.example.test",
          token: "client-token",
          workspaceId: "workspace-new",
          isRemote: true,
          client: newClient,
          mountedBaseUrl: "https://worker.example.test/workspace/workspace-new",
          opencodeBaseUrl: "https://worker.example.test/workspace/workspace-new/opencode",
        };
      },
      openworkServer: {
        getSnapshot: () => ({
          openworkServerStatus: "connected" as const,
          openworkServerClient: oldClient,
          openworkServerCapabilities: { config: { read: true, write: true } },
        }),
      },
      setProviders: () => {},
      setProviderDefaults: () => {},
      setProviderConnectedIds: () => {},
      setDisabledProviders: () => {},
      markOpencodeConfigReloadRequired: () => {},
    });

    await store.submitLocalProvider({
      kind: "custom-openai",
      providerId: "company-gateway",
      name: "公司模型网关",
      baseUrl: "https://models.example.test",
      apiKey: "test-key",
      modelIds: ["company-model"],
    });

    expect(oldWrites).toBe(1);
    expect(writes).toBe(1);
    expect(recoveries).toBe(1);
  });

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
