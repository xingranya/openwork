import { describe, expect, test } from "bun:test"
import {
  canAccessWorkerTokens,
  formatCloudWorkerLimitReachedMessage,
  shouldEnforceCloudWorkerLimit,
  shouldRequireCloudWorkerBilling,
} from "../src/worker-limit-policy.js"

describe("远程工作区数量策略", () => {
  test("单公司内部部署允许继续新增远程工作区", () => {
    expect(shouldEnforceCloudWorkerLimit("single_org")).toBe(false)
  })

  test("多公司模式保留原有配额控制", () => {
    expect(shouldEnforceCloudWorkerLimit("multi_org")).toBe(true)
  })

  test("单公司托管部署不依赖上游公共云订阅", () => {
    expect(shouldRequireCloudWorkerBilling("single_org")).toBe(false)
    expect(shouldRequireCloudWorkerBilling("multi_org")).toBe(true)
  })

  test("员工只能取得自己 Worker 的连接凭据", () => {
    expect(canAccessWorkerTokens("usr_owner", "usr_owner")).toBe(true)
    expect(canAccessWorkerTokens("usr_owner", "usr_other")).toBe(false)
    expect(canAccessWorkerTokens(null, "usr_owner")).toBe(false)
  })

  test("配额错误使用可直接展示的中文", () => {
    expect(formatCloudWorkerLimitReachedMessage(3)).toBe(
      "当前公司最多可创建 3 个远程工作区，请联系管理员调整配额。",
    )
  })
})
