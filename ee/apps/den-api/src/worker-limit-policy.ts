import type { DenOrgMode } from "./env.js"

/** 单公司内部部署不沿用面向公共云服务的远程工作区数量限制。 */
export function shouldEnforceCloudWorkerLimit(orgMode: DenOrgMode) {
  return orgMode !== "single_org"
}

/** 单公司托管部署使用公司自己的资源，不依赖上游公共云订阅。 */
export function shouldRequireCloudWorkerBilling(orgMode: DenOrgMode) {
  return orgMode !== "single_org"
}

/** Worker 连接凭据只下发给创建该 Worker 的员工。 */
export function canAccessWorkerTokens(
  workerOwnerUserId: string | null,
  currentUserId: string,
) {
  return Boolean(workerOwnerUserId && workerOwnerUserId === currentUserId)
}

/** 返回可直接展示给员工的远程工作区配额提示。 */
export function formatCloudWorkerLimitReachedMessage(limit: number) {
  return `当前公司最多可创建 ${limit} 个远程工作区，请联系管理员调整配额。`
}
