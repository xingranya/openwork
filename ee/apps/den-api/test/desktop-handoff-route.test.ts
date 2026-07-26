import { createDenTypeId } from "@openwork-ee/utils/typeid"
import { expect, mock, test } from "bun:test"
import { Hono } from "hono"

const userId = createDenTypeId("user")
const organizationId = createDenTypeId("organization")
const sessionToken = "session-desktop-handoff-test"
let consumed = false
let insertedGrant: Record<string, unknown> | null = null
let transactionSelectCount = 0

mock.module("../src/env.js", () => ({
  env: {
    webAppHosts: ["localhost"],
    desktopDenBaseUrl: "http://localhost:8790/api/den",
    betterAuthUrl: "http://localhost:8790",
  },
}))

mock.module("../src/middleware/current-user.js", () => ({
  requireUserMiddleware: async (c: any, next: () => Promise<void>) => {
    c.set("user", {
      id: userId,
      email: "employee@example.test",
      name: "验收成员",
      emailVerified: true,
    })
    c.set("session", {
      token: sessionToken,
      userId,
      activeOrganizationId: organizationId,
    })
    c.set("apiKey", null)
    await next()
  },
}))

function selectChain(rows: unknown[]) {
  return {
    from: () => ({
      innerJoin: () => ({
        innerJoin: () => ({
          where: () => ({ limit: async () => rows }),
        }),
      }),
      where: () => ({ limit: async () => rows }),
    }),
  }
}

const tx = {
  insert: () => ({ values: async (values: Record<string, unknown>) => { insertedGrant = values } }),
  select: () => {
    transactionSelectCount += 1
    if (transactionSelectCount === 2) {
      return selectChain(consumed ? [{ id: insertedGrant?.id }] : [])
    }
    return selectChain(consumed ? [] : [{
      session: { token: sessionToken },
      user: { id: userId, email: "employee@example.test", name: "验收成员" },
    }])
  },
  update: () => ({
    set: () => ({
      where: async () => {
        consumed = true
      },
    }),
  }),
}

mock.module("../src/db.js", () => ({
  db: {
    insert: () => ({ values: async (values: Record<string, unknown>) => { insertedGrant = values } }),
    transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => {
      transactionSelectCount = 0
      return callback(tx)
    },
  },
}))

test("桌面交接路由创建一次性链接并拒绝重复兑换", async () => {
  const { registerDesktopAuthRoutes } = await import("../src/routes/auth/desktop-handoff.js")
  const app = new Hono()
  registerDesktopAuthRoutes(app)

  const createResponse = await app.request("http://localhost:8790/v1/auth/desktop-handoff", {
    method: "POST",
    headers: {
      origin: "http://localhost:3005",
      "content-type": "application/json",
    },
    body: JSON.stringify({ desktopScheme: "foxwork" }),
  })

  expect(createResponse.status).toBe(200)
  const created = await createResponse.json() as { grant: string; openworkUrl: string }
  expect(created.grant).toHaveLength(32)
  expect(created.openworkUrl).toStartWith("foxwork://den-auth?")
  expect(insertedGrant?.session_token).toBe(sessionToken)

  const exchangeResponse = await app.request("http://localhost:8790/v1/auth/desktop-handoff/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant: created.grant }),
  })
  expect(exchangeResponse.status).toBe(200)
  await expect(exchangeResponse.json()).resolves.toEqual({
    token: sessionToken,
    user: { id: userId, email: "employee@example.test", name: "验收成员" },
  })

  const replayResponse = await app.request("http://localhost:8790/v1/auth/desktop-handoff/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant: created.grant }),
  })
  expect(replayResponse.status).toBe(404)
  await expect(replayResponse.json()).resolves.toEqual({
    error: "grant_not_found",
    message: "登录链接不存在、已过期或已经使用，请重新获取登录链接。",
  })
})
