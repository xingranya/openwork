import { beforeAll, describe, expect, test } from "bun:test"
import { createDenTypeId } from "@openwork-ee/utils/typeid"
import { strToU8, zipSync } from "fflate"
import { Hono, type MiddlewareHandler } from "hono"
import type { MemberTeamsContext } from "../src/middleware/member-teams.js"
import type { OrgRouteVariables } from "../src/routes/org/shared.js"

function seedRequiredEnv() {
  process.env.DATABASE_URL ??= "mysql://root:password@127.0.0.1:3306/openwork_test"
  process.env.DEN_DB_ENCRYPTION_KEY ??= "x".repeat(32)
  process.env.BETTER_AUTH_SECRET ??= "y".repeat(32)
  process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:8790"
}

type RouteVariables = OrgRouteVariables & Partial<MemberTeamsContext>
type SaveInput = {
  access: { memberIds: string[]; orgWide: boolean; teamIds: string[] }
  bundle: { bundleHash: string; files: unknown[]; folder: string; slug: string }
  overwrite: boolean
}
type SaveSkill = (input: SaveInput) => Promise<{
  action: "created" | "updated" | "unchanged"
  item: { id: string; pluginId: string }
}>
type RegisterSkillRoutes = (
  app: Hono<{ Variables: RouteVariables }>,
  dependencies?: {
    memberTeamsRoute?: MiddlewareHandler<{ Variables: RouteVariables }>
    memberRoute?: MiddlewareHandler<{ Variables: RouteVariables }>
    saveSkill?: SaveSkill
  },
) => void

let registerCompanySkillZipImportRoute: RegisterSkillRoutes
const targetMemberId = createDenTypeId("member")
const targetTeamId = createDenTypeId("team")

beforeAll(async () => {
  seedRequiredEnv()
  const routes = await import("../src/routes/org/plugin-system/routes.js")
  registerCompanySkillZipImportRoute = routes.registerCompanySkillZipImportRoute as unknown as RegisterSkillRoutes
})

function zipArchive(files: Record<string, string>) {
  return zipSync(Object.fromEntries(
    Object.entries(files).map(([path, contents]) => [path, strToU8(contents)]),
  ))
}

function contextRoute(role: "admin" | "member"): MiddlewareHandler<{ Variables: RouteVariables }> {
  return async (c, next) => {
    const now = new Date("2026-07-27T00:00:00.000Z")
    c.set("organizationContext", {
      organization: {
        id: createDenTypeId("organization"),
        name: "Fox",
        slug: "fox",
        logo: null,
        allowedEmailDomains: null,
        metadata: null,
        createdAt: now,
        updatedAt: now,
      },
      currentMember: {
        id: createDenTypeId("member"),
        userId: createDenTypeId("user"),
        role,
        createdAt: now,
        joinedAt: now,
        isOwner: false,
      },
      invitations: [],
      members: [],
      roles: [],
      teams: [],
    })
    c.set("session", {
      id: createDenTypeId("session"),
      userId: createDenTypeId("user"),
      token: "fresh-session",
      expiresAt: new Date("2026-07-28T00:00:00.000Z"),
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: null,
      userAgent: null,
      activeOrganizationId: null,
      impersonatedBy: null,
    })
    await next()
  }
}

const memberTeamsRoute: MiddlewareHandler<{ Variables: RouteVariables }> = async (c, next) => {
  c.set("memberTeams", [])
  await next()
}

function uploadForm() {
  const form = new FormData()
  form.set("archive", new File([zipArchive({
    "valid/SKILL.md": "---\nname: valid\ndescription: 可用技能\n---\n\n执行。\n",
    "valid/references/checklist.md": "# 检查表",
    "broken/README.md": "缺少入口文件",
  })], "company-skills.zip", { type: "application/zip" }))
  form.set("orgWide", "false")
  form.set("overwrite", "true")
  form.set("memberIds", JSON.stringify([targetMemberId]))
  form.set("teamIds", JSON.stringify([targetTeamId]))
  return form
}

describe("公司技能 ZIP 导入接口", () => {
  test("普通成员不能批量导入公司技能", async () => {
    let saveCalls = 0
    const app = new Hono<{ Variables: RouteVariables }>()
    registerCompanySkillZipImportRoute(app, {
      memberTeamsRoute,
      memberRoute: contextRoute("member"),
      saveSkill: async () => {
        saveCalls += 1
        return {
          action: "created",
          item: {
            id: createDenTypeId("configObject"),
            pluginId: createDenTypeId("plugin"),
          },
        }
      },
    })

    const response = await app.request("http://den.local/v1/plugins/import-skills-zip", {
      method: "POST",
      body: uploadForm(),
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: "forbidden",
      message: "只有公司管理员可以批量导入技能。",
    })
    expect(saveCalls).toBe(0)
  })

  test("管理员获得逐项结果并把覆盖与授权范围传入存储层", async () => {
    const savedInputs: SaveInput[] = []
    const app = new Hono<{ Variables: RouteVariables }>()
    const configObjectId = createDenTypeId("configObject")
    const pluginId = createDenTypeId("plugin")
    registerCompanySkillZipImportRoute(app, {
      memberTeamsRoute,
      memberRoute: contextRoute("admin"),
      saveSkill: async (input) => {
        savedInputs.push(input)
        return { action: "created", item: { id: configObjectId, pluginId } }
      },
    })

    const response = await app.request("http://den.local/v1/plugins/import-skills-zip", {
      method: "POST",
      body: uploadForm(),
    })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.results).toEqual([
      expect.objectContaining({
        action: "created",
        fileCount: 2,
        folder: "valid",
        id: configObjectId,
        pluginId,
        slug: "valid",
      }),
    ])
    expect(payload.failures).toEqual([
      {
        code: "skill_entrypoint_missing",
        folder: "broken",
        reason: "缺少 SKILL.md。",
      },
    ])
    expect(savedInputs).toHaveLength(1)
    expect(savedInputs[0]).toMatchObject({
      access: {
        orgWide: false,
        memberIds: [targetMemberId],
        teamIds: [targetTeamId],
      },
      overwrite: true,
    })
  })
})
