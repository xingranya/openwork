import { randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { expect, mock, test } from "bun:test"
import { createDenDb } from "@openwork-ee/den-db"
import { eq } from "@openwork-ee/den-db/drizzle"
import {
  AuthUserTable,
  ConfigObjectAccessGrantTable,
  ConfigObjectTable,
  ConfigObjectVersionTable,
  MemberTable,
  OrganizationTable,
  PluginAccessGrantTable,
  PluginConfigObjectTable,
  PluginTable,
} from "@openwork-ee/den-db/schema"
import { createDenTypeId } from "@openwork-ee/utils/typeid"
import mysql from "../../../packages/den-db/node_modules/mysql2/promise.js"

const mysqlRootUrl = process.env.SKILL_IMPORT_TEST_DATABASE_URL?.trim()
const databaseTest = mysqlRootUrl ? test : test.skip

function quoteIdentifier(value: string) {
  return `\`${value.replace(/`/g, "``")}\``
}

function databaseUrl(baseUrl: string, databaseName: string) {
  const url = new URL(baseUrl)
  url.pathname = `/${databaseName}`
  return url.toString()
}

function pushCurrentSchema(testDatabaseUrl: string) {
  const packageDirectory = fileURLToPath(new URL("../../../packages/den-db/", import.meta.url))
  const drizzleKit = fileURLToPath(new URL("../../../packages/den-db/node_modules/drizzle-kit/bin.cjs", import.meta.url))
  const result = spawnSync(
    "node",
    ["--import", "tsx", drizzleKit, "push", "--config", "drizzle.config.ts", "--force"],
    {
      cwd: packageDirectory,
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: testDatabaseUrl,
        DEN_DB_ENCRYPTION_KEY: "skill-import-integration-key-20260727",
      },
    },
  )
  if (result.status !== 0) {
    throw new Error(`测试数据库建表失败。\n${result.stderr || result.stdout}`)
  }
}

databaseTest("MySQL 当前 Schema 建表后可原子保存、幂等读取完整公司技能包", { timeout: 300_000 }, async () => {
  if (!mysqlRootUrl) return

  const databaseName = `foxwork_skill_import_${randomUUID().replace(/-/g, "").slice(0, 16)}`
  const rootUrl = new URL(mysqlRootUrl)
  rootUrl.pathname = "/"
  const root = await mysql.createConnection(rootUrl.toString())
  let client: ReturnType<typeof createDenDb>["client"] | null = null

  try {
    await root.query(`CREATE DATABASE ${quoteIdentifier(databaseName)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
    const testDatabaseUrl = databaseUrl(mysqlRootUrl, databaseName)
    pushCurrentSchema(testDatabaseUrl)

    process.env.DATABASE_URL = testDatabaseUrl
    process.env.DB_MODE = "mysql"
    process.env.DEN_DB_ENCRYPTION_KEY = "skill-import-integration-key-20260727"
    process.env.BETTER_AUTH_SECRET = "skill-import-integration-auth-secret"
    process.env.BETTER_AUTH_URL = "http://127.0.0.1:8790"

    const database = createDenDb({ databaseUrl: testDatabaseUrl, mode: "mysql" })
    client = database.client
    mock.module("../src/db.js", () => ({ db: database.db }))
    const [bundleModule, storeModule, zipModule, pluginStoreModule] = await Promise.all([
      import("../src/routes/org/company-skill-bundle.js"),
      import("../src/routes/org/company-skills-store.js"),
      import("../src/routes/org/skill-zip-import.js"),
      import("../src/routes/org/plugin-system/store.js"),
    ])

    const userId = createDenTypeId("user")
    const employeeUserId = createDenTypeId("user")
    const organizationId = createDenTypeId("organization")
    const memberId = createDenTypeId("member")
    const employeeMemberId = createDenTypeId("member")
    const now = new Date()
    await database.db.insert(AuthUserTable).values({
      id: userId,
      name: "公司技能集成测试",
      email: `skill-import-${userId}@test.local`,
    })
    await database.db.insert(AuthUserTable).values({
      id: employeeUserId,
      name: "公司技能普通员工",
      email: `skill-employee-${employeeUserId}@test.local`,
    })
    await database.db.insert(OrganizationTable).values({
      id: organizationId,
      name: "公司技能集成测试",
      slug: `skill-import-${organizationId}`,
    })
    await database.db.insert(MemberTable).values({
      id: memberId,
      organizationId,
      userId,
      role: "admin",
    })
    await database.db.insert(MemberTable).values({
      id: employeeMemberId,
      organizationId,
      userId: employeeUserId,
      role: "member",
    })

    const bundle = zipModule.validateCompanySkillBundleFiles("evidence-review", [
      {
        path: "SKILL.md",
        contents: "---\nname: evidence-review\ndescription: 审查项目证据\n---\n\n先核对来源。\n",
      },
      {
        path: "references/checklist.md",
        contents: "# 检查表\n\n- 核对原始文件\n",
      },
    ])
    const input = {
      access: { memberIds: [], orgWide: true, teamIds: [] },
      actorIsAdmin: true,
      actorMemberId: memberId,
      bundle,
      organizationId,
      overwrite: true,
    }

    const first = await storeModule.saveCompanySkill(input)
    const second = await storeModule.saveCompanySkill(input)
    const employeeCatalog = await pluginStoreModule.listConfigObjects({
      context: {
        memberTeams: [],
        organizationContext: {
          organization: {
            id: organizationId,
            name: "公司技能集成测试",
            slug: `skill-import-${organizationId}`,
            logo: null,
            allowedEmailDomains: null,
            metadata: null,
            createdAt: now,
            updatedAt: now,
          },
          currentMember: {
            id: employeeMemberId,
            userId: employeeUserId,
            role: "member",
            createdAt: now,
            joinedAt: now,
            isOwner: false,
          },
          invitations: [],
          members: [],
          roles: [],
          teams: [],
        },
        session: { createdAt: now },
      },
      limit: 100,
      status: "active",
      type: "skill",
    })
    const [plugins, configObjects, versions, pluginObjects, pluginGrants, configObjectGrants] = await Promise.all([
      database.db.select().from(PluginTable).where(eq(PluginTable.organizationId, organizationId)),
      database.db.select().from(ConfigObjectTable).where(eq(ConfigObjectTable.organizationId, organizationId)),
      database.db.select().from(ConfigObjectVersionTable).where(eq(ConfigObjectVersionTable.organizationId, organizationId)),
      database.db.select().from(PluginConfigObjectTable).where(eq(PluginConfigObjectTable.organizationId, organizationId)),
      database.db.select().from(PluginAccessGrantTable).where(eq(PluginAccessGrantTable.organizationId, organizationId)),
      database.db.select().from(ConfigObjectAccessGrantTable).where(eq(ConfigObjectAccessGrantTable.organizationId, organizationId)),
    ])

    expect(first.action).toBe("created")
    expect(second.action).toBe("unchanged")
    expect(plugins).toHaveLength(1)
    expect(configObjects).toHaveLength(1)
    expect(versions).toHaveLength(1)
    expect(pluginObjects).toHaveLength(1)
    expect(pluginGrants).toHaveLength(2)
    expect(configObjectGrants).toHaveLength(2)
    expect(first.item).toMatchObject({
      slug: "evidence-review",
      files: [
        expect.objectContaining({ path: "SKILL.md" }),
        expect.objectContaining({ path: "references/checklist.md" }),
      ],
    })
    expect(employeeCatalog.items).toEqual([
      expect.objectContaining({
        id: first.item.id,
        latestVersion: expect.objectContaining({
          rawSourceText: bundle.skillText,
          normalizedPayloadJson: expect.objectContaining({
            foxworkSkillBundle: expect.objectContaining({
              bundleHash: bundle.bundleHash,
              files: bundle.files,
              shared: "org",
            }),
          }),
        }),
        objectType: "skill",
        status: "active",
      }),
    ])
    expect(bundleModule.parseCompanySkillVersionPayload(versions[0]!)).toMatchObject({
      bundleHash: bundle.bundleHash,
      files: bundle.files,
      shared: "org",
      skillText: bundle.skillText,
    })
  } finally {
    mock.restore()
    if (client && "end" in client && typeof client.end === "function") {
      await client.end()
    }
    await root.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`).catch(() => {})
    await root.end()
  }
})
