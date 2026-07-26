import { beforeAll, expect, test } from "bun:test"

function seedRequiredEnv() {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "mysql://root:password@127.0.0.1:3306/openwork_test"
  process.env.DEN_DB_ENCRYPTION_KEY = process.env.DEN_DB_ENCRYPTION_KEY ?? "x".repeat(32)
  process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "y".repeat(32)
  process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:8790"
}

let authProtection: typeof import("../src/auth-protection.js")

beforeAll(async () => {
  seedRequiredEnv()
  authProtection = await import("../src/auth-protection.js")
})

test("breached password screening reads password fields only on password creation routes", async () => {
  const signUp = new Request("http://den.local/api/auth/sign-up/email", {
    body: JSON.stringify({ email: "user@example.com", password: "created-password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  })
  await expect(authProtection.readPasswordForBreachCheck(signUp)).resolves.toBe("created-password")

  const reset = new Request("http://den.local/api/auth/reset-password", {
    body: JSON.stringify({ newPassword: "reset-password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  })
  await expect(authProtection.readPasswordForBreachCheck(reset)).resolves.toBe("reset-password")

  const signIn = new Request("http://den.local/api/auth/sign-in/email", {
    body: JSON.stringify({ email: "user@example.com", password: "existing-password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  })
  await expect(authProtection.readPasswordForBreachCheck(signIn)).resolves.toBeNull()
})

test("breached password screening uses k-anonymity range responses", async () => {
  let requestedUrl = ""
  const compromised = await authProtection.isPasswordCompromised("password", async (input) => {
    requestedUrl = input
    return new Response("1E4C9B93F3F0682250B6CF8331B7EE68FD8:3303003\n", { status: 200 })
  })

  expect(requestedUrl).toBe("https://api.pwnedpasswords.com/range/5BAA6")
  expect(compromised).toBe(true)

  await expect(authProtection.isPasswordCompromised("password", async () => new Response("00000000000000000000000000000000000:1\n", { status: 200 }))).resolves.toBe(false)
})

test("breached password response blocks compromised passwords and fails closed on screening errors", async () => {
  const request = new Request("http://den.local/api/auth/sign-up/email", {
    body: JSON.stringify({ email: "user@example.com", password: "password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  })

  const blocked = await authProtection.getBreachedPasswordResponse(
    request,
    async () => new Response("1E4C9B93F3F0682250B6CF8331B7EE68FD8:3303003\n", { status: 200 }),
  )
  expect(blocked?.status).toBe(400)
  await expect(blocked?.json()).resolves.toEqual({
    error: "password_compromised",
    message: "此密码曾出现在数据泄露记录中，请更换密码。",
  })

  const unavailable = await authProtection.getBreachedPasswordResponse(
    request,
    async () => new Response("", { status: 503 }),
  )
  expect(unavailable?.status).toBe(503)
  await expect(unavailable?.json()).resolves.toEqual({
    error: "password_screening_unavailable",
    message: "暂时无法检查密码安全性，请稍后重试。",
  })
})

test("short password response rejects passwords below the minimum length on creation routes", async () => {
  const tooShort = new Request("http://den.local/api/auth/sign-up/email", {
    body: JSON.stringify({ email: "user@example.com", password: "short" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  })
  const rejected = await authProtection.getShortPasswordResponse(tooShort)
  expect(rejected?.status).toBe(400)
  await expect(rejected?.json()).resolves.toEqual({
    error: "password_too_short",
    message: `密码至少需要 ${authProtection.MIN_PASSWORD_LENGTH} 个字符。`,
  })

  const atBoundary = new Request("http://den.local/api/auth/sign-up/email", {
    body: JSON.stringify({ email: "user@example.com", password: "a".repeat(authProtection.MIN_PASSWORD_LENGTH) }),
    headers: { "content-type": "application/json" },
    method: "POST",
  })
  await expect(authProtection.getShortPasswordResponse(atBoundary)).resolves.toBeNull()

  const longEnough = new Request("http://den.local/api/auth/sign-up/email", {
    body: JSON.stringify({ email: "user@example.com", password: "longenough" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  })
  await expect(authProtection.getShortPasswordResponse(longEnough)).resolves.toBeNull()

  const signIn = new Request("http://den.local/api/auth/sign-in/email", {
    body: JSON.stringify({ email: "user@example.com", password: "x" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  })
  await expect(authProtection.getShortPasswordResponse(signIn)).resolves.toBeNull()
})

test("breached password response can skip screening for isolated deployments", async () => {
  const request = new Request("http://den.local/api/auth/sign-up/email", {
    body: JSON.stringify({ email: "user@example.com", password: "password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  })
  let fetchCount = 0

  const response = await authProtection.getBreachedPasswordResponse(
    request,
    async () => {
      fetchCount += 1
      return new Response("1E4C9B93F3F0682250B6CF8331B7EE68FD8:3303003\n", { status: 200 })
    },
    false,
  )

  expect(response).toBeNull()
  expect(fetchCount).toBe(0)
})
