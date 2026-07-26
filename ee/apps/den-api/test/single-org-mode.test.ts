import { beforeAll, expect, test } from "bun:test"

function seedRequiredEnv() {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "mysql://root:password@127.0.0.1:3306/openwork_test"
  process.env.DEN_DB_ENCRYPTION_KEY = process.env.DEN_DB_ENCRYPTION_KEY ?? "x".repeat(32)
  process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "y".repeat(32)
  process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:8790"
  process.env.DEN_SINGLE_ORG_ALLOW_PUBLIC_SIGNUP = process.env.DEN_SINGLE_ORG_ALLOW_PUBLIC_SIGNUP ?? "false"
}

let envModule: typeof import("../src/env.js")
let singleOrgPolicy: typeof import("../src/single-org-policy.js")
let signupPolicy: typeof import("../src/single-org-signup-policy.js")

beforeAll(async () => {
  seedRequiredEnv()
  envModule = await import("../src/env.js")
  singleOrgPolicy = await import("../src/single-org-policy.js")
  signupPolicy = await import("../src/single-org-signup-policy.js")
})

test("blank org mode resolves to single_org", () => {
  expect(envModule.parseDenOrgMode(undefined)).toBe("single_org")
  expect(envModule.parseDenOrgMode("")).toBe("single_org")
  expect(envModule.parseDenOrgMode("   ")).toBe("single_org")
})

test("org mode accepts explicit deployment modes and rejects unknown values", () => {
  expect(envModule.parseDenOrgMode("single_org")).toBe("single_org")
  expect(envModule.parseDenOrgMode("multi_org")).toBe("multi_org")
  expect(() => envModule.parseDenOrgMode("single")).toThrow("DEN_ORG_MODE")
})

test("single-org slug normalization keeps Helm-safe slugs strict", () => {
  expect(envModule.normalizeSingleOrgSlug(undefined)).toBe("default")
  expect(envModule.normalizeSingleOrgSlug(" Acme-Internal ")).toBe("acme-internal")
  expect(() => envModule.normalizeSingleOrgSlug("bad slug")).toThrow("DEN_SINGLE_ORG_SLUG")
})

test("single-org public signup defaults enabled and parses Helm string values", () => {
  expect(envModule.parseSingleOrgAllowPublicSignup(undefined, "single_org")).toBe(true)
  expect(envModule.parseSingleOrgAllowPublicSignup("", "single_org")).toBe(true)
  expect(envModule.parseSingleOrgAllowPublicSignup(" false ", "single_org")).toBe(false)
  expect(envModule.parseSingleOrgAllowPublicSignup("0", "single_org")).toBe(false)
  expect(envModule.parseSingleOrgAllowPublicSignup("true", "single_org")).toBe(true)
  expect(envModule.parseSingleOrgAllowPublicSignup("YES", "single_org")).toBe(true)
  expect(envModule.parseSingleOrgAllowPublicSignup(undefined, "multi_org")).toBe(true)
  expect(() => envModule.parseSingleOrgAllowPublicSignup("sometimes", "single_org")).toThrow("DEN_SINGLE_ORG_ALLOW_PUBLIC_SIGNUP")
})

test("single-org signup policy allows matching domains", async () => {
  const matching = await signupPolicy.resolveSingleOrgEmailSignupPolicyViolation({
    orgMode: "single_org",
    allowPublicSignup: true,
    email: "User@Acme.com",
    getSingletonOrganization: async () => ({ allowedEmailDomains: ["acme.com"] }),
  })
  expect(matching).toBeNull()
})

test("single-org signup policy only lets a configured owner bootstrap an empty deployment", async () => {
  const owner = await signupPolicy.resolveSingleOrgEmailSignupPolicyViolation({
    orgMode: "single_org",
    allowPublicSignup: true,
    email: "Admin@Acme.com",
    ownerEmails: ["admin@acme.com"],
    getSingletonOrganization: async () => null,
  })
  expect(owner).toBeNull()

  const unconfigured = await signupPolicy.resolveSingleOrgEmailSignupPolicyViolation({
    orgMode: "single_org",
    allowPublicSignup: true,
    email: "employee@acme.com",
    ownerEmails: ["admin@acme.com"],
    getSingletonOrganization: async () => null,
  })
  expect(unconfigured).toEqual({
    error: "single_org_owner_uninitialized",
    message: "公司管理员还没有完成首次初始化，请使用预设的管理员邮箱先创建公司账号。",
  })

  const missingConfiguration = await signupPolicy.resolveSingleOrgEmailSignupPolicyViolation({
    orgMode: "single_org",
    allowPublicSignup: true,
    email: "employee@acme.com",
    ownerEmails: [],
    getSingletonOrganization: async () => null,
  })
  expect(missingConfiguration?.error).toBe("single_org_owner_uninitialized")
})

test("single-org signup policy allows ordinary self-registration after the organization exists", async () => {
  const member = await signupPolicy.resolveSingleOrgEmailSignupPolicyViolation({
    orgMode: "single_org",
    allowPublicSignup: true,
    email: "employee@acme.com",
    ownerEmails: ["admin@acme.com"],
    getSingletonOrganization: async () => ({ allowedEmailDomains: null }),
  })
  expect(member).toBeNull()
})

test("single-org signup policy rejects outside domains", async () => {
  const rejected = await signupPolicy.resolveSingleOrgEmailSignupPolicyViolation({
    orgMode: "single_org",
    allowPublicSignup: true,
    email: "user@outside.com",
    getSingletonOrganization: async () => ({ allowedEmailDomains: ["acme.com"] }),
  })
  expect(rejected).toEqual({
    error: "email_domain_restricted",
    message: "公司只允许使用 acme.com 邮箱注册。",
    allowedEmailDomains: ["acme.com"],
  })
})

test("single-org signup policy blocks private email signup and leaves multi-org unchanged", async () => {
  const disabled = await signupPolicy.resolveSingleOrgEmailSignupPolicyViolation({
    orgMode: "single_org",
    allowPublicSignup: false,
    email: "invited@acme.com",
    getSingletonOrganization: async () => {
      throw new Error("private signup should not query the singleton")
    },
  })
  expect(disabled).toEqual({
    error: "single_org_signup_disabled",
    message: "公司已关闭自助注册，请使用公司单点登录或管理员预先创建的账号。",
  })

  const multiOrg = await signupPolicy.resolveSingleOrgEmailSignupPolicyViolation({
    orgMode: "multi_org",
    allowPublicSignup: false,
    email: "user@outside.com",
    getSingletonOrganization: async () => {
      throw new Error("multi-org signup should not query the singleton")
    },
  })
  expect(multiOrg).toBeNull()
})

test("single-org owner bootstrap honors configured owner emails", () => {
  expect(singleOrgPolicy.resolveSingleOrgMembershipRole({
    activeOwnerCount: 0,
    email: "admin@example.com",
    ownerEmails: ["admin@example.com"],
  })).toBe("owner")

  expect(singleOrgPolicy.resolveSingleOrgMembershipRole({
    activeOwnerCount: 0,
    email: "user@example.com",
    ownerEmails: ["admin@example.com"],
  })).toBeNull()

  expect(singleOrgPolicy.resolveSingleOrgMembershipRole({
    activeOwnerCount: 1,
    email: "user@example.com",
    ownerEmails: ["admin@example.com"],
  })).toBe("member")

  expect(singleOrgPolicy.resolveSingleOrgMembershipRole({
    activeOwnerCount: 0,
    email: "first@example.com",
    ownerEmails: [],
  })).toBeNull()
})
