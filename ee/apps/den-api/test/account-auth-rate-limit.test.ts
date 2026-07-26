import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

const denApiRoot = join(import.meta.dir, "..")

describe("公司账号入口不限流", () => {
  test("关闭 Better Auth 限流并移除登录锁定实现", () => {
    const authSource = readFileSync(join(denApiRoot, "src/auth.ts"), "utf8")
    const authRoutesSource = readFileSync(join(denApiRoot, "src/routes/auth/index.ts"), "utf8")
    const protectionSource = readFileSync(join(denApiRoot, "src/auth-protection.ts"), "utf8")

    expect(authSource).toContain("rateLimit: {\n    enabled: false,")
    expect(authRoutesSource).not.toContain("login_locked")
    expect(authRoutesSource).not.toContain("getEmailPasswordLockoutResponse")
    expect(protectionSource).not.toContain("LOGIN_LOCKOUT")
    expect(protectionSource).not.toContain("email-password-lockout")
  })
})
