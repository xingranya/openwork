import { and, desc, eq } from "@openwork-ee/den-db/drizzle"
import { WorkerTable, WorkerTokenTable } from "@openwork-ee/den-db/schema"
import { createDenTypeId, normalizeDenTypeId } from "@openwork-ee/utils/typeid"
import type { Hono } from "hono"
import { describeRoute } from "hono-openapi"
import { z } from "zod"
import { db } from "../../db.js"
import { env } from "../../env.js"
import { jsonValidator, orgMemberRoute, paramValidator, queryValidator } from "../../middleware/index.js"
import { denTypeIdSchema, emptyResponse, forbiddenSchema, invalidRequestSchema, jsonResponse, notFoundSchema, unauthorizedSchema } from "../../openapi.js"
import { getOrganizationLimitStatus } from "../../organization-limits.js"
import { getRequiredUserEmail } from "../../user.js"
import {
  canAccessWorkerTokens,
  formatCloudWorkerLimitReachedMessage,
  shouldEnforceCloudWorkerLimit,
  shouldRequireCloudWorkerBilling,
} from "../../worker-limit-policy.js"
import type { WorkerRouteVariables } from "./shared.js"
import {
  continueCloudProvisioning,
  createWorkerSchema,
  deleteWorkerCascade,
  getLatestWorkerInstance,
  getWorkerActiveTokens,
  getWorkerByIdForOrg,
  getWorkerTokensAndConnect,
  listWorkersQuerySchema,
  parseWorkerIdParam,
  requireCloudAccessOrPayment,
  toInstanceResponse,
  toWorkerResponse,
  token,
  updateWorkerSchema,
  workerIdParamSchema,
} from "./shared.js"

const workerInstanceSchema = z.object({
  provider: z.string(),
  region: z.string().nullable(),
  url: z.string().nullable(),
  status: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).nullable().meta({ ref: "WorkerInstance" })

const workerSchema = z.object({
  id: denTypeIdSchema("worker"),
  orgId: denTypeIdSchema("organization"),
  createdByUserId: denTypeIdSchema("user").nullable(),
  isMine: z.boolean(),
  name: z.string(),
  description: z.string().nullable(),
  destination: z.string(),
  status: z.string(),
  imageVersion: z.string().nullable(),
  workspacePath: z.string().nullable(),
  sandboxBackend: z.string().nullable(),
  lastHeartbeatAt: z.string().datetime().nullable(),
  lastActiveAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).meta({ ref: "Worker" })

const workerListResponseSchema = z.object({
  workers: z.array(z.object({
    instance: workerInstanceSchema,
  }).merge(workerSchema)),
}).meta({ ref: "WorkerListResponse" })

const workerResponseSchema = z.object({
  worker: workerSchema,
  instance: workerInstanceSchema,
}).meta({ ref: "WorkerResponse" })

const workerCreateResponseSchema = z.object({
  worker: workerSchema,
  tokens: z.object({
    owner: z.string(),
    host: z.string(),
    client: z.string(),
  }),
  instance: workerInstanceSchema,
  launch: z.object({
    mode: z.string(),
    pollAfterMs: z.number().int(),
  }),
}).meta({ ref: "WorkerCreateResponse" })

const workerTokensResponseSchema = z.object({
  tokens: z.object({
    owner: z.string(),
    host: z.string(),
    client: z.string(),
  }),
  connect: z.object({
    openworkUrl: z.string().nullable(),
    workspaceId: z.string().nullable(),
  }).nullable(),
}).meta({ ref: "WorkerTokensResponse" })

const organizationUnavailableSchema = z.object({
  error: z.literal("organization_unavailable"),
}).meta({ ref: "OrganizationUnavailableError" })

const workspacePathRequiredSchema = z.object({
  error: z.literal("workspace_path_required"),
}).meta({ ref: "WorkspacePathRequiredError" })

const orgLimitReachedSchema = z.object({
  error: z.literal("org_limit_reached"),
  limitType: z.literal("workers"),
  limit: z.number().int(),
  currentCount: z.number().int(),
  message: z.string(),
}).meta({ ref: "WorkerOrgLimitReachedError" })

const idempotencyKeyReusedSchema = z.object({
  error: z.literal("idempotency_key_reused"),
  message: z.string(),
}).meta({ ref: "WorkerIdempotencyKeyReusedError" })

const paymentRequiredSchema = z.object({
  error: z.literal("cloud_worker_billing_unavailable"),
  message: z.string(),
}).meta({ ref: "WorkerPaymentRequiredError" })

const userEmailRequiredSchema = z.object({
  error: z.literal("user_email_required"),
}).meta({ ref: "WorkerUserEmailRequiredError" })

const workerRuntimeUnavailableSchema = z.object({
  error: z.literal("worker_tokens_unavailable"),
  message: z.string(),
}).or(z.object({
  error: z.literal("worker_runtime_unavailable"),
  message: z.string(),
})).meta({ ref: "WorkerConnectionError" })

type WorkerRow = typeof WorkerTable.$inferSelect
type WorkerCreateInput = z.infer<typeof createWorkerSchema>

function workerMatchesCreateInput(worker: WorkerRow, input: WorkerCreateInput) {
  return worker.name === input.name
    && worker.description === (input.description ?? null)
    && worker.destination === input.destination
    && worker.image_version === (input.imageVersion ?? null)
    && worker.workspace_path === (input.workspacePath ?? null)
    && worker.sandbox_backend === (input.sandboxBackend ?? null)
}

function idempotencyKeyReusedResponse() {
  return {
    error: "idempotency_key_reused" as const,
    message: "该幂等键已用于不同的远程工作区创建请求。",
  }
}

async function findIdempotentWorker(input: {
  orgId: WorkerRow["org_id"]
  userId: NonNullable<WorkerRow["created_by_user_id"]>
  idempotencyKey: string
}) {
  const rows = await db
    .select()
    .from(WorkerTable)
    .where(and(
      eq(WorkerTable.org_id, input.orgId),
      eq(WorkerTable.created_by_user_id, input.userId),
      eq(WorkerTable.idempotency_key, input.idempotencyKey),
    ))
    .limit(1)
  return rows[0] ?? null
}

async function buildIdempotentWorkerResponse(worker: WorkerRow, userId: string) {
  const tokens = await getWorkerActiveTokens(worker.id)
  if (!tokens.hostToken || !tokens.clientToken) {
    throw new Error("幂等 Worker 缺少有效连接令牌")
  }
  const instance = await getLatestWorkerInstance(worker.id)
  return {
    worker: toWorkerResponse(worker, userId),
    tokens: {
      owner: tokens.hostToken,
      host: tokens.hostToken,
      client: tokens.clientToken,
    },
    instance: toInstanceResponse(instance),
    launch: {
      mode: "existing",
      pollAfterMs: worker.status === "healthy" ? 0 : 5_000,
    },
  }
}

export function registerWorkerCoreRoutes<T extends { Variables: WorkerRouteVariables }>(app: Hono<T>) {
  app.get(
    "/v1/workers",
    describeRoute({
      tags: ["Workers"],
      summary: "List workers",
      description: "Lists the workers that belong to the caller's active organization, including each worker's latest known instance state.",
      responses: {
        200: jsonResponse("Workers returned successfully.", workerListResponseSchema),
        400: jsonResponse("The worker list query parameters were invalid.", invalidRequestSchema),
        401: jsonResponse("The caller must be signed in to list workers.", unauthorizedSchema),
      },
    }),
    orgMemberRoute({ useUserOrganizations: true }),
    queryValidator(listWorkersQuerySchema),
    async (c) => {
    const user = c.get("user")
    const orgId = c.get("activeOrganizationId")
    const query = c.req.valid("query")

    if (!orgId) {
      return c.json({ workers: [] })
    }

    const rows = await db
      .select()
      .from(WorkerTable)
      .where(eq(WorkerTable.org_id, orgId))
      .orderBy(desc(WorkerTable.created_at))
      .limit(query.limit)

    const workers = await Promise.all(
      rows.map(async (row) => {
        const instance = await getLatestWorkerInstance(row.id)
        return {
          ...toWorkerResponse(row, user.id),
          instance: toInstanceResponse(instance),
        }
      }),
    )

    return c.json({ workers })
    },
  )

  app.post(
    "/v1/workers",
    describeRoute({
      tags: ["Workers"],
      summary: "Create worker",
      description: "Creates a local worker or cloud worker for the active organization and returns the initial tokens needed to connect to it.",
      responses: {
        200: jsonResponse("An existing idempotent worker was returned successfully.", workerCreateResponseSchema),
        201: jsonResponse("Local worker created successfully.", workerCreateResponseSchema),
        202: jsonResponse("Cloud worker creation started successfully.", workerCreateResponseSchema),
        400: jsonResponse("The worker creation payload was invalid.", z.union([invalidRequestSchema, organizationUnavailableSchema, workspacePathRequiredSchema, userEmailRequiredSchema])),
        401: jsonResponse("The caller must be signed in to create workers.", unauthorizedSchema),
        402: jsonResponse("The caller needs an active cloud plan before launching a cloud worker.", paymentRequiredSchema),
        409: jsonResponse(
          "The organization worker limit was reached or the idempotency key was reused with different input.",
          z.union([orgLimitReachedSchema, idempotencyKeyReusedSchema]),
        ),
      },
    }),
    orgMemberRoute({ useUserOrganizations: true }),
    jsonValidator(createWorkerSchema),
    async (c) => {
    const user = c.get("user")
    const orgId = c.get("activeOrganizationId")
    const input = c.req.valid("json")

    if (!orgId) {
      return c.json({ error: "organization_unavailable" }, 400)
    }

    if (input.destination === "local" && !input.workspacePath) {
      return c.json({ error: "workspace_path_required" }, 400)
    }

    if (input.idempotencyKey) {
      const existing = await findIdempotentWorker({
        orgId,
        userId: user.id,
        idempotencyKey: input.idempotencyKey,
      })
      if (existing) {
        if (!workerMatchesCreateInput(existing, input)) {
          return c.json(idempotencyKeyReusedResponse(), 409)
        }
        return c.json(await buildIdempotentWorkerResponse(existing, user.id), 200)
      }
    }

    if (input.destination === "cloud" && shouldRequireCloudWorkerBilling(env.orgMode)) {
      const email = getRequiredUserEmail(user)
      if (!email) {
        return c.json({ error: "user_email_required" }, 400)
      }

      const access = await requireCloudAccessOrPayment({
        userId: normalizeDenTypeId("user", user.id),
        email,
        name: user.name ?? user.email ?? "OpenWork User",
      })

      if (!access.allowed) {
        return c.json({
          error: "cloud_worker_billing_unavailable",
          message: "Creating new cloud workers requires an existing OpenWork Cloud plan. New self-serve purchases are no longer available.",
        }, 402)
      }

      if (shouldEnforceCloudWorkerLimit(env.orgMode)) {
        const workerLimit = await getOrganizationLimitStatus(orgId, "workers")
        if (workerLimit.exceeded) {
          return c.json({
            error: "org_limit_reached",
            limitType: "workers",
            limit: workerLimit.limit,
            currentCount: workerLimit.currentCount,
            message: formatCloudWorkerLimitReachedMessage(workerLimit.limit),
          }, 409)
        }
      }
    }

    const workerId = createDenTypeId("worker")
    const workerStatus = input.destination === "cloud" ? "provisioning" : "healthy"

    const hostToken = token()
    const clientToken = token()
    const activityToken = token()
    try {
      await db.transaction(async (tx) => {
        await tx.insert(WorkerTable).values({
          id: workerId,
          org_id: orgId,
          created_by_user_id: user.id,
          name: input.name,
          description: input.description,
          destination: input.destination,
          status: workerStatus,
          image_version: input.imageVersion,
          workspace_path: input.workspacePath,
          sandbox_backend: input.sandboxBackend,
          idempotency_key: input.idempotencyKey,
        })
        await tx.insert(WorkerTokenTable).values([
          {
            id: createDenTypeId("workerToken"),
            worker_id: workerId,
            scope: "host",
            token: hostToken,
          },
          {
            id: createDenTypeId("workerToken"),
            worker_id: workerId,
            scope: "client",
            token: clientToken,
          },
          {
            id: createDenTypeId("workerToken"),
            worker_id: workerId,
            scope: "activity",
            token: activityToken,
          },
        ])
      })
    } catch (error) {
      if (!input.idempotencyKey) throw error
      const existing = await findIdempotentWorker({
        orgId,
        userId: user.id,
        idempotencyKey: input.idempotencyKey,
      })
      if (!existing) throw error
      if (!workerMatchesCreateInput(existing, input)) {
        return c.json(idempotencyKeyReusedResponse(), 409)
      }
      return c.json(await buildIdempotentWorkerResponse(existing, user.id), 200)
    }

    if (input.destination === "cloud") {
      void continueCloudProvisioning({
        workerId,
        name: input.name,
        hostToken,
        clientToken,
        activityToken,
      })
    }

    return c.json({
      worker: toWorkerResponse(
        {
          id: workerId,
          org_id: orgId,
          created_by_user_id: user.id,
          name: input.name,
          description: input.description ?? null,
          destination: input.destination,
          status: workerStatus,
          image_version: input.imageVersion ?? null,
          workspace_path: input.workspacePath ?? null,
          sandbox_backend: input.sandboxBackend ?? null,
          idempotency_key: input.idempotencyKey ?? null,
          last_heartbeat_at: null,
          last_active_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        user.id,
      ),
      tokens: {
        owner: hostToken,
        host: hostToken,
        client: clientToken,
      },
      instance: null,
      launch: input.destination === "cloud" ? { mode: "async", pollAfterMs: 5000 } : { mode: "instant", pollAfterMs: 0 },
    }, input.destination === "cloud" ? 202 : 201)
    },
  )

  app.get(
    "/v1/workers/:id",
    describeRoute({
      tags: ["Workers"],
      summary: "Get worker",
      description: "Returns one worker from the active organization together with its latest provisioned instance details.",
      responses: {
        200: jsonResponse("Worker returned successfully.", workerResponseSchema),
        400: jsonResponse("The worker path parameters were invalid.", invalidRequestSchema),
        401: jsonResponse("The caller must be signed in to read worker details.", unauthorizedSchema),
        404: jsonResponse("The worker could not be found.", notFoundSchema),
      },
    }),
    orgMemberRoute({ useUserOrganizations: true }),
    paramValidator(workerIdParamSchema),
    async (c) => {
    const user = c.get("user")
    const orgId = c.get("activeOrganizationId")
    const params = c.req.valid("param")

    if (!orgId) {
      return c.json({ error: "worker_not_found" }, 404)
    }

    let workerId
    try {
      workerId = parseWorkerIdParam(params.id)
    } catch {
      return c.json({ error: "worker_not_found" }, 404)
    }

    const worker = await getWorkerByIdForOrg(workerId, orgId)
    if (!worker) {
      return c.json({ error: "worker_not_found" }, 404)
    }

    const instance = await getLatestWorkerInstance(worker.id)

    return c.json({
      worker: toWorkerResponse(worker, user.id),
      instance: toInstanceResponse(instance),
    })
    },
  )

  app.patch(
    "/v1/workers/:id",
    describeRoute({
      tags: ["Workers"],
      summary: "Update worker",
      description: "Renames a worker, but only when the caller is the user who originally created that worker.",
      responses: {
        200: jsonResponse("Worker updated successfully.", z.object({ worker: workerSchema }).meta({ ref: "WorkerUpdateResponse" })),
        400: jsonResponse("The worker update request was invalid.", invalidRequestSchema),
        401: jsonResponse("The caller must be signed in to update workers.", unauthorizedSchema),
        403: jsonResponse("Only the worker owner can rename this worker.", forbiddenSchema),
        404: jsonResponse("The worker could not be found.", notFoundSchema),
      },
    }),
    orgMemberRoute({ useUserOrganizations: true }),
    paramValidator(workerIdParamSchema),
    jsonValidator(updateWorkerSchema),
    async (c) => {
    const user = c.get("user")
    const orgId = c.get("activeOrganizationId")
    const params = c.req.valid("param")
    const input = c.req.valid("json")

    if (!orgId) {
      return c.json({ error: "worker_not_found" }, 404)
    }

    let workerId
    try {
      workerId = parseWorkerIdParam(params.id)
    } catch {
      return c.json({ error: "worker_not_found" }, 404)
    }

    const worker = await getWorkerByIdForOrg(workerId, orgId)
    if (!worker) {
      return c.json({ error: "worker_not_found" }, 404)
    }

    if (worker.created_by_user_id !== user.id) {
      return c.json({
        error: "forbidden",
        message: "Only the worker owner can rename this worker.",
      }, 403)
    }

    await db.update(WorkerTable).set({ name: input.name }).where(eq(WorkerTable.id, workerId))

    return c.json({
      worker: toWorkerResponse(
        {
          ...worker,
          name: input.name,
          updated_at: new Date(),
        },
        user.id,
      ),
    })
    },
  )

  app.post(
    "/v1/workers/:id/tokens",
    describeRoute({
      tags: ["Workers"],
      summary: "Get worker connection tokens",
      description: "Returns connection tokens and the resolved OpenWork connect URL for an existing worker.",
      responses: {
        200: jsonResponse("Worker connection tokens returned successfully.", workerTokensResponseSchema),
        400: jsonResponse("The worker token path parameters were invalid.", invalidRequestSchema),
        401: jsonResponse("The caller must be signed in to request worker tokens.", unauthorizedSchema),
        404: jsonResponse("The worker could not be found.", notFoundSchema),
        409: jsonResponse("The worker is not ready to return connection tokens yet.", workerRuntimeUnavailableSchema),
      },
    }),
    orgMemberRoute({ useUserOrganizations: true }),
    paramValidator(workerIdParamSchema),
    async (c) => {
    const user = c.get("user")
    const orgId = c.get("activeOrganizationId")
    const params = c.req.valid("param")

    if (!orgId) {
      return c.json({ error: "worker_not_found" }, 404)
    }

    let workerId
    try {
      workerId = parseWorkerIdParam(params.id)
    } catch {
      return c.json({ error: "worker_not_found" }, 404)
    }

    const worker = await getWorkerByIdForOrg(workerId, orgId)
    if (!worker || !canAccessWorkerTokens(worker.created_by_user_id, user.id)) {
      return c.json({ error: "worker_not_found" }, 404)
    }

    const resolved = await getWorkerTokensAndConnect(worker)
    if ("error" in resolved && resolved.error) {
      return new Response(JSON.stringify(resolved.error.body), {
        status: resolved.error.status,
        headers: {
          "Content-Type": "application/json",
        },
      })
    }

    return c.json(resolved)
    },
  )

  app.delete(
    "/v1/workers/:id",
    describeRoute({
      tags: ["Workers"],
      summary: "Delete worker",
      description: "Deletes a worker and cascades cleanup for its tokens, runtime records, and provider-specific resources.",
      responses: {
        204: emptyResponse("Worker deleted successfully."),
        400: jsonResponse("The worker deletion path parameters were invalid.", invalidRequestSchema),
        401: jsonResponse("The caller must be signed in to delete workers.", unauthorizedSchema),
        404: jsonResponse("The worker could not be found.", notFoundSchema),
      },
    }),
    orgMemberRoute({ useUserOrganizations: true }),
    paramValidator(workerIdParamSchema),
    async (c) => {
    const orgId = c.get("activeOrganizationId")
    const params = c.req.valid("param")

    if (!orgId) {
      return c.json({ error: "worker_not_found" }, 404)
    }

    let workerId
    try {
      workerId = parseWorkerIdParam(params.id)
    } catch {
      return c.json({ error: "worker_not_found" }, 404)
    }

    const worker = await getWorkerByIdForOrg(workerId, orgId)
    if (!worker) {
      return c.json({ error: "worker_not_found" }, 404)
    }

    await deleteWorkerCascade(worker)
    return c.body(null, 204)
    },
  )
}
