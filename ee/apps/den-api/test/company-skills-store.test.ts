import { beforeAll, beforeEach, expect, mock, test } from "bun:test"
import {
  SkillHubMemberTable,
  SkillHubSkillTable,
  SkillHubTable,
  SkillTable,
} from "@openwork-ee/den-db/schema"
import { createDenTypeId } from "@openwork-ee/utils/typeid"

function seedRequiredEnv() {
  process.env.DATABASE_URL ??= "mysql://root:password@127.0.0.1:3306/openwork_test"
  process.env.DEN_DB_ENCRYPTION_KEY ??= "x".repeat(32)
  process.env.BETTER_AUTH_SECRET ??= "y".repeat(32)
  process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:8790"
}

type TableName = "skill" | "skill_hub" | "skill_hub_skill" | "skill_hub_member"
type Row = Record<string, unknown>
type StoreState = Record<TableName, Row[]>

type QueryChain = {
  from: (table: unknown) => QueryChain
  limit: (count?: number) => Promise<Row[]>
  then: <TResult1 = Row[], TResult2 = never>(
    onfulfilled?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) => Promise<TResult1 | TResult2>
  where: () => QueryChain
}

type WriteBuilder = {
  set: (value: Row) => { where: () => Promise<void> }
  values: (value: Row | Row[]) => Promise<void>
  where: () => Promise<void>
}

const emptyState = (): StoreState => ({
  skill: [],
  skill_hub: [],
  skill_hub_skill: [],
  skill_hub_member: [],
})

let committedState = emptyState()
let failOnHubMemberInsert = false
let transactionCalls = 0

function tableName(table: unknown): TableName {
  if (table === SkillTable) return "skill"
  if (table === SkillHubTable) return "skill_hub"
  if (table === SkillHubSkillTable) return "skill_hub_skill"
  if (table === SkillHubMemberTable) return "skill_hub_member"
  throw new Error("测试数据库收到了未支持的数据表。")
}

function cloneState(state: StoreState): StoreState {
  return {
    skill: state.skill.map((row) => ({ ...row })),
    skill_hub: state.skill_hub.map((row) => ({ ...row })),
    skill_hub_skill: state.skill_hub_skill.map((row) => ({ ...row })),
    skill_hub_member: state.skill_hub_member.map((row) => ({ ...row })),
  }
}

function createQueryChain(state: StoreState): QueryChain {
  let selectedTable: TableName | null = null
  const rows = (count?: number) => {
    const result = selectedTable ? state[selectedTable] : []
    return count === undefined ? [...result] : result.slice(0, count)
  }
  const chain: QueryChain = {
    from: (table) => {
      selectedTable = tableName(table)
      return chain
    },
    limit: (count) => Promise.resolve(rows(count)),
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
          if (name === "skill_hub_member" && failOnHubMemberInsert) {
            throw new Error("模拟权限关联写入失败")
          }
          const values = Array.isArray(value) ? value : [value]
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

let storeModule: typeof import("../src/routes/org/company-skills-store.js")

beforeAll(async () => {
  seedRequiredEnv()
  mock.module("../src/db.js", () => ({
    db: {
      transaction: async <TResult>(callback: (tx: ReturnType<typeof createTransaction>) => Promise<TResult>) => {
        transactionCalls += 1
        const stagedState = cloneState(committedState)
        const result = await callback(createTransaction(stagedState))
        committedState = stagedState
        return result
      },
    },
  }))
  storeModule = await import("../src/routes/org/company-skills-store.js")
})

beforeEach(() => {
  committedState = emptyState()
  failOnHubMemberInsert = false
  transactionCalls = 0
})

test("公司技能分发写入失败时不留下技能或权限半成品", async () => {
  failOnHubMemberInsert = true
  const actorMemberId = createDenTypeId("member")
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
    organizationId: createDenTypeId("organization"),
    overwrite: true,
  })).rejects.toThrow("模拟权限关联写入失败")

  expect(transactionCalls).toBe(1)
  expect(committedState).toEqual(emptyState())
})

test("重复导入相同公司技能时返回未变化且不创建重复记录", async () => {
  const actorMemberId = createDenTypeId("member")
  const organizationId = createDenTypeId("organization")
  const bundle = storeModule.singleFileCompanySkill([
    "---",
    "name: evidence-review",
    "description: 审查项目证据",
    "---",
    "",
    "先核对来源，再给出结论。",
  ].join("\n"))
  const input = {
    access: { memberIds: [], orgWide: true, teamIds: [] },
    actorIsAdmin: true,
    actorMemberId,
    bundle,
    organizationId,
    overwrite: true,
  }

  const first = await storeModule.saveCompanySkill(input)
  const second = await storeModule.saveCompanySkill(input)

  expect(first.action).toBe("created")
  expect(second.action).toBe("unchanged")
  expect(transactionCalls).toBe(2)
  expect(committedState.skill).toHaveLength(1)
  expect(committedState.skill_hub).toHaveLength(1)
  expect(committedState.skill_hub_skill).toHaveLength(1)
  expect(committedState.skill_hub_member).toHaveLength(1)
})

test("更新多文件技能入口时保留配套文件并重算摘要", () => {
  const originalSkillText = [
    "---",
    "name: evidence-review",
    "description: 审查项目证据",
    "---",
    "",
    "先核对来源。",
  ].join("\n")
  const nextSkillText = originalSkillText.replace("先核对来源。", "先核对来源，再检查时间线。")
  const updated = storeModule.replaceCompanySkillEntrypoint({
    skillText: originalSkillText,
    bundleFilesJson: [
      { path: "SKILL.md", contents: originalSkillText },
      { path: "references/checklist.md", contents: "# 检查表" },
    ],
  }, nextSkillText)

  expect(updated.skillText).toBe(nextSkillText)
  expect(updated.files).toEqual([
    { path: "SKILL.md", contents: nextSkillText },
    { path: "references/checklist.md", contents: "# 检查表" },
  ])
  expect(updated.bundleHash).toMatch(/^[a-f0-9]{64}$/u)
})
