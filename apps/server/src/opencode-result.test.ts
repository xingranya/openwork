import { describe, expect, test } from "bun:test";

import { ApiError } from "./errors.js";
import { unwrapOpencodeResult } from "./server.js";

describe("OpenCode SDK 结果处理", () => {
  test("网络错误缺少 response 时返回稳定的 502 错误", () => {
    try {
      unwrapOpencodeResult(
        {
          data: undefined,
          error: { name: "TypeError", message: "fetch failed" },
        },
        "/session",
      );
      throw new Error("预期抛出 ApiError");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        status: 502,
        code: "opencode_request_failed",
        message: "AI 运行服务请求失败",
        details: {
          body: { name: "TypeError", message: "fetch failed" },
          path: "/session",
        },
      });
      expect((error as ApiError).details).not.toHaveProperty("status");
    }
  });

  test("空结果和正常结果保持既有语义", () => {
    expect(unwrapOpencodeResult({ data: ["ses_1"], error: undefined }, "/session")).toEqual(["ses_1"]);
    expect(() => unwrapOpencodeResult({ data: undefined, error: undefined }, "/session")).toThrow(
      "AI 运行服务未返回数据",
    );
  });
});
