import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const distDir = path.join(packageDir, "dist")
const migrationsDir = path.join(packageDir, "drizzle")
const distMigrationsDir = path.join(distDir, "drizzle")
const currentSchemaPath = path.join(distDir, "current-schema.sql")
const drizzleKitCliPath = path.join(packageDir, "node_modules", "drizzle-kit", "bin.cjs")

function shortOutput(output) {
  return output.slice(Math.max(0, output.length - 4_000))
}

function sqlFromDrizzleKitExport(stdout) {
  const lines = stdout.replace(/\r\n/g, "\n").split("\n")
  const firstSqlLine = lines.findIndex((line) => /^(CREATE|ALTER|DROP)\s/i.test(line.trimStart()))

  if (firstSqlLine === -1) {
    throw new Error("drizzle-kit export did not emit SQL")
  }

  return `${lines.slice(firstSqlLine).join("\n").trim()}\n`
}

function generateCurrentSchemaSql() {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", drizzleKitCliPath, "export", "--config", "drizzle.config.ts"],
    {
      cwd: packageDir,
      encoding: "utf8",
      env: process.env,
    },
  )

  if (result.status !== 0) {
    process.stdout.write(result.stdout)
    process.stderr.write(result.stderr)
    process.exit(result.status ?? 1)
  }

  try {
    return sqlFromDrizzleKitExport(result.stdout)
  } catch (error) {
    process.stdout.write(shortOutput(result.stdout))
    process.stderr.write(shortOutput(result.stderr))
    throw error
  }
}

mkdirSync(distDir, { recursive: true })
rmSync(distMigrationsDir, { recursive: true, force: true })
cpSync(migrationsDir, distMigrationsDir, { recursive: true })
writeFileSync(currentSchemaPath, generateCurrentSchemaSql())

console.log(`[den-db] copied migrations to ${path.relative(packageDir, distMigrationsDir)}`)
console.log(`[den-db] wrote ${path.relative(packageDir, currentSchemaPath)}`)
