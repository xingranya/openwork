import type { KubernetesClients, KubernetesWorkerPlan } from "../../src/workers/kubernetes.js"
import {
  buildKubernetesWorkerPlan,
  provisionWorkerOnKubernetesWithClients,
} from "../../src/workers/kubernetes.js"

type ResourceKind = "deployment" | "ingress" | "persistentVolumeClaim" | "secret" | "service"
type Resource = KubernetesWorkerPlan[ResourceKind]

const mode = process.argv[2]
const worker = {
  workerId: "worker_01jfoxworktest000000000000",
  name: "设计协作",
  hostToken: "host-fixture-token",
  clientToken: "client-fixture-token",
  activityToken: "activity-fixture-token",
}
const plan = buildKubernetesWorkerPlan(worker)
const state = new Map<ResourceKind, Resource>()
const creates: ResourceKind[] = []
const replacements: ResourceKind[] = []
const deletions: ResourceKind[] = []
let conflictInjected = false

function apiError(code: number) {
  return Object.assign(new Error(`fixture api error ${code}`), { code })
}

function stored<T extends Resource>(body: T): T {
  return structuredClone({
    ...body,
    metadata: {
      ...body.metadata,
      resourceVersion: String(Date.now()),
    },
  })
}

async function read(kind: ResourceKind) {
  const resource = state.get(kind)
  if (!resource) throw apiError(404)
  return resource
}

async function create(kind: ResourceKind, body: Resource) {
  creates.push(kind)
  if (mode === "conflict" && kind === "secret" && !conflictInjected) {
    conflictInjected = true
    state.set(kind, stored(body))
    throw apiError(409)
  }
  if (mode === "cleanup" && kind === "service") {
    throw new Error("service fixture failure")
  }
  if (state.has(kind)) throw apiError(409)
  state.set(kind, stored(body))
  return state.get(kind)!
}

async function replace(kind: ResourceKind, body: Resource) {
  replacements.push(kind)
  if (!state.has(kind)) throw apiError(404)
  state.set(kind, stored(body))
  return state.get(kind)!
}

async function remove(kind: ResourceKind) {
  deletions.push(kind)
  if (!state.has(kind)) throw apiError(404)
  state.delete(kind)
  return {}
}

if (mode === "cleanup") {
  state.set("secret", stored(plan.secret))
}
if (mode === "unmanaged") {
  const secret = stored(plan.secret)
  secret.metadata!.labels!["app.kubernetes.io/managed-by"] = "another-controller"
  state.set("secret", secret)
}

const clients = {
  apps: {
    createNamespacedDeployment: ({ body }: { body: Resource }) => create("deployment", body),
    deleteNamespacedDeployment: () => remove("deployment"),
    readNamespacedDeployment: () => read("deployment"),
    readNamespacedDeploymentStatus: async () => ({
      ...await read("deployment"),
      status: { availableReplicas: 1 },
    }),
    replaceNamespacedDeployment: ({ body }: { body: Resource }) => replace("deployment", body),
  },
  core: {
    createNamespacedPersistentVolumeClaim: ({ body }: { body: Resource }) => create("persistentVolumeClaim", body),
    createNamespacedSecret: ({ body }: { body: Resource }) => create("secret", body),
    createNamespacedService: ({ body }: { body: Resource }) => create("service", body),
    deleteNamespacedPersistentVolumeClaim: () => remove("persistentVolumeClaim"),
    deleteNamespacedSecret: () => remove("secret"),
    deleteNamespacedService: () => remove("service"),
    readNamespacedPersistentVolumeClaim: () => read("persistentVolumeClaim"),
    readNamespacedSecret: () => read("secret"),
    readNamespacedService: () => read("service"),
    replaceNamespacedSecret: ({ body }: { body: Resource }) => replace("secret", body),
    replaceNamespacedService: ({ body }: { body: Resource }) => replace("service", body),
  },
  networking: {
    createNamespacedIngress: ({ body }: { body: Resource }) => create("ingress", body),
    deleteNamespacedIngress: () => remove("ingress"),
    readNamespacedIngress: () => read("ingress"),
    replaceNamespacedIngress: ({ body }: { body: Resource }) => replace("ingress", body),
  },
} as unknown as KubernetesClients

globalThis.fetch = async () => new Response("ok", { status: 200 })

let result: unknown = null
let error: string | null = null
try {
  result = await provisionWorkerOnKubernetesWithClients(worker, clients)
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught)
}

console.log(JSON.stringify({
  creates,
  deletions,
  error,
  replacements,
  result,
  resources: [...state.keys()].sort(),
}))
