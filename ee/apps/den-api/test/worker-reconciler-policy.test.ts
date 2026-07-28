import { beforeAll, describe, expect, test } from "bun:test";

let shouldRunWorkerProvisioningReconcile: typeof import("../src/workers/reconciler").shouldRunWorkerProvisioningReconcile;

beforeAll(async () => {
  process.env.DATABASE_URL ??= "mysql://root:password@127.0.0.1:3306/openwork_test";
  process.env.DEN_DB_ENCRYPTION_KEY ??= "x".repeat(32);
  process.env.BETTER_AUTH_SECRET ??= "y".repeat(32);
  process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:8790";
  ({ shouldRunWorkerProvisioningReconcile } = await import("../src/workers/reconciler"));
});

describe("Worker 准备状态协调策略", () => {
  test("占位 Provisioner 不重复创建永远无法就绪的实例", () => {
    expect(shouldRunWorkerProvisioningReconcile("stub")).toBe(false);
  });

  test.each(["render", "daytona", "kubernetes"] as const)(
    "%s Provisioner 保留异常恢复能力",
    (mode) => {
      expect(shouldRunWorkerProvisioningReconcile(mode)).toBe(true);
    },
  );
});
