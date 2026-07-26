/**
 * 预置的外部 MCP 快速添加项，与客户端提供的一键连接项保持一致。
 * 管理员可以在 Den 中一次配置并向公司开放，员工不必逐台重复配置。
 */
export type ExternalMcpPreset = {
  presetId: string
  displayName: string
  description: string
  url: string
  authType: "oauth" | "apikey" | "none"
  requiresOAuthClient?: boolean
}

export const EXTERNAL_MCP_PRESETS: ExternalMcpPreset[] = [
  {
    presetId: "notion",
    displayName: "Notion",
    description: "同步页面、数据库和项目文档。",
    url: "https://mcp.notion.com/mcp",
    authType: "oauth",
  },
  {
    presetId: "linear",
    displayName: "Linear",
    description: "规划迭代并更快交付任务。",
    url: "https://mcp.linear.app/mcp",
    authType: "oauth",
  },
  {
    presetId: "stripe",
    displayName: "Stripe",
    description: "查看付款、发票和订阅信息。",
    url: "https://mcp.stripe.com",
    authType: "oauth",
  },
  {
    presetId: "sentry",
    displayName: "Sentry",
    description: "跟踪发布并处理生产环境错误。",
    url: "https://mcp.sentry.dev/mcp",
    authType: "oauth",
  },
  {
    presetId: "granola",
    displayName: "Granola",
    description: "搜索会议笔记和转写内容。",
    url: "https://mcp.granola.ai/mcp",
    authType: "oauth",
  },
  {
    presetId: "polar",
    displayName: "Polar",
    description: "管理产品、订阅、订单和客户账单。",
    url: "https://mcp.polar.sh/mcp/polar-mcp",
    authType: "oauth",
  },
  {
    presetId: "slack",
    displayName: "Slack",
    description: "搜索频道和私信。Slack 需要先填写公司的 OAuth 应用信息，之后每位成员再连接自己的账号。",
    url: "https://mcp.slack.com/mcp",
    authType: "oauth",
    requiresOAuthClient: true,
  },
  {
    presetId: "exa",
    displayName: "Exa",
    description: "提供网页搜索、代码搜索和研究能力。请填写公司在 Exa 控制台生成的 API 密钥。",
    url: "https://mcp.exa.ai/mcp",
    authType: "apikey",
  },
  {
    presetId: "render",
    displayName: "Render",
    description: "部署和管理服务、数据库及日志。请填写公司在 Render 控制台生成的 API 密钥。",
    url: "https://mcp.render.com/mcp",
    authType: "apikey",
  },
  {
    presetId: "context7",
    displayName: "Context7",
    description: "用更完整的上下文搜索产品文档。",
    url: "https://mcp.context7.com/mcp",
    authType: "none",
  },
]
