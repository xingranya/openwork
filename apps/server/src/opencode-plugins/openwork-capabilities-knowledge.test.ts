import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { OpenWorkCapabilitiesKnowledge } from "./openwork-capabilities-knowledge.js";

describe("FoxWork 能力说明插件", () => {
  test("只注入公司当前可用的中文产品边界", async () => {
    const plugin = await OpenWorkCapabilitiesKnowledge();
    const output = { system: [] };

    await plugin["experimental.chat.system.transform"]({}, output);

    const knowledge = output.system.join("\n");
    expect(knowledge).toContain("你正在 FoxWork 中运行");
    expect(knowledge).toContain("公司 Den");
    expect(knowledge).toContain("Brand Project OS");
    expect(knowledge).toContain("只能创建待确认事项");
    expect(knowledge).toContain("必须经过 FoxWork 本机授权");
    expect(knowledge).toContain("openwork_docs_search");
    expect(knowledge).toContain("不能代替真实的公司连接、在线技能或服务操作");
    expect(knowledge).toContain("当前账号运行时实际返回");
    expect(knowledge).toContain("当前运行时实际列出的远程“创建技能”能力");
    expect(knowledge).toContain("openwork_context");
    expect(knowledge).toContain("openwork_execute");
    expect(knowledge).not.toContain("OpenWork Cloud");
    expect(knowledge).not.toContain("OpenCode");
    expect(knowledge).not.toContain("openworklabs.com");
    expect(knowledge).not.toContain("opencode mcp");
  });

  test("从随包中文说明检索登录和个人远程工作区", async () => {
    process.env.FOXWORK_DOCS_DIR = resolve(import.meta.dir, "../../../../packages/foxwork-docs");

    const plugin = await OpenWorkCapabilitiesKnowledge();
    const search = await plugin.tool.openwork_docs_search.execute({ query: "登录 远程工作区", limit: 3 });

    expect(search).toContain("account/sign-in-and-workspaces.mdx");
    expect(search).toContain("登录与工作区");

    const read = await plugin.tool.openwork_docs_read.execute({
      path: "account/sign-in-and-workspaces.mdx",
    });

    expect(read).toContain("登录成功后，SeeWayWork 会自动连接属于你的远程工作区");
    expect(read).toContain("仍可继续新增本地或远程工作区");
    expect(read).not.toContain("OpenWork");
  });

  test("说明公司能力和正式状态的权限边界", async () => {
    process.env.FOXWORK_DOCS_DIR = resolve(import.meta.dir, "../../../../packages/foxwork-docs");

    const plugin = await OpenWorkCapabilitiesKnowledge();
    const search = await plugin.tool.openwork_docs_search.execute({ query: "MCP 权限 待确认", limit: 3 });

    expect(search).toContain("company/company-capabilities.mdx");

    const read = await plugin.tool.openwork_docs_read.execute({
      path: "company/company-capabilities.mdx",
    });

    expect(read).toContain("只能使用账号和团队权限允许的能力");
    expect(read).toContain("AI 只能创建待确认事项，不能替员工批准正式变化");
    expect(read).not.toContain("openworklabs.com");
  });
});
