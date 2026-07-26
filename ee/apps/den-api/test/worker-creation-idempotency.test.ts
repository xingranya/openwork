import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "bun:test"

function read(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
}

const workerRouteSource = read("../src/routes/workers/core.ts")
const workerSharedSource = read("../src/routes/workers/shared.ts")
const workerSchemaSource = read("../../../packages/den-db/src/schema/workers.ts")
const migrationSource = read("../../../packages/den-db/drizzle/0045_worker_creation_idempotency.sql")

describe("个人远程工作区幂等创建", () => {
  test("请求只接受受限长度和字符集的幂等键", () => {
    expect(workerSharedSource).toContain(
      'idempotencyKey: z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9._:-]+$/).optional()',
    )
  })

  test("数据库按组织、用户和幂等键阻止重复 Worker", () => {
    expect(workerSchemaSource).toContain('idempotency_key: varchar("idempotency_key", { length: 128 })')
    expect(workerSchemaSource).toContain('uniqueIndex("worker_org_user_idempotency_key")')
    expect(migrationSource).toContain('ADD `idempotency_key` varchar(128)')
    expect(migrationSource).toContain(
      'UNIQUE(`org_id`,`created_by_user_id`,`idempotency_key`)',
    )
  })

  test("Worker 与三类令牌同事务写入，并发冲突后读取既有 Worker", () => {
    expect(workerRouteSource).toContain("await db.transaction(async (tx) =>")
    expect(workerRouteSource).toContain("await tx.insert(WorkerTable).values")
    expect(workerRouteSource).toContain("await tx.insert(WorkerTokenTable).values")
    expect(workerRouteSource).toContain("const existing = await findIdempotentWorker")
    expect(workerRouteSource).toContain("workerMatchesCreateInput(existing, input)")
    expect(workerRouteSource).toContain('error: "idempotency_key_reused" as const')
    expect(workerRouteSource).toContain(
      "return c.json(await buildIdempotentWorkerResponse(existing, user.id), 200)",
    )
  })
})
