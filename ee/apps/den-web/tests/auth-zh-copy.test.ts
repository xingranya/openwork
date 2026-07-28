import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "bun:test";
import {
  DenRequestNetworkError,
  getErrorMessage,
  requestJson,
} from "../app/(den)/_lib/den-flow";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const sourcePaths = [
  "../app/layout.tsx",
  "../app/(den)/_components/auth-screen.tsx",
  "../app/(den)/_components/auth-panel.tsx",
  "../app/(den)/_components/reset-password-screen.tsx",
  "../app/(den)/_lib/den-flow.ts",
  "../app/(den)/_providers/den-flow-provider.tsx",
].map((path) => fileURLToPath(new URL(path, import.meta.url)));

const source = sourcePaths.map((path) => readFileSync(path, "utf8")).join("\n");

describe("Den 账号入口中文文案", () => {
  test("登录、注册、验证码和密码重置不再使用旧英文文案", () => {
    const oldCopy = [
      "Checking account",
      "Opening workspace",
      "Start using OpenWork",
      "Create your account.",
      "Verify your email.",
      "Reset your password.",
      "Choose a new password.",
      "Forgot password?",
      "Verification code",
      "Back to sign in",
      "Open the desktop app to continue.",
      "No active session found. Sign in first.",
      "Authentication succeeded, but session details are still syncing.",
    ];

    for (const copy of oldCopy) {
      expect(source).not.toContain(copy);
    }
  });

  test("保留员工需要看到的中文操作提示", () => {
    const requiredCopy = [
      "登录公司工作区",
      "创建公司账号",
      "验证邮箱",
      "重置密码",
      "打开 SeeWayWork",
      'alt="SeeWayWork"',
      '<html lang="zh-CN"',
      "返回登录",
      "登录状态已经失效，请重新登录。",
    ];

    for (const copy of requiredCopy) {
      expect(source).toContain(copy);
    }
  });

  test("未知英文服务错误统一回退为当前操作的中文提示", () => {
    expect(getErrorMessage(
      { message: "The upstream service failed unexpectedly." },
      "加载公司信息失败，请重试。",
    )).toBe("加载公司信息失败，请重试。");
    expect(getErrorMessage(
      { error: "permission denied" },
      "保存失败，请重试。",
    )).toBe("当前账号没有执行此操作的权限。");
    expect(getErrorMessage(
      "<!doctype html><html><body>Bad Gateway</body></html>",
      "加载管理员数据失败。",
    )).toBe("加载管理员数据失败。 公司服务返回了异常页面。");
  });

  test("浏览器网络异常不会暴露英文原始错误", async () => {
    const failingFetch: typeof fetch = async () => {
      throw new TypeError("Failed to fetch");
    };
    globalThis.fetch = failingFetch;

    const error = await requestJson("/v1/me").catch((failure) => failure);

    expect(error).toBeInstanceOf(DenRequestNetworkError);
    expect(error.message).toBe("无法连接公司服务，请检查网络后重试。");
    expect(error.message).not.toContain("Failed to fetch");
  });
});
