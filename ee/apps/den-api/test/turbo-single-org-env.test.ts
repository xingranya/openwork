import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { validateDevSingleOrgConfig } from "../../../../scripts/dev-single-org-config.mjs"

test("Turbo 启动 Den 时保留单组织和桌面交接配置", () => {
  const turboPath = fileURLToPath(new URL("../../../../turbo.json", import.meta.url))
  const config = JSON.parse(readFileSync(turboPath, "utf8")) as { globalEnv?: unknown }
  const globalEnv = Array.isArray(config.globalEnv) ? config.globalEnv : []

  expect(globalEnv).toEqual(expect.arrayContaining([
    "DEN_SINGLE_ORG_NAME",
    "DEN_SINGLE_ORG_SLUG",
    "DEN_SINGLE_ORG_OWNER_EMAILS",
    "DEN_BOOTSTRAP_ADMIN_EMAILS",
    "DEN_SINGLE_ORG_ALLOW_PUBLIC_SIGNUP",
    "DEN_REQUIRE_EMAIL_VERIFICATION",
    "OPENWORK_APP_PORT",
  ]))
})

test("单组织本地启动要求预设所有者和后台管理员邮箱", () => {
  expect(validateDevSingleOrgConfig({
    orgMode: "single_org",
    ownerEmails: "",
    bootstrapAdminEmails: "admin@example.test",
  })).toContain("DEN_SINGLE_ORG_OWNER_EMAILS")

  expect(validateDevSingleOrgConfig({
    orgMode: "single_org",
    ownerEmails: "owner@example.test",
    bootstrapAdminEmails: "",
  })).toContain("DEN_BOOTSTRAP_ADMIN_EMAILS")

  expect(validateDevSingleOrgConfig({
    orgMode: "single_org",
    ownerEmails: "owner@example.test",
    bootstrapAdminEmails: "admin@example.test",
  })).toBeNull()
})

test("多组织开发模式不要求单组织管理员配置", () => {
  expect(validateDevSingleOrgConfig({
    orgMode: "multi_org",
    ownerEmails: "",
    bootstrapAdminEmails: "",
  })).toBeNull()
})
