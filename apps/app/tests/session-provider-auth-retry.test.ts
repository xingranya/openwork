import { describe, expect, test } from "bun:test";

import {
  buildCloudProviderSyncContextIdentity,
  cloudProviderSyncRetryDelay,
} from "../src/react-app/domains/connections/provider-auth/use-session-provider-auth";

describe("公司模型首次同步重试", () => {
  test("远程运行环境尚未就绪时只进行两次延迟重试", () => {
    expect(cloudProviderSyncRetryDelay(1)).toBe(1_000);
    expect(cloudProviderSyncRetryDelay(2)).toBe(3_000);
    expect(cloudProviderSyncRetryDelay(3)).toBeNull();
  });

  test("切换员工账号时不复用上一位员工的模型同步完成状态", () => {
    const common = {
      denBaseUrl: "https://den.seeway.test",
      activeOrgId: "org_company",
      workspaceId: "worker_personal",
      workspaceRoot: "/workspace/company",
    };

    expect(buildCloudProviderSyncContextIdentity({ ...common, userId: "user_alice" }))
      .not.toBe(buildCloudProviderSyncContextIdentity({ ...common, userId: "user_bob" }));
  });
});
