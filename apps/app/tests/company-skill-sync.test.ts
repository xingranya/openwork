import { afterEach, describe, expect, test } from "bun:test";

import { readWorkspaceCloudImports } from "../src/app/cloud/import-state";
import { createDenClient, shareInstalledSkillWithCompany } from "../src/app/lib/den";
import { createOpenworkServerClient } from "../src/app/lib/openwork-server";
import type { DenOrgSkillCard } from "../src/app/types";
import { createOpenworkServerStore } from "../src/react-app/domains/connections/openwork-server-store";
import {
  buildCompanySkillInstallPayload,
  getRevokedCompanySkillImports,
  getCompanySkillInstallState,
  reconcileImportedCompanySkills,
  subscribeCompanySkillSyncTriggers,
} from "../src/react-app/domains/settings/state/company-skill-sync";
import { syncCompanySkillsInBackground } from "../src/react-app/domains/settings/state/use-company-skill-auto-sync";
import { createExtensionsStore } from "../src/react-app/domains/settings/state/extensions-store";

const originalFetch = globalThis.fetch;
const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");

function setFetch(fetchImpl: typeof fetch) {
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: fetchImpl,
  });
}

function installTestWindow(
  initial: Record<string, string>,
  invokeDesktop?: (command: string, ...args: unknown[]) => Promise<unknown>,
) {
  const values = new Map(Object.entries(initial));
  const localStorage: Storage = {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage,
      ...(invokeDesktop
        ? { __OPENWORK_ELECTRON__: { invokeDesktop } }
        : {}),
    },
  });
}

afterEach(() => {
  setFetch(originalFetch);
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, "window", originalWindowDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
});

const bundleHash = "a".repeat(64);
const files = [
  {
    path: "SKILL.md",
    contents: "---\nname: evidence-review\ndescription: 审查项目证据\n---\n\n先核对来源。\n",
  },
  {
    path: "references/checklist.md",
    contents: "# 检查表\n\n- 核对原始文件\n",
  },
];

const companySkill: DenOrgSkillCard = {
  id: "skill_company_test",
  title: "evidence-review",
  description: "审查项目证据",
  skillText: files[0]!.contents,
  bundleHash,
  files,
  shared: "org",
  updatedAt: "2026-07-27T08:00:00.000Z",
};

function companySkillConfigObject(skill: DenOrgSkillCard) {
  return {
    id: skill.id,
    objectType: "skill",
    currentRelativePath: `company-skills/${skill.title}/SKILL.md`,
    title: skill.title,
    description: skill.description,
    updatedAt: skill.updatedAt,
    latestVersion: {
      rawSourceText: skill.skillText,
      normalizedPayloadJson: {
        foxworkSkillBundle: {
          version: 1,
          bundleHash: skill.bundleHash,
          files: skill.files,
          shared: skill.shared === "org" ? "org" : "private",
        },
      },
    },
  };
}

describe("公司 Skill 同步", () => {
  test("远程工作区同时展示员工电脑的全局 Skill", async () => {
    const desktopCommands: Array<{ command: string; args: unknown[] }> = [];
    installTestWindow({}, async (command, ...args) => {
      desktopCommands.push({ command, args });
      if (command === "listGlobalSkills") {
        return [{
          name: "humanizer-zh",
          description: "让中文表达更自然",
          path: "/Users/employee/.agents/skills/humanizer-zh/SKILL.md",
          source: "desktop-global",
        }];
      }
      if (command === "readGlobalSkill") {
        return {
          path: "/Users/employee/.agents/skills/humanizer-zh/SKILL.md",
          content: "# Humanizer\n",
        };
      }
      if (command === "writeGlobalSkill" || command === "uninstallGlobalSkill") {
        return { ok: true, status: 0, stdout: "ok", stderr: "" };
      }
      throw new Error(`unexpected_desktop_command:${command}`);
    });
    setFetch(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/workspace/ws_remote/skills")) {
        return Response.json({
          items: [{
            name: "remote-review",
            description: "远程审查",
            path: "/workspace/.opencode/skills/remote-review/SKILL.md",
          }],
        });
      }
      return Response.json({ error: "unexpected_request", path: url.pathname }, { status: 500 });
    });

    const openworkClient = createOpenworkServerClient({
      baseUrl: "http://127.0.0.1:43123",
      token: "worker-token",
    });
    const openworkServer = createOpenworkServerStore({
      startupPreference: () => "remote",
      documentVisible: () => true,
      developerMode: () => false,
      runtimeWorkspaceId: () => "ws_remote",
      activeClient: () => null,
      selectedWorkspaceDisplay: () => ({
        id: "remote_alias",
        name: "我的远程工作区",
        path: "",
        preset: "default",
        workspaceType: "remote",
      }),
      restartLocalServer: async () => true,
      createRemoteWorkspaceFlow: async () => true,
    });
    const store = createExtensionsStore({
      client: () => null,
      projectDir: () => "",
      selectedWorkspaceId: () => "remote_alias",
      selectedWorkspaceRoot: () => "",
      workspaceType: () => "remote",
      openworkServer,
      openworkServerConnection: () => ({
        openworkServerClient: openworkClient,
        openworkServerStatus: "connected",
        openworkServerCapabilities: {
          skills: { read: true, write: true, source: "openwork" },
          plugins: { read: true, write: true },
          mcp: { read: true, write: true },
          commands: { read: true, write: true },
          config: { read: true, write: true },
        },
      }),
      runtimeWorkspaceId: () => "ws_remote",
      setBusy: () => undefined,
      setBusyLabel: () => undefined,
      setBusyStartedAt: () => undefined,
      setError: () => undefined,
    });

    await store.refreshSkills({ force: true });

    expect(store.skills().map((skill) => skill.name)).toEqual([
      "humanizer-zh",
      "remote-review",
    ]);
    const globalSkill = store.skills().find((skill) => skill.name === "humanizer-zh");
    expect(globalSkill?.source).toBe("desktop-global");
    await expect(store.readSkill(globalSkill!)).resolves.toEqual({
      name: "humanizer-zh",
      path: "/Users/employee/.agents/skills/humanizer-zh/SKILL.md",
      content: "# Humanizer\n",
    });
    await store.saveSkill({
      name: "humanizer-zh",
      content: "# Humanizer\n\n更新后的说明。\n",
      source: "desktop-global",
    });
    await store.uninstallSkill(globalSkill!);

    expect(desktopCommands.map((entry) => entry.command)).toEqual(expect.arrayContaining([
      "listGlobalSkills",
      "readGlobalSkill",
      "writeGlobalSkill",
      "uninstallGlobalSkill",
    ]));
    expect(desktopCommands).toContainEqual({
      command: "writeGlobalSkill",
      args: ["humanizer-zh", "# Humanizer\n\n更新后的说明。\n"],
    });
  });

  test("本地工作区连接服务后仍展示员工电脑的全局 Skill", async () => {
    const desktopCommands: string[] = [];
    let requestedServerGlobalSkills = false;
    installTestWindow({}, async (command) => {
      desktopCommands.push(command);
      if (command === "listGlobalSkills") {
        return [{
          name: "humanizer-zh",
          description: "让中文表达更自然",
          path: "/Users/employee/.agents/skills/humanizer-zh/SKILL.md",
          source: "desktop-global",
        }];
      }
      throw new Error(`unexpected_desktop_command:${command}`);
    });
    setFetch(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/workspace/ws_local/skills")) {
        requestedServerGlobalSkills = url.searchParams.has("includeGlobal");
        return Response.json({
          items: [{
            name: "officecli",
            description: "处理办公文档",
            path: "/workspace/.opencode/skills/officecli/SKILL.md",
          }],
        });
      }
      return Response.json({ error: "unexpected_request", path: url.pathname }, { status: 500 });
    });

    const openworkClient = createOpenworkServerClient({
      baseUrl: "http://127.0.0.1:43123",
      token: "worker-token",
    });
    const openworkServer = createOpenworkServerStore({
      startupPreference: () => "local",
      documentVisible: () => true,
      developerMode: () => false,
      runtimeWorkspaceId: () => "ws_local",
      activeClient: () => null,
      selectedWorkspaceDisplay: () => ({
        id: "local_alias",
        name: "本地工作区",
        path: "/Users/employee/Project",
        preset: "default",
        workspaceType: "local",
      }),
      restartLocalServer: async () => true,
      createRemoteWorkspaceFlow: async () => true,
    });
    const store = createExtensionsStore({
      client: () => null,
      projectDir: () => "/Users/employee/Project",
      selectedWorkspaceId: () => "local_alias",
      selectedWorkspaceRoot: () => "/Users/employee/Project",
      workspaceType: () => "local",
      openworkServer,
      openworkServerConnection: () => ({
        openworkServerClient: openworkClient,
        openworkServerStatus: "connected",
        openworkServerCapabilities: {
          skills: { read: true, write: true, source: "openwork" },
          plugins: { read: true, write: true },
          mcp: { read: true, write: true },
          commands: { read: true, write: true },
          config: { read: true, write: true },
        },
      }),
      runtimeWorkspaceId: () => "ws_local",
      setBusy: () => undefined,
      setBusyLabel: () => undefined,
      setBusyStartedAt: () => undefined,
      setError: () => undefined,
    });

    await store.refreshSkills({ force: true });

    expect(store.skills().map((skill) => skill.name)).toEqual([
      "humanizer-zh",
      "officecli",
    ]);
    expect(requestedServerGlobalSkills).toBe(false);
    expect(desktopCommands).toContain("listGlobalSkills");
  });

  test("公司 Skill 目录不依赖本地工作区目录", async () => {
    installTestWindow({
      "openwork.den.baseUrl": "https://den.test",
      "openwork.den.authToken": "tok_test",
      "openwork.den.activeOrgId": "organization_test",
      "openwork.den.activeOrgName": "Fox",
    });
    let catalogRequests = 0;
    setFetch(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/v1/config-objects")) {
        catalogRequests += 1;
        return Response.json({ items: [companySkillConfigObject(companySkill)], nextCursor: null });
      }
      return Response.json({ error: "unexpected_request", path: url.pathname }, { status: 500 });
    });
    const openworkServer = createOpenworkServerStore({
      startupPreference: () => "remote",
      documentVisible: () => true,
      developerMode: () => false,
      runtimeWorkspaceId: () => null,
      activeClient: () => null,
      selectedWorkspaceDisplay: () => ({
        id: "remote_alias",
        name: "我的远程工作区",
        path: "",
        preset: "default",
        workspaceType: "remote",
      }),
      restartLocalServer: async () => true,
      createRemoteWorkspaceFlow: async () => true,
    });
    const store = createExtensionsStore({
      client: () => null,
      projectDir: () => "",
      selectedWorkspaceId: () => "remote_alias",
      selectedWorkspaceRoot: () => "",
      workspaceType: () => "remote",
      openworkServer,
      runtimeWorkspaceId: () => null,
      setBusy: () => undefined,
      setBusyLabel: () => undefined,
      setBusyStartedAt: () => undefined,
      setError: () => undefined,
    });

    await store.refreshCloudOrgSkills({ force: true });

    expect(catalogRequests).toBe(1);
    expect(store.cloudOrgSkills()).toEqual([companySkill]);
  });

  test("Den 客户端完整保留多文件包和摘要", async () => {
    setFetch(async () => new Response(JSON.stringify({
      items: [
        companySkillConfigObject(companySkill),
        {
          id: "cob_upstream",
          objectType: "skill",
          currentRelativePath: "skills/upstream/SKILL.md",
          title: "普通插件技能",
          latestVersion: { rawSourceText: companySkill.skillText, normalizedPayloadJson: null },
        },
      ],
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    }));

    const skills = await createDenClient({
      baseUrl: "https://den.test",
      token: "tok_test",
    }).listOrgSkills("organization_test");

    expect(skills).toEqual([companySkill]);
  });

  test("Den 返回不完整文件包时拒绝同步，避免把所有已装技能误判为撤权", async () => {
    setFetch(async () => Response.json({
      items: [{
        id: companySkill.id,
        objectType: "skill",
        currentRelativePath: "company-skills/evidence-review/SKILL.md",
        title: companySkill.title,
        description: companySkill.description,
        updatedAt: companySkill.updatedAt,
        latestVersion: {
          rawSourceText: companySkill.skillText,
          normalizedPayloadJson: {
            foxworkSkillBundle: {
              version: 1,
              bundleHash,
              shared: "org",
            },
          },
        },
      }],
    }));

    await expect(createDenClient({
      baseUrl: "https://den.test",
      token: "tok_test",
    }).listOrgSkills("organization_test")).rejects.toThrow("公司服务返回的技能文件不完整");
  });

  test("分享本地技能时通过插件接口发送完整单文件包", async () => {
    installTestWindow({
      "openwork.den.baseUrl": "https://den.test",
      "openwork.den.authToken": "tok_test",
      "openwork.den.activeOrgId": "organization_test",
      "openwork.den.activeOrgSlug": "fox",
      "openwork.den.activeOrgName": "Fox",
    });
    let requestBody: Record<string, unknown> | null = null;
    setFetch(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/v1/plugins") && init?.method === "POST") {
        requestBody = typeof init.body === "string" ? JSON.parse(init.body) : null;
        return Response.json({ ok: true, item: { id: "plg_company_skill" } }, { status: 201 });
      }
      return Response.json({ error: "unexpected_request", path: url.pathname }, { status: 500 });
    });

    await expect(shareInstalledSkillWithCompany({
      description: "审查项目证据",
      name: "evidence-review",
      shared: "org",
      skillText: files[0]!.contents,
    })).resolves.toEqual({
      orgId: "organization_test",
      orgName: "Fox",
      pluginId: "plg_company_skill",
    });
    expect(requestBody).toEqual({
      name: "evidence-review",
      description: "审查项目证据",
      orgWide: true,
      components: [{
        type: "skill",
        input: {
          rawSourceText: files[0]!.contents,
          schemaVersion: "foxwork.skill-bundle.v1",
          normalizedPayloadJson: {
            foxworkSkillBundle: {
              version: 1,
              bundleHash: "1811088c8748e2dc9764a9597fa4b27e1f63854d88a60f98faf85d67755623bf",
              files: [{ path: "SKILL.md", contents: files[0]!.contents }],
              shared: "org",
            },
          },
        },
      }],
    });
  });

  test("安装请求原样传递配套文件并使用公司包摘要", () => {
    expect(buildCompanySkillInstallPayload(companySkill, true)).toEqual({
      sourceId: "company:skill_company_test",
      sourceHash: bundleHash,
      bundleHash,
      files,
      overwrite: true,
    });
  });

  test("优先按 bundleHash 判断更新，并兼容旧导入记录", () => {
    const installedNames = new Set(["evidence-review"]);
    const currentImport = {
      cloudSkillId: companySkill.id,
      installedName: "evidence-review",
      title: companySkill.title,
      description: companySkill.description,
      shared: companySkill.shared,
      bundleHash,
      updatedAt: "2026-07-20T08:00:00.000Z",
      importedAt: Date.now(),
    };

    expect(getCompanySkillInstallState(companySkill, currentImport, installedNames)).toBe("installed");
    expect(getCompanySkillInstallState(
      { ...companySkill, bundleHash: "b".repeat(64) },
      currentImport,
      installedNames,
    )).toBe("update");
    expect(getCompanySkillInstallState(companySkill, currentImport, new Set())).toBe("missing_local");

    const legacyImport = { ...currentImport, bundleHash: null };
    expect(getCompanySkillInstallState(companySkill, legacyImport, installedNames)).toBe("update");
  });

  test("只把已不在当前账号授权列表中的公司技能判定为撤权", () => {
    const imports = {
      [companySkill.id]: {
        cloudSkillId: companySkill.id,
        installedName: "evidence-review",
        title: companySkill.title,
        description: companySkill.description,
        shared: companySkill.shared,
        bundleHash,
        updatedAt: companySkill.updatedAt,
        importedAt: 1,
      },
      skill_revoked: {
        cloudSkillId: "skill_revoked",
        installedName: "revoked-skill",
        title: "revoked-skill",
        description: null,
        shared: null,
        bundleHash: "b".repeat(64),
        updatedAt: null,
        importedAt: 2,
      },
    };

    expect(getRevokedCompanySkillImports([companySkill], imports)).toEqual([
      imports.skill_revoked,
    ]);
  });

  test("工作区导入记录保存 bundleHash 且兼容旧配置", () => {
    const parsed = readWorkspaceCloudImports({
      cloudImports: {
        skills: {
          [companySkill.id]: {
            cloudSkillId: companySkill.id,
            installedName: "evidence-review",
            title: companySkill.title,
            description: companySkill.description,
            shared: companySkill.shared,
            bundleHash,
            updatedAt: companySkill.updatedAt,
            importedAt: 1,
          },
          skill_legacy: {
            cloudSkillId: "skill_legacy",
            installedName: "legacy",
            title: "legacy",
            updatedAt: null,
            importedAt: 2,
          },
        },
      },
    });

    expect(parsed.skills[companySkill.id]?.bundleHash).toBe(bundleHash);
    expect(parsed.skills.skill_legacy?.bundleHash).toBeNull();
  });

  test("SeeWayWork 通过文件包接口安装并把摘要写入工作区配置", async () => {
    const requests: Array<{ method: string; path: string; body: unknown }> = [];
    let savedOpenworkConfig: Record<string, unknown> = {};
    setFetch(async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      requests.push({ method, path: url.pathname, body });

      if (method === "POST" && url.pathname.endsWith("/skills/catalog/evidence-review")) {
        return Response.json({
          ok: true,
          name: "evidence-review",
          path: "/workspace/.opencode/skills/evidence-review",
          sourceId: `company:${companySkill.id}`,
          sourceHash: bundleHash,
          bundleHash,
          action: "added",
          written: 2,
        });
      }
      if (method === "GET" && url.pathname.endsWith("/config")) {
        return Response.json({ opencode: {}, openwork: savedOpenworkConfig });
      }
      if (method === "PATCH" && url.pathname.endsWith("/config")) {
        const next = body && typeof body === "object" && "openwork" in body
          ? body.openwork
          : null;
        savedOpenworkConfig = next && typeof next === "object" ? next : {};
        return Response.json({ updatedAt: Date.now() });
      }
      if (method === "GET" && url.pathname.endsWith("/skills")) {
        return Response.json({
          items: [{
            name: "evidence-review",
            description: "审查项目证据",
            path: "/workspace/.opencode/skills/evidence-review/SKILL.md",
            trigger: null,
          }],
        });
      }
      return Response.json({ error: "unexpected_request", path: url.pathname }, { status: 500 });
    });

    const openworkClient = createOpenworkServerClient({
      baseUrl: "http://openwork.test",
      token: "client-token",
    });
    const openworkServer = createOpenworkServerStore({
      startupPreference: () => "local",
      documentVisible: () => true,
      developerMode: () => false,
      runtimeWorkspaceId: () => "workspace_test",
      activeClient: () => null,
      selectedWorkspaceDisplay: () => ({
        id: "workspace_test",
        name: "员工工作区",
        path: "/workspace",
        preset: "default",
        workspaceType: "local",
      }),
      restartLocalServer: async () => true,
      createRemoteWorkspaceFlow: async () => true,
    });
    const store = createExtensionsStore({
      client: () => null,
      projectDir: () => "/workspace",
      selectedWorkspaceId: () => "workspace_test",
      selectedWorkspaceRoot: () => "/workspace",
      workspaceType: () => "local",
      openworkServer,
      openworkServerConnection: () => ({
        openworkServerClient: openworkClient,
        openworkServerStatus: "connected",
        openworkServerCapabilities: {
          skills: { read: true, write: true, source: "openwork" },
          plugins: { read: true, write: true },
          mcp: { read: true, write: true },
          commands: { read: true, write: true },
          config: { read: true, write: true },
        },
      }),
      runtimeWorkspaceId: () => "workspace_test",
      setBusy: () => undefined,
      setBusyLabel: () => undefined,
      setBusyStartedAt: () => undefined,
      setError: () => undefined,
    });

    await expect(store.installCloudOrgSkill(companySkill)).resolves.toMatchObject({ ok: true });

    const installRequest = requests.find((request) => request.path.endsWith("/skills/catalog/evidence-review"));
    expect(installRequest?.body).toEqual(buildCompanySkillInstallPayload(companySkill, false));
    expect(readWorkspaceCloudImports(savedOpenworkConfig).skills[companySkill.id]).toMatchObject({
      installedName: "evidence-review",
      bundleHash,
    });
  });

  test("管理员撤销授权后，SeeWayWork 删除工作区文件并清理导入记录", async () => {
    installTestWindow({
      "openwork.den.baseUrl": "https://den.test",
      "openwork.den.authToken": "tok_test",
      "openwork.den.activeOrgId": "organization_test",
      "openwork.den.activeOrgName": "Fox",
    });
    const deletedSkills: string[] = [];
    let savedOpenworkConfig: Record<string, unknown> = {
      cloudImports: {
        skills: {
          [companySkill.id]: {
            cloudSkillId: companySkill.id,
            installedName: "evidence-review",
            title: companySkill.title,
            description: companySkill.description,
            shared: companySkill.shared,
            bundleHash,
            updatedAt: companySkill.updatedAt,
            importedAt: 1,
          },
        },
      },
    };
    setFetch(async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      if (url.host === "den.test" && url.pathname.endsWith("/v1/config-objects")) {
        return Response.json({ items: [], nextCursor: null });
      }
      if (method === "GET" && url.pathname.endsWith("/config")) {
        return Response.json({ opencode: {}, openwork: savedOpenworkConfig });
      }
      if (method === "PATCH" && url.pathname.endsWith("/config")) {
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
        savedOpenworkConfig = body && typeof body === "object" && "openwork" in body && body.openwork
          && typeof body.openwork === "object"
          ? body.openwork
          : {};
        return Response.json({ updatedAt: Date.now() });
      }
      if (method === "GET" && url.pathname.endsWith("/skills")) {
        return Response.json({
          items: deletedSkills.includes("evidence-review")
            ? []
            : [{
                name: "evidence-review",
                description: "审查项目证据",
                path: "/workspace/.opencode/skills/evidence-review/SKILL.md",
                trigger: null,
              }],
        });
      }
      if (method === "DELETE" && url.pathname.endsWith("/skills/evidence-review")) {
        deletedSkills.push("evidence-review");
        return Response.json({ path: "/workspace/.opencode/skills/evidence-review" });
      }
      return Response.json({ error: "unexpected_request", path: url.pathname }, { status: 500 });
    });

    const openworkClient = createOpenworkServerClient({
      baseUrl: "http://openwork.test",
      token: "client-token",
    });
    const openworkServer = createOpenworkServerStore({
      startupPreference: () => "local",
      documentVisible: () => true,
      developerMode: () => false,
      runtimeWorkspaceId: () => "workspace_test",
      activeClient: () => null,
      selectedWorkspaceDisplay: () => ({
        id: "workspace_test",
        name: "员工工作区",
        path: "/workspace",
        preset: "default",
        workspaceType: "local",
      }),
      restartLocalServer: async () => true,
      createRemoteWorkspaceFlow: async () => true,
    });
    const store = createExtensionsStore({
      client: () => null,
      projectDir: () => "/workspace",
      selectedWorkspaceId: () => "workspace_test",
      selectedWorkspaceRoot: () => "/workspace",
      workspaceType: () => "local",
      openworkServer,
      openworkServerConnection: () => ({
        openworkServerClient: openworkClient,
        openworkServerStatus: "connected",
        openworkServerCapabilities: {
          skills: { read: true, write: true, source: "openwork" },
          plugins: { read: true, write: true },
          mcp: { read: true, write: true },
          commands: { read: true, write: true },
          config: { read: true, write: true },
        },
      }),
      runtimeWorkspaceId: () => "workspace_test",
      setBusy: () => undefined,
      setBusyLabel: () => undefined,
      setBusyStartedAt: () => undefined,
      setError: () => undefined,
    });

    await store.refreshCloudOrgSkills({ force: true });

    expect(deletedSkills).toEqual(["evidence-review"]);
    expect(readWorkspaceCloudImports(savedOpenworkConfig).skills).toEqual({});
  });

  test("登录或恢复连接后自动更新已安装的公司 Skill，并自动安装新下发的 Skill", async () => {
    const requests: Array<{ method: string; path: string; body: unknown }> = [];
    let savedOpenworkConfig: Record<string, unknown> = {
      cloudImports: {
        skills: {
          [companySkill.id]: {
            cloudSkillId: companySkill.id,
            installedName: "evidence-review",
            title: companySkill.title,
            description: companySkill.description,
            shared: companySkill.shared,
            bundleHash: "b".repeat(64),
            updatedAt: "2026-07-20T08:00:00.000Z",
            importedAt: 1,
          },
        },
      },
    };
    const newCompanySkill: DenOrgSkillCard = {
      ...companySkill,
      id: "skill_not_installed",
      title: "brief-writer",
      bundleHash: "c".repeat(64),
    };

    setFetch(async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      requests.push({ method, path: url.pathname, body });

      if (method === "GET" && url.pathname.endsWith("/config")) {
        return Response.json({ opencode: {}, openwork: savedOpenworkConfig });
      }
      if (method === "GET" && url.pathname.endsWith("/skills")) {
        return Response.json({
          items: [{
            name: "evidence-review",
            description: "旧版本",
            path: "/workspace/.opencode/skills/evidence-review/SKILL.md",
            trigger: null,
          }],
        });
      }
      if (method === "POST" && url.pathname.endsWith("/skills/catalog/evidence-review")) {
        return Response.json({
          ok: true,
          name: "evidence-review",
          path: "/workspace/.opencode/skills/evidence-review",
          sourceId: `company:${companySkill.id}`,
          sourceHash: companySkill.bundleHash,
          bundleHash: companySkill.bundleHash,
          action: "updated",
          written: companySkill.files.length,
        });
      }
      if (method === "POST" && url.pathname.endsWith("/skills/catalog/brief-writer")) {
        return Response.json({
          ok: true,
          name: "brief-writer",
          path: "/workspace/.opencode/skills/brief-writer",
          sourceId: `company:${newCompanySkill.id}`,
          sourceHash: newCompanySkill.bundleHash,
          bundleHash: newCompanySkill.bundleHash,
          action: "installed",
          written: newCompanySkill.files.length,
        });
      }
      if (method === "PATCH" && url.pathname.endsWith("/config")) {
        savedOpenworkConfig = body?.openwork ?? {};
        return Response.json({ updatedAt: Date.now() });
      }
      return Response.json({ error: "unexpected_request", path: url.pathname }, { status: 500 });
    });

    const result = await reconcileImportedCompanySkills({
      availableSkills: [companySkill, newCompanySkill],
      openworkClient: createOpenworkServerClient({
        baseUrl: "http://openwork.test",
        token: "client-token",
      }),
      workspaceId: "workspace_test",
      includeGlobal: true,
      now: () => 100,
    });

    expect(result).toMatchObject({
      installed: ["brief-writer"],
      updated: ["evidence-review"],
      removed: [],
      failed: [],
    });
    expect(requests.some((request) => request.path.endsWith("/skills/catalog/brief-writer"))).toBe(true);
    expect(readWorkspaceCloudImports(savedOpenworkConfig).skills[companySkill.id]).toMatchObject({
      bundleHash: companySkill.bundleHash,
      importedAt: 1,
    });
    expect(readWorkspaceCloudImports(savedOpenworkConfig).skills[newCompanySkill.id]).toMatchObject({
      installedName: "brief-writer",
      bundleHash: newCompanySkill.bundleHash,
      importedAt: 100,
    });
  });

  test("公司 Skill 自动同步监听登录配置、网络恢复、窗口聚焦和重新可见", () => {
    const windowTarget = new EventTarget();
    const documentTarget = new EventTarget();
    const reasons: string[] = [];
    let visible = false;
    const unsubscribe = subscribeCompanySkillSyncTriggers({
      windowTarget,
      documentTarget,
      isDocumentVisible: () => visible,
      sync: (reason) => reasons.push(reason),
    });

    windowTarget.dispatchEvent(new Event("openwork-den-settings-changed"));
    windowTarget.dispatchEvent(new Event("online"));
    windowTarget.dispatchEvent(new Event("focus"));
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    visible = true;
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    unsubscribe();
    windowTarget.dispatchEvent(new Event("online"));

    expect(reasons).toEqual(["sign_in", "network_recovered", "app_resume", "app_resume"]);
  });

  test("员工退出公司账号后自动撤销当前工作区中已安装的公司 Skill", async () => {
    const deletedSkills: string[] = [];
    let savedOpenworkConfig: Record<string, unknown> = {
      cloudImports: {
        skills: {
          [companySkill.id]: {
            cloudSkillId: companySkill.id,
            installedName: "evidence-review",
            title: companySkill.title,
            description: companySkill.description,
            shared: companySkill.shared,
            bundleHash,
            updatedAt: companySkill.updatedAt,
            importedAt: 1,
          },
        },
      },
    };
    setFetch(async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      if (method === "GET" && url.pathname.endsWith("/config")) {
        return Response.json({ opencode: {}, openwork: savedOpenworkConfig });
      }
      if (method === "GET" && url.pathname.endsWith("/skills")) {
        return Response.json({
          items: deletedSkills.length
            ? []
            : [{ name: "evidence-review", description: "审查项目证据", path: "/workspace/SKILL.md" }],
        });
      }
      if (method === "DELETE" && url.pathname.endsWith("/skills/evidence-review")) {
        deletedSkills.push("evidence-review");
        return Response.json({ ok: true, path: "/workspace/.opencode/skills/evidence-review" });
      }
      if (method === "PATCH" && url.pathname.endsWith("/config")) {
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
        savedOpenworkConfig = body?.openwork ?? {};
        return Response.json({ updatedAt: Date.now() });
      }
      return Response.json({ error: "unexpected_request", path: url.pathname }, { status: 500 });
    });

    const result = await syncCompanySkillsInBackground({
      authStatus: "signed_out",
      openworkClient: createOpenworkServerClient({
        baseUrl: "http://openwork.test",
        token: "client-token",
      }),
      workspaceId: "workspace_test",
      includeGlobal: true,
      denClient: null,
      orgId: null,
    });

    expect(result.outcome).toBe("synced");
    expect(result.result?.removed).toEqual(["evidence-review"]);
    expect(readWorkspaceCloudImports(savedOpenworkConfig).skills).toEqual({});
  });
});
