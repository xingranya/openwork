import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const denApiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function probeInsecureHttp(overrides: Record<string, string>) {
  return spawnSync(process.execPath, ["--conditions", "development", "--eval", `
    const { env } = await import("./src/env.ts")
    console.log(env.apiPublicUrl)
  `], {
    cwd: denApiRoot,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      TMPDIR: process.env.TMPDIR ?? "",
      DATABASE_URL: "mysql://root:password@127.0.0.1:3306/openwork_test",
      DB_MODE: "mysql",
      DEN_DB_ENCRYPTION_KEY: "x".repeat(32),
      BETTER_AUTH_SECRET: "y".repeat(32),
      BETTER_AUTH_URL: "http://den.openwork.test",
      DEN_API_PUBLIC_URL: "http://api.openwork.test",
      OPENWORK_DEV_MODE: "0",
      PROVISIONER_MODE: "stub",
      ...overrides,
    },
  })
}

test("non-local HTTP remains rejected by default", () => {
  const result = probeInsecureHttp({})

  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain("must use HTTPS")
})

test("private-overlay HTTP requires the explicit self-host switch", () => {
  const enabled = probeInsecureHttp({
    DEN_ALLOW_INSECURE_HTTP: "true",
  })
  const disabled = probeInsecureHttp({
    DEN_ALLOW_INSECURE_HTTP: "false",
  })

  expect(enabled.status).toBe(0)
  expect(enabled.stdout.trim()).toBe("http://api.openwork.test")
  expect(disabled.status).not.toBe(0)
})
