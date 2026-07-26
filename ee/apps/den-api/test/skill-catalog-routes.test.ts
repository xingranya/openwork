import { createDenTypeId } from "@openwork-ee/utils/typeid"
import { beforeAll, expect, mock, test } from "bun:test"
import { Hono } from "hono"

const organizationId = createDenTypeId("organization")
const memberId = createDenTypeId("member")
const userId = createDenTypeId("user")

const organizationContext = {
  organization: {
    id: organizationId,
    slug: "foxwork-company",
    name: "FoxWork 公司",
    metadata: {},
  },
  currentMember: {
    id: memberId,
    role: "member",
    isOwner: false,
  },
  currentMemberTeams: [],
  members: [],
  teams: [],
  roles: [],
}

mock.module("../src/orgs.js", () => ({
  getOrganizationContextForUser: () => Promise.resolve(organizationContext),
  listTeamsForMember: () => Promise.resolve([]),
  resolveUserOrganizations: () => Promise.resolve({
    orgs: [organizationContext.organization],
    activeOrgId: organizationId,
    activeOrgSlug: organizationContext.organization.slug,
  }),
  setSessionActiveOrganization: () => Promise.resolve(),
}))

let registerOrgSkillCatalogRoutes: typeof import("../src/routes/org/skill-catalog.js").registerOrgSkillCatalogRoutes

beforeAll(async () => {
  process.env.DATABASE_URL = "mysql://root:password@127.0.0.1:3306/openwork_test"
  process.env.DEN_DB_ENCRYPTION_KEY = "x".repeat(32)
  process.env.BETTER_AUTH_SECRET = "y".repeat(32)
  process.env.BETTER_AUTH_URL = "https://den.foxwork.test"
  process.env.OPENWORK_DEV_MODE = "0"
  process.env.PROVISIONER_MODE = "stub"
  process.env.DEN_SKILLS_CATALOG_API_BASE_URL = "https://modelscope.cn/api"
  ;({ registerOrgSkillCatalogRoutes } = await import("../src/routes/org/skill-catalog.js"))
})

function createMemberApp() {
  const app = new Hono()
  app.use("*", async (c, next) => {
    c.set("user", { id: userId })
    c.set("session", {
      id: createDenTypeId("session"),
      activeOrganizationId: organizationId,
      createdAt: new Date(),
    })
    c.set("apiKey", null)
    c.set("activeOrganizationId", organizationId)
    c.set("activeOrganizationSlug", organizationContext.organization.slug)
    await next()
  })
  registerOrgSkillCatalogRoutes(app)
  return app
}

test("未登录请求不能读取在线技能目录", async () => {
  const app = new Hono()
  registerOrgSkillCatalogRoutes(app)

  const response = await app.request("https://den.foxwork.test/v1/skill-catalog")

  expect(response.status).toBe(401)
  await expect(response.json()).resolves.toEqual({ error: "unauthorized" })
})

test("公司普通成员可以通过 Den 读取魔搭在线技能目录", async () => {
  const originalFetch = globalThis.fetch
  let upstreamAuthorization: string | null = "not-called"
  let upstreamMethod = ""
  globalThis.fetch = async (_input, init) => {
    upstreamAuthorization = new Headers(init?.headers).get("authorization")
    upstreamMethod = init?.method ?? "GET"
    return Response.json({
      Success: true,
      Data: {
        SkillList: [{
          Path: "@bytedance",
          Name: "ppt-generation",
          DisplayName: "PPT 生成",
          Description: "生成演示文稿",
          DownloadCount: 1061,
          License: "MIT License",
          Source: "github",
          SourceDeveloper: "bytedance/deer-flow",
          SourceURL: "https://github.com/bytedance/deer-flow/tree/main/skills/public/ppt-generation",
        }],
        TotalCount: 1,
      },
    })
  }

  try {
    const response = await createMemberApp().request(
      "https://den.foxwork.test/v1/skill-catalog?view=trending&perPage=10",
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      items: [{ id: "@bytedance/ppt-generation", name: "PPT 生成" }],
    })
    expect(upstreamMethod).toBe("PUT")
    expect(upstreamAuthorization).toBeNull()
  } finally {
    globalThis.fetch = originalFetch
  }
})
