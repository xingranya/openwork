import { describe, expect, test } from "bun:test";

import { toChineseUserMessage } from "../src/app/lib/user-facing-error";

describe("中文用户错误", () => {
  test("保留已经中文化的服务消息", () => {
    expect(toChineseUserMessage(new Error("公司连接已失效，请重新登录。"), "操作失败。"))
      .toBe("公司连接已失效，请重新登录。");
  });

  test("不向员工显示英文或内部错误", () => {
    expect(toChineseUserMessage(new Error("request failed: ECONNRESET"), "操作失败，请重试。"))
      .toBe("操作失败，请重试。");
    expect(toChineseUserMessage({ code: "INTERNAL_ERROR" }, "操作失败，请重试。"))
      .toBe("操作失败，请重试。");
  });
});
