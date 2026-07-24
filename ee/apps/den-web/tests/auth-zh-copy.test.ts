import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const sourcePaths = [
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
      "打开 FoxWork",
      'alt="FoxWork"',
      "返回登录",
      "登录状态已经失效，请重新登录。",
    ];

    for (const copy of requiredCopy) {
      expect(source).toContain(copy);
    }
  });
});
