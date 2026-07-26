import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/**
 * 向 AI 注入 FoxWork 的真实产品边界和员工可用能力。
 * 内部工具标识保持兼容，员工可见的说明和回答统一使用 FoxWork 名称。
 */
const OPENWORK_CAPABILITIES_KNOWLEDGE = `你正在 FoxWork 中运行。FoxWork 是公司统一的 AI 工作客户端，员工只需要安装和登录这一个软件。

## 必须遵守的规则
- 操作 FoxWork 界面时，使用 openwork_ui_execute_action，不要把内置页面当作普通网页操作。
- 回答 FoxWork 使用问题前，先使用 openwork_docs_search 检索随包中文说明，再用 openwork_docs_read 读取相关页面。说明找不到或与现场不符时，如实说明，不得引用上游产品网站或猜测公司配置。
- 公司 Den 负责账号、团队、远程工作区、共享模型、MCP、Skills 和插件分发。员工登录成功后自动连接个人远程工作区，不要求手工填写地址或连接密钥。
- Brand Project OS 负责项目资料、证据、Proposal、审批和正式状态。AI 只能创建待确认事项，不能替员工批准正式变化、修改正式事实、指定负责人或承诺截止时间。
- 访问本机文件、终端、浏览器、摄像头、麦克风和桌面控制必须经过 FoxWork 本机授权。公司服务器、MCP 和工作流不得绕过本机权限。
- 只能使用当前账号、团队和项目权限开放的能力。权限不足时说明缺少哪项权限，不要建议绕过权限或直接联系第三方上游服务。
- 所有面向员工的回答使用简体中文。内部运行时名称、配置键和上游品牌只在排障确有必要时说明，正常使用说明中不要展示。

## 账号与工作区
- 员工通过公司入口注册或登录 Den。一个账号对应唯一公司组织，不需要第二套 Brand Project OS 账号。
- 登录后 FoxWork 自动建立并连接个人远程工作区。本地工作区和其他获授权远程工作区仍可继续新增。
- 退出、会话失效或管理员撤权后，停止使用公司模型、MCP、Skills 和远程工作区；重新登录后按最新权限同步。

## 模型
- 公司共享模型由管理员在 Den 配置，员工只看到自己有权使用的模型。
- 本地工作区允许添加常用国内供应商，也允许配置兼容 OpenAI 或 Anthropic 协议的自定义地址和模型 ID。
- 不读取、展示或转存员工个人模型密钥。模型不可用时给出中文错误，并建议检查连接或切换已授权模型。

## MCP、Skills 与插件
- 公司 MCP、Skills 和插件由 Den 按成员或团队下发。它们只能执行获授权工具，不能获得人工审批权。
- 本地自定义 MCP 属于高级能力，只在员工主动配置时使用。不要把公司能力重复配置为本地连接。
- 在线技能从 FoxWork 的“技能”页面浏览和安装；安装前执行安全检查，高风险内容不得安装。
- 导出能力时可使用 openwork_extensions_export；结果中的密钥字段必须保持脱敏，不能写入插件包或聊天回复。

## 本机能力
- 文件权限在“设置 > 权限”管理。读取失败时指出具体路径，并让员工主动授权对应文件夹。
- 桌面控制需要 macOS 辅助功能和屏幕录制权限。只有员工主动启用后才能截图、点击或输入。
- 内置浏览器可打开、导航和截图网页。涉及登录、发布、付款、删除或其他外部变化时，仍需员工确认。

## 项目工作
- 项目资料、会议、多媒体分析和当前状态以 Brand Project OS 返回的证据和版本为准，聊天记录和远程工作区文件不是正式状态源。
- 新资料和新会议只产生增量 Proposal。回答重要结论时保留原件、版本、页码、时间码或其他来源定位。
- 员工要求确认正式变化时，引导其在 FoxWork 的待确认事项中操作，不要把普通工具授权当作业务批准。

常用说明：
- account/sign-in-and-workspaces.mdx：登录、退出和工作区
- ai/models.mdx：公司模型与本地模型
- company/company-capabilities.mdx：公司 MCP、Skills、插件和权限
- security/local-permissions.mdx：本机授权
- project/brand-project-work.mdx：项目资料与待确认事项
- troubleshooting/connection-and-recovery.mdx：连接诊断与恢复`;

const docsSearchArgsSchema = z.object({
  query: z.string().min(1).describe("要检索的 FoxWork 使用问题，例如“登录远程工作区”。"),
  limit: z.number().int().min(1).max(10).optional().describe("最多返回多少条相关说明。"),
});

const docsReadArgsSchema = z.object({
  path: z.string().min(1).describe("openwork_docs_search 返回的说明文件相对路径。"),
});

type DocsEntry = {
  path: string;
  title: string | null;
  description: string | null;
  content: string;
};

let docsCache: Promise<DocsEntry[]> | null = null;

function docsCandidates(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return [
    process.env.FOXWORK_DOCS_DIR?.trim() ?? "",
    join(here, "..", "foxwork-docs"),
    join(here, "..", "..", "foxwork-docs"),
    resolve(here, "..", "..", "..", "..", "packages", "foxwork-docs"),
    resolve(here, "..", "..", "..", "..", "..", "packages", "foxwork-docs"),
  ].filter(Boolean);
}

async function existingDocsDir(): Promise<string | null> {
  for (const candidate of docsCandidates()) {
    try {
      const info = await stat(candidate);
      if (info.isDirectory()) return candidate;
    } catch {
      // 继续尝试开发目录或发行包中的下一个候选位置。
    }
  }
  return null;
}

async function docsFiles(root: string, dir = root): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "images" || entry.name === "logo") continue;
      const nested = await docsFiles(root, path);
      files.push(...nested);
    } else if (entry.isFile() && /\.(md|mdx|json)$/i.test(entry.name) && entry.name !== "openapi.json") {
      files.push(path);
    }
  }
  return files;
}

function frontmatterValue(content: string, key: string): string | null {
  const prefix = `${key}:`;
  const line = content.split("\n").find((entry) => entry.startsWith(prefix));
  const raw = line?.slice(prefix.length).trim();
  if (!raw) return null;
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1).trim();
  }
  return raw;
}

async function loadDocs(): Promise<DocsEntry[]> {
  if (docsCache) return docsCache;
  docsCache = (async () => {
    const root = await existingDocsDir();
    if (!root) return [];
    const files = await docsFiles(root);
    const entries = await Promise.all(files.map(async (file) => {
      const content = await readFile(file, "utf8");
      return {
        path: relative(root, file).replace(/\\/g, "/"),
        title: frontmatterValue(content, "title"),
        description: frontmatterValue(content, "description"),
        content,
      };
    }));
    return entries.sort((a, b) => a.path.localeCompare(b.path));
  })();
  return docsCache;
}

function scoreDoc(entry: DocsEntry, query: string): number {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const path = entry.path.toLowerCase();
  const title = entry.title?.toLowerCase() ?? "";
  const description = entry.description?.toLowerCase() ?? "";
  const content = entry.content.toLowerCase();
  return terms.reduce((score, term) => {
    if (path.includes(term)) score += 8;
    if (title.includes(term)) score += 6;
    if (description.includes(term)) score += 4;
    if (content.includes(term)) score += 1;
    return score;
  }, 0);
}

function excerpt(content: string, query: string): string {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = content.toLowerCase();
  const index = terms.reduce((best, term) => {
    const next = lower.indexOf(term);
    return next >= 0 && (best < 0 || next < best) ? next : best;
  }, -1);
  const start = Math.max(0, index - 160);
  const from = index >= 0 ? start : 0;
  return content.slice(from, from + 500).replace(/\s+/g, " ").trim();
}

export const OpenWorkCapabilitiesKnowledge = async () => ({
  "experimental.chat.system.transform": async (_input: unknown, output: { system: string[] }) => {
    output.system.push(OPENWORK_CAPABILITIES_KNOWLEDGE);
  },
  tool: {
    openwork_docs_search: {
      description: "检索随 FoxWork 安装的中文使用说明。回答 FoxWork 使用问题时优先调用。",
      args: docsSearchArgsSchema.shape,
      async execute(rawArgs: unknown) {
        const args = docsSearchArgsSchema.parse(rawArgs);
        const docs = await loadDocs();
        const matches = docs
          .map((entry) => ({ entry, score: scoreDoc(entry, args.query) }))
          .filter((match) => match.score > 0)
          .sort((a, b) => b.score - a.score || a.entry.path.localeCompare(b.entry.path))
          .slice(0, args.limit ?? 5)
          .map((match) => ({
            path: match.entry.path,
            title: match.entry.title,
            description: match.entry.description,
            excerpt: excerpt(match.entry.content, args.query),
          }));
        return JSON.stringify({ ok: true, matches }, null, 2);
      },
    },
    openwork_docs_read: {
      description: "读取 openwork_docs_search 返回的 FoxWork 中文说明页面。",
      args: docsReadArgsSchema.shape,
      async execute(rawArgs: unknown) {
        const args = docsReadArgsSchema.parse(rawArgs);
        const normalized = args.path.replace(/^\/+/, "");
        if (normalized.split("/").includes("..")) throw new Error("说明文件路径无效");
        const docs = await loadDocs();
        const entry = docs.find((doc) => doc.path === normalized);
        if (!entry) throw new Error(`未找到 FoxWork 说明页面：${normalized}`);
        return JSON.stringify(entry, null, 2);
      },
    },
  },
});
