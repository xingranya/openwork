import { describe, expect, test } from "bun:test";

import {
  createRouteRefreshFlight,
  withRouteRefreshTimeout,
} from "../src/react-app/shell/route-refresh-flight";

describe("工作区路由刷新协调", () => {
  test("并发请求共同等待正在执行的刷新，而不是提前返回", async () => {
    const flight = createRouteRefreshFlight();
    let complete: (() => void) | null = null;
    let calls = 0;
    const operation = async () => {
      calls += 1;
      await new Promise<void>((resolve) => {
        complete = resolve;
      });
    };

    const first = flight.run(operation);
    const second = flight.run(operation);
    await Promise.resolve();

    expect(calls).toBe(1);
    expect(second).toBe(first);
    expect(complete).not.toBeNull();
    complete?.();
    await first;

    await flight.run(async () => {
      calls += 1;
    });
    expect(calls).toBe(2);
  });

  test("无响应的连接会在限定时间后给出中文错误", async () => {
    await expect(withRouteRefreshTimeout(
      new Promise<never>(() => undefined),
      "公司服务连接",
      1,
    )).rejects.toThrow("公司服务连接响应超时");
  });
});
