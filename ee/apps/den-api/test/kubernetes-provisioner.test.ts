import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const denApiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function probeKubernetesPlan(overrides: Record<string, string>) {
  return spawnSync(process.execPath, ["--conditions", "development", "--eval", `
    const { buildKubernetesWorkerPlan } = await import("./src/workers/kubernetes.ts")
    const plan = buildKubernetesWorkerPlan({
      workerId: "worker_01jfoxworktest000000000000",
      name: "设计协作",
      hostToken: "host-fixture-token",
      clientToken: "client-fixture-token",
      activityToken: "activity-fixture-token",
    })
    console.log(JSON.stringify(plan))
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
      BETTER_AUTH_URL: "https://den.foxwork.test",
      OPENWORK_DEV_MODE: "0",
      PROVISIONER_MODE: "kubernetes",
      KUBERNETES_WORKER_IMAGE: `registry.foxwork.test/worker@sha256:${"a".repeat(64)}`,
      KUBERNETES_WORKER_DOMAIN_SUFFIX: "workers.foxwork.test",
      KUBERNETES_WORKER_URL_SCHEME: "https",
      KUBERNETES_TLS_SECRET_NAME: "foxwork-workers-tls",
      KUBERNETES_NAMESPACE: "foxwork-workers",
      ...overrides,
    },
  })
}

function probeKubernetesEnv(overrides: Record<string, string>) {
  return spawnSync(process.execPath, ["--conditions", "development", "--eval", `
    const { env } = await import("./src/env.ts")
    console.log(JSON.stringify(env.kubernetes))
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
      BETTER_AUTH_URL: "https://den.foxwork.test",
      OPENWORK_DEV_MODE: "0",
      PROVISIONER_MODE: "kubernetes",
      ...overrides,
    },
  })
}

function probeKubernetesLifecycle(mode: "cleanup" | "conflict" | "unmanaged") {
  return spawnSync(process.execPath, ["test/fixtures/kubernetes-provisioner-probe.ts", mode], {
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
      BETTER_AUTH_URL: "https://den.foxwork.test",
      OPENWORK_DEV_MODE: "0",
      PROVISIONER_MODE: "kubernetes",
      KUBERNETES_WORKER_IMAGE: `registry.foxwork.test/worker@sha256:${"a".repeat(64)}`,
      KUBERNETES_WORKER_DOMAIN_SUFFIX: "workers.foxwork.test",
      KUBERNETES_WORKER_URL_SCHEME: "https",
      KUBERNETES_TLS_SECRET_NAME: "foxwork-workers-tls",
      KUBERNETES_NAMESPACE: "foxwork-workers",
      KUBERNETES_HEALTHCHECK_TIMEOUT_MS: "1000",
      KUBERNETES_POLL_INTERVAL_MS: "1",
    },
  })
}

test("kubernetes provisioner requires an immutable worker image and a worker domain", () => {
  const missing = probeKubernetesEnv({})
  const mutableTag = probeKubernetesEnv({
    KUBERNETES_WORKER_IMAGE: "registry.foxwork.test/worker:v0.17.36",
    KUBERNETES_WORKER_DOMAIN_SUFFIX: "workers.foxwork.test",
  })

  expect(missing.status).not.toBe(0)
  expect(missing.stderr).toContain("KUBERNETES_WORKER_IMAGE is required")
  expect(missing.stderr).toContain("KUBERNETES_WORKER_DOMAIN_SUFFIX is required")
  expect(mutableTag.status).not.toBe(0)
  expect(mutableTag.stderr).toContain("must use an immutable sha256 image digest")
})

test("kubernetes ports and polling intervals must be positive integers", () => {
  const invalid = probeKubernetesEnv({
    KUBERNETES_WORKER_IMAGE: `registry.foxwork.test/worker@sha256:${"a".repeat(64)}`,
    KUBERNETES_WORKER_DOMAIN_SUFFIX: "workers.foxwork.test",
    KUBERNETES_OPENWORK_PORT: "70000",
    KUBERNETES_POLL_INTERVAL_MS: "0",
  })

  expect(invalid.status).not.toBe(0)
  expect(invalid.stderr).toContain("must be a valid TCP port")
  expect(invalid.stderr).toContain("must be a positive integer")
})

test("https kubernetes workers require an explicit TLS secret", () => {
  const missingTls = probeKubernetesEnv({
    KUBERNETES_WORKER_IMAGE: `registry.foxwork.test/worker@sha256:${"a".repeat(64)}`,
    KUBERNETES_WORKER_DOMAIN_SUFFIX: "workers.foxwork.test",
    KUBERNETES_WORKER_URL_SCHEME: "https",
  })
  const internalHttp = probeKubernetesEnv({
    KUBERNETES_WORKER_IMAGE: `registry.foxwork.test/worker@sha256:${"a".repeat(64)}`,
    KUBERNETES_WORKER_DOMAIN_SUFFIX: "workers.foxwork.test",
    KUBERNETES_WORKER_URL_SCHEME: "http",
  })

  expect(missingTls.status).not.toBe(0)
  expect(missingTls.stderr).toContain("KUBERNETES_TLS_SECRET_NAME is required")
  expect(internalHttp.status).toBe(0)
})

test("kubernetes worker plan keeps credentials in a Secret and uses restricted persistent pods", () => {
  const result = probeKubernetesPlan({})

  expect(result.status).toBe(0)
  const plan = JSON.parse(result.stdout)
  const podSpec = plan.deployment.spec.template.spec
  const container = podSpec.containers[0]
  const serializedDeployment = JSON.stringify(plan.deployment)

  expect(plan.url).toMatch(/^https:\/\/foxwork-worker-.+\.workers\.foxwork\.test$/)
  expect(plan.secret.stringData).toEqual({
    DEN_ACTIVITY_HEARTBEAT_TOKEN: "activity-fixture-token",
    OPENWORK_HOST_TOKEN: "host-fixture-token",
    OPENWORK_TOKEN: "client-fixture-token",
  })
  expect(serializedDeployment).not.toContain("host-fixture-token")
  expect(serializedDeployment).not.toContain("client-fixture-token")
  expect(serializedDeployment).not.toContain("activity-fixture-token")
  expect(container.env.filter((entry: { valueFrom?: unknown }) => entry.valueFrom)).toHaveLength(3)
  expect(container.securityContext.allowPrivilegeEscalation).toBe(false)
  expect(container.securityContext.capabilities.drop).toEqual(["ALL"])
  expect(podSpec.automountServiceAccountToken).toBe(false)
  expect(podSpec.securityContext.runAsNonRoot).toBe(true)
  expect(podSpec.securityContext.seccompProfile.type).toBe("RuntimeDefault")
  expect(plan.persistentVolumeClaim.spec.resources.requests.storage).toBe("10Gi")
  expect(plan.service.spec.type).toBe("ClusterIP")
  expect(plan.ingress.spec.tls[0].secretName).toBe("foxwork-workers-tls")
})

test("kubernetes provisioning converges after a concurrent create conflict", () => {
  const result = probeKubernetesLifecycle("conflict")

  expect(result.status).toBe(0)
  const report = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}")
  expect(report.error).toBeNull()
  expect(report.result).toMatchObject({ provider: "kubernetes", status: "healthy" })
  expect(report.creates.filter((kind: string) => kind === "secret")).toHaveLength(1)
  expect(report.replacements).toContain("secret")
  expect(report.deletions).toEqual([])
  expect(report.resources).toEqual([
    "deployment",
    "ingress",
    "persistentVolumeClaim",
    "secret",
    "service",
  ])
})

test("failed provisioning deletes only resources created by that attempt", () => {
  const result = probeKubernetesLifecycle("cleanup")

  expect(result.status).toBe(0)
  const report = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}")
  expect(report.error).toBe("service fixture failure")
  expect(report.deletions).toEqual(["persistentVolumeClaim"])
  expect(report.resources).toEqual(["secret"])
})

test("kubernetes provisioning refuses to modify or delete unmanaged resources", () => {
  const result = probeKubernetesLifecycle("unmanaged")

  expect(result.status).toBe(0)
  const report = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}")
  expect(report.error).toContain("Refusing to modify unmanaged Kubernetes resource")
  expect(report.creates).toEqual([])
  expect(report.replacements).toEqual([])
  expect(report.deletions).toEqual([])
  expect(report.resources).toEqual(["secret"])
})
