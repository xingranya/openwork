import { beforeAll, beforeEach, expect, test } from "bun:test"
import {
  ConfigObjectAccessGrantTable,
  ConfigObjectTable,
  ConfigObjectVersionTable,
  MemberTable,
  OrganizationTable,
  PluginAccessGrantTable,
  PluginConfigObjectTable,
  PluginTable,
  TeamTable,
} from "@openwork-ee/den-db/schema"
import { createDenTypeId } from "@openwork-ee/utils/typeid"
import type { CompanySkillStoreDatabase } from "../src/routes/org/company-skills-store.js"

function seedRequiredEnv() {
  process.env.DATABASE_URL ??= "mysql://root:password@127.0.0.1:3306/openwork_test"
  process.env.DEN_DB_ENCRYPTION_KEY ??= "x".repeat(32)
  process.env.BETTER_AUTH_SECRET ??= "y".repeat(32)
  process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:8790"
}

type TableName =
  | "config_object"
  | "config_object_access_grant"
  | "config_object_version"
  | "member"
  | "organization"
  | "plugin"
  | "plugin_access_grant"
  | "plugin_config_object"
  | "team"
type Row = Record<string, unknown>
type StoreState = Record<TableName, Row[]>

type QueryChain = {
  for: (mode: "update") => QueryChain
  from: (table: unknown) => QueryChain
  limit: (count?: number) => Promise<Row[]>
  orderBy: (...values: unknown[]) => QueryChain
  then: <TResult1 = Row[], TResult2 = never>(
    onfulfilled?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) => Promise<TResult1 | TResult2>
  where: (condition?: unknown) => QueryChain
}

type WriteBuilder = {
  set: (value: Row) => { where: (condition?: unknown) => Promise<void> }
  values: (value: Row | Row[]) => Promise<void>
  where: (condition?: unknown) => Promise<void>
}

const emptyState = (): StoreState => ({
  config_object: [],
  config_object_access_grant: [],
  config_object_version: [],
  member: [],
  organization: [],
  plugin: [],
  plugin_access_grant: [],
  plugin_config_object: [],
  team: [],
})

let committedState = emptyState()
let failOnConfigObjectViewerGrant = false
let transactionCalls = 0

function tableName(table: unknown): TableName {
  if (table === ConfigObjectTable) return "config_object"
  if (table === ConfigObjectAccessGrantTable) return "config_object_access_grant"
  if (table === ConfigObjectVersionTable) return "config_object_version"
  if (table === MemberTable) return "member"
  if (table === OrganizationTable) return "organization"
  if (table === PluginTable) return "plugin"
  if (table === PluginAccessGrantTable) return "plugin_access_grant"
  if (table === PluginConfigObjectTable) return "plugin_config_object"
  if (table === TeamTable) return "team"
  throw new Error("测试数据库收到了未支持的数据表。")
}

function cloneState(state: StoreState): StoreState {
  return Object.fromEntries(
    Object.entries(state).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]),
  ) as StoreState
}

function createQueryChain(state: StoreState): QueryChain {
  let selectedTable: TableName | null = null
  const rows = (count?: number) => {
    const result = selectedTable ? state[selectedTable] : []
    return count === undefined ? [...result] : result.slice(0, count)
  }
  const chain: QueryChain = {
    for: () => chain,
    from: (table) => {
      selectedTable = tableName(table)
      return chain
    },
    limit: (count) => Promise.resolve(rows(count)),
    orderBy: () => chain,
    then: (onfulfilled, onrejected) => Promise.resolve(rows()).then(onfulfilled, onrejected),
    where: () => chain,
  }
  return chain
}

function createTransaction(state: StoreState) {
  return {
    delete: (table: unknown): WriteBuilder => {
      const name = tableName(table)
      return {
        set: () => ({ where: () => Promise.resolve() }),
        values: () => Promise.resolve(),
        where: () => {
          state[name] = []
          return Promise.resolve()
        },
      }
    },
    insert: (table: unknown): WriteBuilder => {
      const name = tableName(table)
      return {
        set: () => ({ where: () => Promise.resolve() }),
        values: (value) => {
          const values = Array.isArray(value) ? value : [value]
          if (
            name === "config_object_access_grant"
            && failOnConfigObjectViewerGrant
            && values.some((row) => row.role === "viewer")
          ) {
            throw new Error("模拟技能授权写入失败")
          }
          state[name].push(...values.map((row) => ({ ...row })))
          return Promise.resolve()
        },
        where: () => Promise.resolve(),
      }
    },
    select: () => createQueryChain(state),
    update: (table: unknown): WriteBuilder => {
      const name = tableName(table)
      return {
        set: (value) => ({
          where: () => {
            state[name] = state[name].map((row) => ({ ...row, ...value }))
            return Promise.resolve()
          },
        }),
        values: () => Promise.resolve(),
        where: () => Promise.resolve(),
      }
    },
  }
}

const database = {
  transaction: async <TResult>(callback: (tx: ReturnType<typeof createTransaction>) => Promise<TResult>) => {
    transactionCalls += 1
    const stagedState = cloneState(committedState)
    const result = await callback(createTransaction(stagedState))
    committedState = stagedState
    return result
  },
} as unknown as CompanySkillStoreDatabase

let storeModule: typeof import("../src/routes/org/company-skills-store.js")
let zipModule: typeof import("../src/routes/org/skill-zip-import.js")

beforeAll(async () => {
  seedRequiredEnv()
  ;[storeModule, zipModule] = await Promise.all([
    import("../src/routes/org/company-skills-store.js"),
    import("../src/routes/org/skill-zip-import.js"),
  ])
})

beforeEach(() => {
  committedState = emptyState()
  failOnConfigObjectViewerGrant = false
  transactionCalls = 0
})

function seedOrganization(organizationId: string) {
  committedState.organization.push({ id: organizationId })
}

test("公司技能分发写入失败时不留下插件、文件版本或权限半成品", async () => {
  const actorMemberId = createDenTypeId("member")
  const organizationId = createDenTypeId("organization")
  seedOrganization(organizationId)
  failOnConfigObjectViewerGrant = true
  const bundle = storeModule.singleFileCompanySkill([
    "---",
    "name: evidence-review",
    "description: 审查项目证据",
    "---",
    "",
    "先核对来源，再给出结论。",
  ].join("\n"))

  await expect(storeModule.saveCompanySkill({
    access: { memberIds: [], orgWide: true, teamIds: [] },
    actorIsAdmin: true,
    actorMemberId,
    bundle,
    organizationId,
    overwrite: true,
  }, { database })).rejects.toThrow("模拟技能授权写入失败")

  expect(transactionCalls).toBe(1)
  expect(committedState).toMatchObject({
    config_object: [],
    config_object_access_grant: [],
    config_object_version: [],
    plugin: [],
    plugin_access_grant: [],
    plugin_config_object: [],
  })
})

test("重复导入相同多文件公司技能时保持幂等并保留完整文件包", async () => {
  const actorMemberId = createDenTypeId("member")
  const organizationId = createDenTypeId("organization")
  seedOrganization(organizationId)
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
    actorMemberId,
    bundle,
    organizationId,
    overwrite: true,
  }

  const first = await storeModule.saveCompanySkill(input, { database })
  const second = await storeModule.saveCompanySkill(input, { database })

  expect(first.action).toBe("created")
  expect(second.action).toBe("unchanged")
  expect(first.item.files).toEqual(bundle.files)
  expect(second.item.bundleHash).toBe(bundle.bundleHash)
  expect(transactionCalls).toBe(2)
  expect(committedState.plugin).toHaveLength(1)
  expect(committedState.config_object).toHaveLength(1)
  expect(committedState.config_object_version).toHaveLength(1)
  expect(committedState.plugin_config_object).toHaveLength(1)
  expect(committedState.plugin_access_grant).toHaveLength(2)
  expect(committedState.config_object_access_grant).toHaveLength(2)
  expect(committedState.config_object_version[0]?.normalizedPayloadJson).toEqual({
    foxworkSkillBundle: {
      version: 1,
      bundleHash: bundle.bundleHash,
      files: bundle.files,
      shared: "org",
    },
  })
})

test("成员和团队范围同时写入插件与技能对象授权且不覆盖创建者管理权", async () => {
  const actorMemberId = createDenTypeId("member")
  const targetMemberId = createDenTypeId("member")
  const targetTeamId = createDenTypeId("team")
  const organizationId = createDenTypeId("organization")
  seedOrganization(organizationId)
  committedState.member.push({ id: targetMemberId, organizationId, removedAt: null })
  committedState.team.push({ id: targetTeamId, organizationId })
  const bundle = storeModule.singleFileCompanySkill(
    "---\nname: scoped-review\ndescription: 定向审查\n---\n\n仅向获授权成员和团队开放。\n",
  )

  const result = await storeModule.saveCompanySkill({
    access: { memberIds: [targetMemberId], orgWide: false, teamIds: [targetTeamId] },
    actorIsAdmin: true,
    actorMemberId,
    bundle,
    organizationId,
    overwrite: true,
  }, { database })

  expect(result.item.shared).toBeNull()
  for (const table of ["plugin_access_grant", "config_object_access_grant"] as const) {
    expect(committedState[table]).toEqual(expect.arrayContaining([
      expect.objectContaining({ orgMembershipId: actorMemberId, role: "manager" }),
      expect.objectContaining({ orgMembershipId: targetMemberId, role: "viewer" }),
      expect.objectContaining({ teamId: targetTeamId, role: "viewer" }),
    ]))
    expect(committedState[table]).toHaveLength(3)
  }
})
