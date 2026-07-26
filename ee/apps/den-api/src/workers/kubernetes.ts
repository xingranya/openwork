import {
  AppsV1Api,
  CoreV1Api,
  KubeConfig,
  NetworkingV1Api,
  type V1Deployment,
  type V1Ingress,
  type V1PersistentVolumeClaim,
  type V1Secret,
  type V1Service,
} from "@kubernetes/client-node"
import { env } from "../env.js"
import { appLogger } from "../observability/logger.js"
import type { ProvisionInput, ProvisionedInstance } from "./provisioner.js"

type WorkerId = ProvisionInput["workerId"]

export type KubernetesClients = {
  apps: AppsV1Api
  core: CoreV1Api
  networking: NetworkingV1Api
}

export type KubernetesWorkerPlan = {
  deployment: V1Deployment
  ingress: V1Ingress
  name: string
  persistentVolumeClaim: V1PersistentVolumeClaim
  secret: V1Secret
  service: V1Service
  url: string
  workerId: WorkerId
}

type KubernetesResourceKind = "deployment" | "ingress" | "persistentVolumeClaim" | "secret" | "service"
type ManagedKubernetesResource = {
  metadata?: {
    labels?: Record<string, string>
    resourceVersion?: string
  }
}

const logger = appLogger.child({ component: "kubernetes_provisioner" })
const managedBy = "openwork-den"
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function requiredKubernetesValue(value: string | undefined, key: string) {
  if (!value) {
    throw new Error(`${key} is required for kubernetes provisioner`)
  }
  return value
}

function workerName(workerId: WorkerId) {
  const normalized = workerId
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
  return `foxwork-worker-${normalized.slice(-40)}`
}

function workerLabels(workerId: WorkerId, name: string) {
  return {
    "app.kubernetes.io/component": "den-worker",
    "app.kubernetes.io/instance": name,
    "app.kubernetes.io/managed-by": managedBy,
    "app.kubernetes.io/name": "foxwork-worker",
    "openwork.den/worker-id": workerId,
  }
}

function workerAnnotations(workerId: WorkerId) {
  return {
    "openwork.den/worker-id": workerId,
  }
}

function buildWorkerCommand() {
  return [
    "set -eu",
    "mkdir -p /persist/workspace /persist/openwork /tmp/openwork-sidecars",
    "test -x \"$(command -v openwork)\"",
    "test -x \"$(command -v opencode)\"",
    [
      "exec openwork serve",
      "--workspace /persist/workspace",
      "--remote-access",
      `--openwork-port ${env.kubernetes.openworkPort}`,
      "--opencode-host 127.0.0.1",
      `--opencode-port ${env.kubernetes.opencodePort}`,
      "--connect-host 127.0.0.1",
      "--cors '*'",
      "--approval manual",
      "--allow-external",
      "--opencode-source external",
      "--opencode-bin \"$(command -v opencode)\"",
      "--verbose",
    ].join(" "),
  ].join("\n")
}

function buildSecret(input: ProvisionInput, name: string, labels: Record<string, string>): V1Secret {
  return {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      annotations: workerAnnotations(input.workerId),
      labels,
      name,
      namespace: env.kubernetes.namespace,
    },
    stringData: {
      DEN_ACTIVITY_HEARTBEAT_TOKEN: input.activityToken,
      OPENWORK_HOST_TOKEN: input.hostToken,
      OPENWORK_TOKEN: input.clientToken,
    },
    type: "Opaque",
  }
}

function buildPersistentVolumeClaim(
  input: ProvisionInput,
  name: string,
  labels: Record<string, string>,
): V1PersistentVolumeClaim {
  return {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: {
      annotations: workerAnnotations(input.workerId),
      labels,
      name,
      namespace: env.kubernetes.namespace,
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      resources: {
        requests: {
          storage: env.kubernetes.storageSize,
        },
      },
      ...(env.kubernetes.storageClassName
        ? { storageClassName: env.kubernetes.storageClassName }
        : {}),
    },
  }
}

function buildDeployment(
  input: ProvisionInput,
  name: string,
  labels: Record<string, string>,
): V1Deployment {
  const workerImage = requiredKubernetesValue(
    env.kubernetes.workerImage,
    "KUBERNETES_WORKER_IMAGE",
  )
  const activityBaseUrl = env.workerActivityBaseUrl.replace(/\/+$/, "")

  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      annotations: workerAnnotations(input.workerId),
      labels,
      name,
      namespace: env.kubernetes.namespace,
    },
    spec: {
      replicas: 1,
      selector: { matchLabels: labels },
      strategy: { type: "Recreate" },
      template: {
        metadata: {
          annotations: workerAnnotations(input.workerId),
          labels,
        },
        spec: {
          automountServiceAccountToken: false,
          containers: [
            {
              args: [buildWorkerCommand()],
              command: ["/bin/sh", "-lc"],
              env: [
                {
                  name: "OPENWORK_TOKEN",
                  valueFrom: { secretKeyRef: { key: "OPENWORK_TOKEN", name } },
                },
                {
                  name: "OPENWORK_HOST_TOKEN",
                  valueFrom: { secretKeyRef: { key: "OPENWORK_HOST_TOKEN", name } },
                },
                {
                  name: "DEN_ACTIVITY_HEARTBEAT_TOKEN",
                  valueFrom: {
                    secretKeyRef: { key: "DEN_ACTIVITY_HEARTBEAT_TOKEN", name },
                  },
                },
                { name: "DEN_ACTIVITY_HEARTBEAT_ENABLED", value: "1" },
                {
                  name: "DEN_ACTIVITY_HEARTBEAT_URL",
                  value: `${activityBaseUrl}/v1/workers/${input.workerId}/activity`,
                },
                { name: "DEN_RUNTIME_PROVIDER", value: "kubernetes" },
                { name: "DEN_WORKER_ID", value: input.workerId },
                { name: "OPENWORK_DATA_DIR", value: "/persist/openwork" },
                { name: "OPENWORK_SIDECAR_DIR", value: "/tmp/openwork-sidecars" },
              ],
              image: workerImage,
              imagePullPolicy: "IfNotPresent",
              livenessProbe: {
                failureThreshold: 6,
                httpGet: { path: "/health", port: "http" },
                initialDelaySeconds: 30,
                periodSeconds: 10,
                timeoutSeconds: 5,
              },
              name: "worker",
              ports: [
                {
                  containerPort: env.kubernetes.openworkPort,
                  name: "http",
                  protocol: "TCP",
                },
              ],
              readinessProbe: {
                failureThreshold: 30,
                httpGet: { path: "/health", port: "http" },
                initialDelaySeconds: 5,
                periodSeconds: 5,
                timeoutSeconds: 3,
              },
              resources: {
                limits: {
                  cpu: env.kubernetes.resources.cpuLimit,
                  memory: env.kubernetes.resources.memoryLimit,
                },
                requests: {
                  cpu: env.kubernetes.resources.cpuRequest,
                  memory: env.kubernetes.resources.memoryRequest,
                },
              },
              securityContext: {
                allowPrivilegeEscalation: false,
                capabilities: { drop: ["ALL"] },
                runAsNonRoot: true,
                runAsUser: 1000,
              },
              volumeMounts: [{ mountPath: "/persist", name: "persist" }],
            },
          ],
          securityContext: {
            fsGroup: 1000,
            runAsGroup: 1000,
            runAsNonRoot: true,
            runAsUser: 1000,
            seccompProfile: { type: "RuntimeDefault" },
          },
          terminationGracePeriodSeconds: 30,
          volumes: [
            {
              name: "persist",
              persistentVolumeClaim: { claimName: name },
            },
          ],
        },
      },
    },
  }
}

function buildService(
  input: ProvisionInput,
  name: string,
  labels: Record<string, string>,
): V1Service {
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      annotations: workerAnnotations(input.workerId),
      labels,
      name,
      namespace: env.kubernetes.namespace,
    },
    spec: {
      ports: [
        {
          name: "http",
          port: env.kubernetes.openworkPort,
          protocol: "TCP",
          targetPort: "http",
        },
      ],
      selector: labels,
      type: "ClusterIP",
    },
  }
}

function buildIngress(
  input: ProvisionInput,
  name: string,
  labels: Record<string, string>,
  host: string,
): V1Ingress {
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "Ingress",
    metadata: {
      annotations: workerAnnotations(input.workerId),
      labels,
      name,
      namespace: env.kubernetes.namespace,
    },
    spec: {
      ...(env.kubernetes.ingressClassName
        ? { ingressClassName: env.kubernetes.ingressClassName }
        : {}),
      rules: [
        {
          host,
          http: {
            paths: [
              {
                backend: {
                  service: {
                    name,
                    port: { name: "http" },
                  },
                },
                path: "/",
                pathType: "Prefix",
              },
            ],
          },
        },
      ],
      ...(env.kubernetes.tlsSecretName
        ? {
            tls: [
              {
                hosts: [host],
                secretName: env.kubernetes.tlsSecretName,
              },
            ],
          }
        : {}),
    },
  }
}

export function buildKubernetesWorkerPlan(input: ProvisionInput): KubernetesWorkerPlan {
  const name = workerName(input.workerId)
  const labels = workerLabels(input.workerId, name)
  const domainSuffix = requiredKubernetesValue(
    env.kubernetes.workerDomainSuffix,
    "KUBERNETES_WORKER_DOMAIN_SUFFIX",
  )
    .replace(/^\.+/, "")
    .toLowerCase()
  const host = `${name}.${domainSuffix}`

  return {
    deployment: buildDeployment(input, name, labels),
    ingress: buildIngress(input, name, labels, host),
    name,
    persistentVolumeClaim: buildPersistentVolumeClaim(input, name, labels),
    secret: buildSecret(input, name, labels),
    service: buildService(input, name, labels),
    url: `${env.kubernetes.workerUrlScheme}://${host}`,
    workerId: input.workerId,
  }
}

function createKubernetesClients(): KubernetesClients {
  const kubeConfig = new KubeConfig()
  kubeConfig.loadFromDefault()
  return {
    apps: kubeConfig.makeApiClient(AppsV1Api),
    core: kubeConfig.makeApiClient(CoreV1Api),
    networking: kubeConfig.makeApiClient(NetworkingV1Api),
  }
}

function isNotFound(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === 404)
}

function isConflict(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === 409)
}

function assertManagedResource(
  resource: ManagedKubernetesResource,
  workerId: WorkerId,
  name: string,
) {
  const labels = resource.metadata?.labels
  if (
    labels?.["app.kubernetes.io/managed-by"] !== managedBy
    || labels?.["openwork.den/worker-id"] !== workerId
  ) {
    throw new Error(`Refusing to modify unmanaged Kubernetes resource ${name}`)
  }
}

async function createOrReplaceManagedResource<T extends ManagedKubernetesResource>(input: {
  create: () => Promise<unknown>
  prepareForCreate?: () => void
  prepareForReplace?: (current: T) => void
  read: () => Promise<T>
  replace: () => Promise<unknown>
  resource: T
  resourceName: string
  workerId: WorkerId
}) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let current: T
    try {
      current = await input.read()
    } catch (error) {
      if (!isNotFound(error)) {
        throw error
      }

      delete input.resource.metadata?.resourceVersion
      input.prepareForCreate?.()
      try {
        await input.create()
        return true
      } catch (createError) {
        if (isConflict(createError)) {
          continue
        }
        throw createError
      }
    }

    assertManagedResource(current, input.workerId, input.resourceName)
    input.resource.metadata!.resourceVersion = current.metadata?.resourceVersion
    input.prepareForReplace?.(current)
    try {
      await input.replace()
      return false
    } catch (replaceError) {
      if (isConflict(replaceError) || isNotFound(replaceError)) {
        continue
      }
      throw replaceError
    }
  }

  throw new Error(`Kubernetes resource ${input.resourceName} changed during five update attempts`)
}

async function ensureManagedResource<T extends ManagedKubernetesResource>(input: {
  create: () => Promise<unknown>
  read: () => Promise<T>
  resourceName: string
  workerId: WorkerId
}) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const current = await input.read()
      assertManagedResource(current, input.workerId, input.resourceName)
      return false
    } catch (error) {
      if (!isNotFound(error)) {
        throw error
      }
    }

    try {
      await input.create()
      return true
    } catch (createError) {
      if (!isConflict(createError)) {
        throw createError
      }
    }
  }

  throw new Error(`Kubernetes resource ${input.resourceName} changed during five create attempts`)
}

async function upsertSecret(clients: KubernetesClients, plan: KubernetesWorkerPlan) {
  return createOrReplaceManagedResource({
    create: () => clients.core.createNamespacedSecret({
      body: plan.secret,
      fieldManager: "openwork-den",
      fieldValidation: "Strict",
      namespace: env.kubernetes.namespace,
    }),
    read: () => clients.core.readNamespacedSecret({
      name: plan.name,
      namespace: env.kubernetes.namespace,
    }),
    replace: () => clients.core.replaceNamespacedSecret({
      body: plan.secret,
      fieldManager: "openwork-den",
      fieldValidation: "Strict",
      name: plan.name,
      namespace: env.kubernetes.namespace,
    }),
    resource: plan.secret,
    resourceName: plan.name,
    workerId: plan.workerId,
  })
}

async function ensurePersistentVolumeClaim(
  clients: KubernetesClients,
  plan: KubernetesWorkerPlan,
) {
  return ensureManagedResource({
    create: () => clients.core.createNamespacedPersistentVolumeClaim({
      body: plan.persistentVolumeClaim,
      fieldManager: "openwork-den",
      fieldValidation: "Strict",
      namespace: env.kubernetes.namespace,
    }),
    read: () => clients.core.readNamespacedPersistentVolumeClaim({
      name: plan.name,
      namespace: env.kubernetes.namespace,
    }),
    resourceName: plan.name,
    workerId: plan.workerId,
  })
}

async function upsertDeployment(clients: KubernetesClients, plan: KubernetesWorkerPlan) {
  return createOrReplaceManagedResource({
    create: () => clients.apps.createNamespacedDeployment({
      body: plan.deployment,
      fieldManager: "openwork-den",
      fieldValidation: "Strict",
      namespace: env.kubernetes.namespace,
    }),
    read: () => clients.apps.readNamespacedDeployment({
      name: plan.name,
      namespace: env.kubernetes.namespace,
    }),
    replace: () => clients.apps.replaceNamespacedDeployment({
      body: plan.deployment,
      fieldManager: "openwork-den",
      fieldValidation: "Strict",
      name: plan.name,
      namespace: env.kubernetes.namespace,
    }),
    resource: plan.deployment,
    resourceName: plan.name,
    workerId: plan.workerId,
  })
}

async function upsertService(clients: KubernetesClients, plan: KubernetesWorkerPlan) {
  return createOrReplaceManagedResource<V1Service>({
    create: () => clients.core.createNamespacedService({
      body: plan.service,
      fieldManager: "openwork-den",
      fieldValidation: "Strict",
      namespace: env.kubernetes.namespace,
    }),
    prepareForCreate: () => {
      delete plan.service.spec!.clusterIP
      delete plan.service.spec!.clusterIPs
      delete plan.service.spec!.ipFamilies
      delete plan.service.spec!.ipFamilyPolicy
    },
    prepareForReplace: (current) => {
      plan.service.spec!.clusterIP = current.spec?.clusterIP
      plan.service.spec!.clusterIPs = current.spec?.clusterIPs
      plan.service.spec!.ipFamilies = current.spec?.ipFamilies
      plan.service.spec!.ipFamilyPolicy = current.spec?.ipFamilyPolicy
    },
    read: () => clients.core.readNamespacedService({
      name: plan.name,
      namespace: env.kubernetes.namespace,
    }),
    replace: () => clients.core.replaceNamespacedService({
      body: plan.service,
      fieldManager: "openwork-den",
      fieldValidation: "Strict",
      name: plan.name,
      namespace: env.kubernetes.namespace,
    }),
    resource: plan.service,
    resourceName: plan.name,
    workerId: plan.workerId,
  })
}

async function upsertIngress(clients: KubernetesClients, plan: KubernetesWorkerPlan) {
  return createOrReplaceManagedResource({
    create: () => clients.networking.createNamespacedIngress({
      body: plan.ingress,
      fieldManager: "openwork-den",
      fieldValidation: "Strict",
      namespace: env.kubernetes.namespace,
    }),
    read: () => clients.networking.readNamespacedIngress({
      name: plan.name,
      namespace: env.kubernetes.namespace,
    }),
    replace: () => clients.networking.replaceNamespacedIngress({
      body: plan.ingress,
      fieldManager: "openwork-den",
      fieldValidation: "Strict",
      name: plan.name,
      namespace: env.kubernetes.namespace,
    }),
    resource: plan.ingress,
    resourceName: plan.name,
    workerId: plan.workerId,
  })
}

async function waitForWorkerReady(clients: KubernetesClients, plan: KubernetesWorkerPlan) {
  const startedAt = Date.now()
  const serviceHealthUrl = `http://${plan.name}.${env.kubernetes.namespace}.svc.cluster.local:${env.kubernetes.openworkPort}/health`

  while (Date.now() - startedAt < env.kubernetes.healthcheckTimeoutMs) {
    const deployment = await clients.apps.readNamespacedDeploymentStatus({
      name: plan.name,
      namespace: env.kubernetes.namespace,
    })
    if ((deployment.status?.availableReplicas ?? 0) > 0) {
      try {
        const response = await fetch(serviceHealthUrl, {
          signal: AbortSignal.timeout(Math.min(env.kubernetes.pollIntervalMs, 10_000)),
        })
        if (response.ok) {
          return
        }
      } catch {
        // Deployment 可能会先显示可用，集群 DNS 和端点仍需要短暂收敛。
      }
    }
    await sleep(env.kubernetes.pollIntervalMs)
  }

  throw new Error(`Timed out waiting for Kubernetes worker health at ${serviceHealthUrl}`)
}

export async function provisionWorkerOnKubernetesWithClients(
  input: ProvisionInput,
  clients: KubernetesClients,
): Promise<ProvisionedInstance> {
  const plan = buildKubernetesWorkerPlan(input)
  const createdResources: KubernetesResourceKind[] = []

  try {
    if (await upsertSecret(clients, plan)) createdResources.push("secret")
    if (await ensurePersistentVolumeClaim(clients, plan)) {
      createdResources.push("persistentVolumeClaim")
    }
    if (await upsertService(clients, plan)) createdResources.push("service")
    if (await upsertDeployment(clients, plan)) createdResources.push("deployment")
    if (await upsertIngress(clients, plan)) createdResources.push("ingress")
    await waitForWorkerReady(clients, plan)
  } catch (error) {
    logger.error("kubernetes worker provisioning failed", {
      error,
      worker_id: input.workerId,
    })
    if (createdResources.length > 0) {
      await deleteKubernetesWorkerResources(clients, input.workerId, createdResources).catch(
        (cleanupError) => {
          logger.error("kubernetes worker provisioning cleanup failed", {
            error: cleanupError,
            worker_id: input.workerId,
          })
        },
      )
    }
    throw error
  }

  return {
    provider: "kubernetes",
    status: "healthy",
    url: plan.url,
  }
}

export async function provisionWorkerOnKubernetes(
  input: ProvisionInput,
): Promise<ProvisionedInstance> {
  return provisionWorkerOnKubernetesWithClients(input, createKubernetesClients())
}

async function readManagedResource(
  read: () => Promise<ManagedKubernetesResource>,
  workerId: WorkerId,
  name: string,
) {
  try {
    const resource = await read()
    assertManagedResource(resource, workerId, name)
    return resource
  } catch (error) {
    if (isNotFound(error)) {
      return null
    }
    throw error
  }
}

async function deleteManagedResource(input: {
  delete: () => Promise<unknown>
  name: string
  read: () => Promise<ManagedKubernetesResource>
  workerId: WorkerId
}) {
  const resource = await readManagedResource(input.read, input.workerId, input.name)
  if (!resource) {
    return
  }

  try {
    await input.delete()
  } catch (error) {
    if (!isNotFound(error)) {
      throw error
    }
  }
}

function kubernetesResourceOperations(
  clients: KubernetesClients,
  workerId: WorkerId,
): Record<KubernetesResourceKind, {
  delete: () => Promise<unknown>
  read: () => Promise<ManagedKubernetesResource>
}> {
  const name = workerName(workerId)
  const namespace = env.kubernetes.namespace
  return {
    deployment: {
      delete: () => clients.apps.deleteNamespacedDeployment({
        name,
        namespace,
        propagationPolicy: "Foreground",
      }),
      read: () => clients.apps.readNamespacedDeployment({ name, namespace }),
    },
    ingress: {
      delete: () => clients.networking.deleteNamespacedIngress({ name, namespace }),
      read: () => clients.networking.readNamespacedIngress({ name, namespace }),
    },
    persistentVolumeClaim: {
      delete: () => clients.core.deleteNamespacedPersistentVolumeClaim({ name, namespace }),
      read: () => clients.core.readNamespacedPersistentVolumeClaim({ name, namespace }),
    },
    secret: {
      delete: () => clients.core.deleteNamespacedSecret({ name, namespace }),
      read: () => clients.core.readNamespacedSecret({ name, namespace }),
    },
    service: {
      delete: () => clients.core.deleteNamespacedService({ name, namespace }),
      read: () => clients.core.readNamespacedService({ name, namespace }),
    },
  }
}

async function waitForResourcesDeleted(
  operations: ReturnType<typeof kubernetesResourceOperations>,
  resources: readonly KubernetesResourceKind[],
  workerId: WorkerId,
) {
  const startedAt = Date.now()
  const name = workerName(workerId)

  while (Date.now() - startedAt < env.kubernetes.healthcheckTimeoutMs) {
    const remaining = await Promise.all(resources.map(async (kind) => {
      const resource = await readManagedResource(operations[kind].read, workerId, name)
      return resource ? kind : null
    }))
    if (remaining.every((kind) => kind === null)) {
      return
    }
    await sleep(env.kubernetes.pollIntervalMs)
  }

  throw new Error(`Timed out waiting for Kubernetes worker resources to delete for ${workerId}`)
}

async function deleteKubernetesWorkerResources(
  clients: KubernetesClients,
  workerId: WorkerId,
  resources: readonly KubernetesResourceKind[] = [
    "ingress",
    "deployment",
    "service",
    "secret",
    "persistentVolumeClaim",
  ],
) {
  const deletionOrder: readonly KubernetesResourceKind[] = [
    "ingress",
    "deployment",
    "service",
    "secret",
    "persistentVolumeClaim",
  ]
  const requestedResources = new Set(resources)
  const orderedResources = deletionOrder.filter((kind) => requestedResources.has(kind))
  const name = workerName(workerId)
  const errors: unknown[] = []
  const operations = kubernetesResourceOperations(clients, workerId)

  for (const kind of orderedResources) {
    try {
      await deleteManagedResource({
        delete: operations[kind].delete,
        name,
        read: operations[kind].read,
        workerId,
      })
    } catch (error) {
      errors.push(error)
    }
  }

  if (errors.length > 0) {
    throw new AggregateError(errors, `Failed to fully delete Kubernetes worker ${workerId}`)
  }
  await waitForResourcesDeleted(operations, orderedResources, workerId)
}

export async function deprovisionWorkerOnKubernetes(workerId: WorkerId) {
  await deleteKubernetesWorkerResources(createKubernetesClients(), workerId)
}
