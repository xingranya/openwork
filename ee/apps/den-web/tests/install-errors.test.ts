import { describe, expect, test } from "bun:test";
import { getInstallConfigErrorMessage } from "../app/(den)/_lib/install-errors";

describe("getInstallConfigErrorMessage", () => {
  test("过期或失效链接不暴露 API 错误码", () => {
    const message = getInstallConfigErrorMessage({ error: "install_link_not_found" }, 404);

    expect(message).not.toContain("install_link_not_found");
    expect(message).not.toContain("_");
    expect(message).toBe("安装链接已过期或失效，请联系公司管理员获取新链接。");
  });

  test("其他失败保留服务端提供的中文提示", () => {
    expect(getInstallConfigErrorMessage({ message: "请稍后重试。" }, 503)).toBe("请稍后重试。");
  });
});
