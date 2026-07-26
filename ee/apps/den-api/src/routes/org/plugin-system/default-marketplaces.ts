/**
 * 每个公司组织首次打开能力市场时使用的 FoxWork 内置内容。
 *
 * 这里不能预置第三方市场、外部仓库或外部图标。公司能力必须由管理员
 * 在 Den 中显式发布，服务器启动和员工登录也不能因为读取市场而向上游
 * 服务发起请求。
 */

export const DEFAULT_FOXWORK_MARKETPLACE_NAME = "FoxWork 公司能力"
export const DEFAULT_FOXWORK_MARKETPLACE_DESCRIPTION = "公司统一发布的 MCP、Skill、插件和工作方法。"
export const DEFAULT_FOXWORK_MARKETPLACE_LOGO_URL = "/openwork-mark.svg"

export type DefaultMarketplacePluginEntry = {
  name: string
  description: string
}
