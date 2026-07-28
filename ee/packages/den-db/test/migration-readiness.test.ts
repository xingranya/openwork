import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, test } from "node:test"
import { fileURLToPath } from "node:url"

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const repoRoot = path.resolve(packageDir, "..", "..", "..")
const forbiddenDeployTools = ["pnpm", "tsx", "tsup", "drizzle-kit"]
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm"

function readRepoFile(relativePath: string) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8")
}

function readDenDbMigrations() {
  return readdirSync(path.join(packageDir, "drizzle"))
    .filter((entry) => entry.endsWith(".sql"))
    .map((entry) => readFileSync(path.join(packageDir, "drizzle", entry), "utf8"))
    .join("\n")
}

function readMigrationJournal() {
  return JSON.parse(
    readFileSync(path.join(packageDir, "drizzle", "meta", "_journal.json"), "utf8"),
  ) as {
    entries: Array<{ idx: number; when: number; tag: string }>
  }
}

function requireSlice(contents: string, start: string, end: string) {
  const startIndex = contents.indexOf(start)
  assert.notEqual(startIndex, -1, `Missing ${start}`)

  const endIndex = contents.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `Missing ${end}`)

  return contents.slice(startIndex, endIndex)
}

function assertNoForbiddenDeployTools(contents: string) {
  for (const tool of forbiddenDeployTools) {
    assert.equal(contents.includes(tool), false, `deploy path must not reference ${tool}`)
  }
}

function shortOutput(output: string) {
  return output.slice(Math.max(0, output.length - 4_000))
}

describe("Den DB migration readiness wiring", () => {
  test("oauth access token lookup has a token prefix index", () => {
    const authSchema = readRepoFile("ee/packages/den-db/src/schema/auth.ts")
    const migrations = readDenDbMigrations()

    assert.equal(authSchema.includes('index("oauth_access_token_token").on(sql`${table.token}(191)`)'), true)
    assert.match(migrations, /CREATE INDEX `oauth_access_token_token` ON `oauthAccessToken` \(`token`\(191\)\);/)
  })

  test("Helm migration defaults execute the precompiled dist runner", () => {
    const values = readRepoFile("packaging/helm/openwork-ee/values.yaml")
    const migrationsBlock = requireSlice(values, "migrations:\n", "\ningress:")

    assert.match(migrationsBlock, /command:\n\s+- node/)
    assert.match(migrationsBlock, /args:\n\s+- \/app\/ee\/packages\/den-db\/dist\/scripts\/bootstrap\.js/)
    assertNoForbiddenDeployTools(migrationsBlock)
  })

  test("Dockerfile.den builds Den DB dist assets before the Den API image build", () => {
    const dockerfile = readRepoFile("packaging/docker/Dockerfile.den")
    const typesBuildIndex = dockerfile.indexOf("RUN pnpm --dir /app/packages/types run build")
    const denDbBuildIndex = dockerfile.indexOf("RUN pnpm --dir /app/ee/packages/den-db run build")
    const denApiBuildIndex = dockerfile.indexOf("pnpm --dir /app/ee/apps/den-api run build")

    assert.notEqual(typesBuildIndex, -1, "Dockerfile.den builds @openwork/types")
    assert.notEqual(denDbBuildIndex, -1, "Dockerfile.den builds @openwork-ee/den-db")
    assert.notEqual(denApiBuildIndex, -1, "Dockerfile.den builds @openwork-ee/den-api")
    assert.ok(typesBuildIndex < denDbBuildIndex, "共享类型产物必须先于 den-db 生成")
    assert.ok(denDbBuildIndex < denApiBuildIndex, "den-db dist assets are built before den-api")
  })

  test("Dockerfile.den-web 在 Den Web 之前生成共享类型产物", () => {
    const dockerfile = readRepoFile("packaging/docker/Dockerfile.den-web")
    const typesBuildIndex = dockerfile.indexOf("RUN pnpm --dir /app/packages/types run build")
    const denWebBuildIndex = dockerfile.indexOf("pnpm run build")

    assert.notEqual(typesBuildIndex, -1)
    assert.notEqual(denWebBuildIndex, -1)
    assert.ok(typesBuildIndex < denWebBuildIndex)
  })

  test("Den API 运行镜像只复制生产部署目录", () => {
    const dockerfile = readRepoFile("packaging/docker/Dockerfile.den")
    const runtimeStage = requireSlice(dockerfile, "FROM node:22-bookworm-slim AS runtime", "EXPOSE 8788")

    assert.match(dockerfile, /pnpm --filter @openwork-ee\/den-api --prod deploy --legacy \/runtime\/den-api/)
    assert.match(runtimeStage, /COPY --from=build \/runtime\/den-api \/app\/ee\/apps\/den-api/)
    assert.match(runtimeStage, /ln -s \/app\/ee\/apps\/den-api\/node_modules\/@openwork-ee\/den-db \/app\/ee\/packages\/den-db/)
    assertNoForbiddenDeployTools(runtimeStage)
  })

  test("Den Compose 使用预编译迁移入口", () => {
    const compose = readRepoFile("packaging/docker/docker-compose.den-dev.yml")
    const denService = requireSlice(compose, "\n  den:\n", "\n  web:\n")

    assert.match(denService, /node \/app\/ee\/packages\/den-db\/dist\/scripts\/bootstrap\.js/)
    assert.match(denService, /node \/app\/ee\/apps\/den-api\/dist\/main\.js/)
    assertNoForbiddenDeployTools(denService)
  })

  test("Den Web 使用 standalone 运行镜像", () => {
    const nextConfig = readRepoFile("ee/apps/den-web/next.config.js")
    const dockerfile = readRepoFile("packaging/docker/Dockerfile.den-web")
    const runtimeStage = requireSlice(dockerfile, "FROM node:22-bookworm-slim AS runtime", "EXPOSE 3005")

    assert.match(nextConfig, /output: ["']standalone["']/)
    assert.match(runtimeStage, /COPY --from=build \/app\/ee\/apps\/den-web\/\.next\/standalone \/app/)
    assert.match(runtimeStage, /COPY --from=build \/app\/ee\/apps\/den-web\/\.next\/static/)
    assert.match(dockerfile, /CMD \["node", "\/app\/ee\/apps\/den-web\/server\.js"\]/)
    assertNoForbiddenDeployTools(runtimeStage)
  })

  test("Den API version changes do not invalidate dependency installation layers", () => {
    const dockerfile = readRepoFile("packaging/docker/Dockerfile.den")
    const dependencyInstallIndex = dockerfile.indexOf("RUN pnpm install --frozen-lockfile")
    const versionArgumentIndex = dockerfile.indexOf("ARG DEN_API_VERSION=dev")
    const denApiBuildIndex = dockerfile.indexOf("pnpm --dir /app/ee/apps/den-api run build")

    assert.ok(dependencyInstallIndex < versionArgumentIndex, "版本号必须位于依赖安装层之后")
    assert.ok(versionArgumentIndex < denApiBuildIndex, "版本号必须在 Den API 编译前注入")
  })

  test("hosted Den API build includes den-db assets but start does not run migrations", () => {
    const denApiPackage = readRepoFile("ee/apps/den-api/package.json")
    const denApiBuild = readRepoFile("ee/apps/den-api/scripts/build.mjs")
    const startLine = denApiPackage.split("\n").find((line) => line.includes('"start"')) ?? ""

    assert.match(denApiPackage, /"build:den-db": "pnpm --filter @openwork-ee\/den-db build"/)
    assert.match(denApiBuild, /run\(pnpmCommand, \["run", "build:den-db"\]\)/)
    assert.match(startLine, /"start": "node dist\/main\.js"/)
    assert.equal(startLine.includes("db:migrate"), false, "hosted start alone does not migrate")
    assert.equal(startLine.includes("db:bootstrap"), false, "hosted start alone does not bootstrap")
    assert.equal(startLine.includes("bootstrap.js"), false, "hosted start alone does not invoke the migration runner")
  })

  test("hosted migration workflow remains the explicit PlanetScale migration owner", () => {
    const workflow = readRepoFile(".github/workflows/den-db-migrate.yml")

    assert.match(workflow, /name: Den DB Migrate/)
    assert.match(workflow, /branches:\n\s+- dev/)
    assert.match(workflow, /paths:\n\s+- "ee\/packages\/den-db\/drizzle\/\*\*"/)
    assert.match(workflow, /pscale branch safe-migrations disable/)
    assert.match(workflow, /run_with_ddl_retry pnpm --filter @openwork-ee\/den-db db:migrate/)
    assert.match(workflow, /pscale branch safe-migrations enable/)
  })

  test("PR guardrails run readiness tests and smoke Den DB assets in the Den API image", () => {
    const checkWorkflow = readRepoFile(".github/workflows/den-db-check.yml")
    const publishWorkflow = readRepoFile(".github/workflows/publish-ee-images.yml")

    assert.match(checkWorkflow, /pnpm --filter @openwork-ee\/den-db test/)
    assert.match(checkWorkflow, /"ee\/apps\/den-api\/package\.json"/)
    assert.match(checkWorkflow, /"ee\/apps\/den-api\/scripts\/build\.mjs"/)
    assert.match(checkWorkflow, /"packaging\/docker\/Dockerfile\.den"/)
    assert.match(checkWorkflow, /"packaging\/helm\/openwork-ee\/templates\/migration-job\.yaml"/)
    assert.match(checkWorkflow, /"\.github\/workflows\/publish-ee-images\.yml"/)
    assert.match(publishWorkflow, /Assert Den DB migration assets/)
    assert.match(publishWorkflow, /test -s \/app\/ee\/packages\/den-db\/dist\/scripts\/bootstrap\.js/)
    assert.match(publishWorkflow, /test -s \/app\/ee\/packages\/den-db\/dist\/current-schema\.sql/)
    assert.match(publishWorkflow, /test -s \/app\/ee\/packages\/den-db\/dist\/drizzle\/meta\/_journal\.json/)
  })

  test("production bootstrap source uses the mysql2 ORM migrator and no deploy-time toolchain", () => {
    const bootstrap = readFileSync(path.join(packageDir, "scripts", "bootstrap.ts"), "utf8")

    assert.match(bootstrap, /drizzle-orm\/mysql2\/migrator/)
    assert.match(bootstrap, /await migrate\(db, \{ migrationsFolder \}\)/)
    assert.match(bootstrap, /current-schema\.sql/)
    assert.match(bootstrap, /await ensureFulltextIndexes\(indexExecutor\)/)
    assertNoForbiddenDeployTools(bootstrap)
  })

  test("FoxWork 上游兼容迁移补齐 0.18.3 结构且保留旧公司 Skill 数据", () => {
    const migration = readRepoFile("ee/packages/den-db/drizzle/0050_foxwork_upstream_compatibility.sql")
    const legacySkillTables = ["skill_hub_member", "skill_hub_skill", "skill_hub", "skill"]
    const removedIndexes = [
      "desktop_policy_member_policy_id",
      "desktop_policy_organization_id",
      "inference_org_limit_policies_organization_id",
      "inference_org_upstream_provider_keys_organization_id",
      "inference_org_usage_buckets_policy_id",
      "member_organization_id",
      "organization_brand_asset_organization_id",
      "organization_role_organization_id",
      "scim_group_provider_id",
      "connected_account_org_membership_id",
      "org_oauth_client_organization_id",
      "plugin_mcp_req_binding_organization_id",
      "llm_provider_access_llm_provider_id",
      "llm_provider_model_llm_provider_id",
      "config_object_access_grant_config_object_id",
      "config_object_version_config_object_id",
      "connector_account_organization_id",
      "connector_instance_access_grant_instance_id",
      "connector_instance_organization_id",
      "connector_mapping_connector_target_id",
      "connector_source_binding_config_object_id",
      "connector_target_connector_instance_id",
      "marketplace_access_grant_marketplace_id",
      "marketplace_plugin_marketplace_id",
      "plugin_access_grant_plugin_id",
      "plugin_config_object_plugin_id",
      "org_subscriptions_organization_id",
      "team_member_team_id",
      "team_organization_id",
    ]

    assert.match(migration, /information_schema\.(tables|columns|statistics)/)
    for (const table of legacySkillTables) {
      assert.match(migration, new RegExp("RENAME TABLE `" + table + "` TO `foxwork_legacy_" + table + "`"))
      assert.equal(
        new RegExp("DROP TABLE(?: IF EXISTS)? `" + table + "`", "i").test(migration),
        false,
        `${table} 必须改名保留，不能删除`,
      )
    }
    for (const index of removedIndexes) {
      assert.match(migration, new RegExp("DROP INDEX `" + index + "`"))
    }
    assert.match(migration, /CREATE INDEX `oauth_access_token_token`/)
    assert.match(migration, /CREATE INDEX `idx_connector_account_on_remote_id`/)
    assert.match(migration, /MODIFY COLUMN `normalized_payload_json` mediumtext/)
    assert.match(migration, /MODIFY COLUMN `raw_source_text` mediumtext/)
    assert.match(migration, /ADD `role` varchar\(64\)/)
  })

  test("FoxWork 兼容迁移编号晚于旧发布迁移并保持唯一顺序", () => {
    const journal = readMigrationJournal()
    const tags = journal.entries.map((entry) => entry.tag)
    const compatibilityTags = [
      "0050_foxwork_upstream_compatibility",
      "0051_worker_creation_idempotency",
      "0052_mcp_connection_description",
      "0053_llm_provider_default_enabled",
    ]
    const retiredMigrationNames = [
      "0045_worker_creation_idempotency.sql",
      "0046_gifted_sleeper.sql",
      "0047_mcp_connection_description.sql",
      "0048_llm_provider_default_enabled.sql",
    ]
    const migrationNames = readdirSync(path.join(packageDir, "drizzle"))

    for (const tag of compatibilityTags) assert.equal(tags.filter((entry) => entry === tag).length, 1)
    for (const name of retiredMigrationNames) assert.equal(migrationNames.includes(name), false)

    const compatibilityEntries = journal.entries.filter((entry) => compatibilityTags.includes(entry.tag))
    assert.deepEqual(
      compatibilityEntries.map((entry) => entry.tag),
      compatibilityTags,
    )
    assert.ok(
      compatibilityEntries[0]!.when > 1_785_108_501_780,
      "0050 必须晚于已经发布的 FoxWork 0048，避免升级时被 Drizzle 跳过",
    )
    for (let index = 1; index < compatibilityEntries.length; index += 1) {
      assert.ok(compatibilityEntries[index]!.when > compatibilityEntries[index - 1]!.when)
      assert.equal(compatibilityEntries[index]!.idx, compatibilityEntries[index - 1]!.idx + 1)
    }
  })

  test("Worker 创建幂等迁移只增加可空键和组织内唯一约束", () => {
    const migration = readRepoFile("ee/packages/den-db/drizzle/0051_worker_creation_idempotency.sql")
    const schema = readRepoFile("ee/packages/den-db/src/schema/workers.ts")

    assert.match(migration, /ADD `idempotency_key` varchar\(128\)/)
    assert.match(migration, /UNIQUE\(`org_id`,`created_by_user_id`,`idempotency_key`\)/)
    assert.equal(/DROP\s+(TABLE|COLUMN)/i.test(migration), false)
    assert.match(schema, /idempotency_key: varchar\("idempotency_key", \{ length: 128 \}\)/)
    assert.match(schema, /uniqueIndex\("worker_org_user_idempotency_key"\)/)
  })

  test("MCP 连接说明迁移只新增可空字段并保留既有数据", () => {
    const migration = readRepoFile("ee/packages/den-db/drizzle/0052_mcp_connection_description.sql")
    const schema = readRepoFile("ee/packages/den-db/src/schema/sharables/capability-credentials.ts")

    assert.match(migration, /ALTER TABLE `external_mcp_connection` ADD `description` varchar\(1000\)/)
    assert.equal(/DROP\s+(TABLE|COLUMN)/i.test(migration), false)
    assert.match(schema, /description: varchar\("description", \{ length: 1000 \}\)/)
  })

  test("模型默认全员策略迁移为旧数据保留受限访问语义", () => {
    const migration = readRepoFile("ee/packages/den-db/drizzle/0053_llm_provider_default_enabled.sql")
    const schema = readRepoFile("ee/packages/den-db/src/schema/sharables/llm-providers.ts")

    assert.match(
      migration,
      /ALTER TABLE `llm_provider` ADD `default_enabled` boolean DEFAULT false NOT NULL/,
    )
    assert.equal(/DROP\s+(TABLE|COLUMN)/i.test(migration), false)
    assert.match(
      schema,
      /defaultEnabled: boolean\("default_enabled"\)\.notNull\(\)\.default\(false\)/,
    )
  })

  test("package build emits the precompiled runner, schema snapshot, and migration assets", { timeout: 120_000 }, () => {
    const build = spawnSync(pnpmCommand, ["run", "build"], {
      cwd: packageDir,
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_HOST: "",
        DATABASE_NAME: "",
        DATABASE_PASSWORD: "",
        DATABASE_URL: "",
        DATABASE_USERNAME: "",
      },
    })

    assert.equal(
      build.status,
      0,
      `pnpm run build failed\nstdout:\n${shortOutput(build.stdout)}\nstderr:\n${shortOutput(build.stderr)}`,
    )

    const runner = readFileSync(path.join(packageDir, "dist", "scripts", "bootstrap.js"), "utf8")
    const snapshot = readFileSync(path.join(packageDir, "dist", "current-schema.sql"), "utf8")
    const journal = readFileSync(path.join(packageDir, "dist", "drizzle", "meta", "_journal.json"), "utf8")

    assert.match(runner, /drizzle-orm\/mysql2\/migrator/)
    assert.match(snapshot, /^CREATE TABLE `account`/)
    assert.equal(snapshot.includes("Reading schema files"), false, "schema snapshot contains SQL only")
    assert.match(journal, /"entries"/)
    assert.match(journal, /"0040_rapid_lady_bullseye"/)
  })
})
