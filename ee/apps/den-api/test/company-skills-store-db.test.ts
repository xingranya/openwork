import { randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { expect, mock, test } from "bun:test"
import { createDenDb } from "@openwork-ee/den-db"
import { eq } from "@openwork-ee/den-db/drizzle"
import {
  AuthUserTable,
  MemberTable,
  OrganizationTable,
  SkillHubMemberTable,
  SkillHubSkillTable,
  SkillHubTable,
  SkillTable,
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
    const [storeModule, zipModule] = await Promise.all([
      import("../src/routes/org/company-skills-store.js"),
      import("../src/routes/org/skill-zip-import.js"),
    ])

    const userId = createDenTypeId("user")
    const organizationId = createDenTypeId("organization")
    const memberId = createDenTypeId("member")
    await database.db.insert(AuthUserTable).values({
      id: userId,
      name: "公司技能集成测试",
      email: `skill-import-${userId}@test.local`,
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
    const [skills, hubs, hubSkills, hubMembers] = await Promise.all([
      database.db.select().from(SkillTable).where(eq(SkillTable.organizationId, organizationId)),
      database.db.select().from(SkillHubTable).where(eq(SkillHubTable.organizationId, organizationId)),
      database.db.select().from(SkillHubSkillTable),
      database.db.select().from(SkillHubMemberTable),
    ])

    expect(first.action).toBe("created")
    expect(second.action).toBe("unchanged")
    expect(skills).toHaveLength(1)
    expect(hubs).toHaveLength(1)
    expect(hubSkills).toHaveLength(1)
    expect(hubMembers).toHaveLength(1)
    expect(storeModule.serializeCompanySkill(skills[0]!, true)).toMatchObject({
      slug: "evidence-review",
      files: [
        expect.objectContaining({ path: "SKILL.md" }),
        expect.objectContaining({ path: "references/checklist.md" }),
      ],
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
