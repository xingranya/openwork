import type { Hono } from "hono"
import { describeRoute } from "hono-openapi"
import { z } from "zod"
import { env } from "../../env.js"
import { orgMemberRoute, queryValidator } from "../../middleware/index.js"
import { jsonResponse, unauthorizedSchema } from "../../openapi.js"
import {
  getSkillsCatalogAudit,
  getSkillsCatalogDetail,
  listSkillsCatalog,
  SkillsCatalogError,
} from "../../skills-catalog.js"
import type { OrgRouteVariables } from "./shared.js"

const listQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  view: z.enum(["all-time", "trending", "hot"]).optional(),
  page: z.coerce.number().int().min(0).max(10_000).optional(),
  perPage: z.coerce.number().int().min(1).max(100).optional(),
})

const detailQuerySchema = z.object({ id: z.string().trim().min(3).max(512) })
const catalogResponseSchema = z.object({}).passthrough().meta({ ref: "SkillCatalogResponse" })
const catalogErrorSchema = z.object({ error: z.string(), message: z.string() }).meta({ ref: "SkillCatalogError" })

function catalogConfig() {
  return {
    apiBaseUrl: env.skillsCatalog.apiBaseUrl,
    allowInsecureHttp: env.devMode,
  }
}

function catalogErrorResponse(c: any, error: unknown) {
  if (error instanceof SkillsCatalogError) {
    const status = [400, 401, 404, 409, 422, 429, 502, 503, 504].includes(error.status)
      ? error.status
      : 502
    return c.json({ error: error.code, message: error.message }, status)
  }
  return c.json({ error: "skill_catalog_failed", message: "在线技能目录请求失败，请稍后再试。" }, 502)
}

export function registerOrgSkillCatalogRoutes<T extends { Variables: OrgRouteVariables }>(app: Hono<T>) {
  app.get(
    "/v1/skill-catalog",
    describeRoute({
      tags: ["Skills"],
      summary: "浏览魔搭在线技能目录",
      responses: {
        200: jsonResponse("已返回在线技能目录。", catalogResponseSchema),
        401: jsonResponse("请求者必须先登录。", unauthorizedSchema),
        502: jsonResponse("在线技能目录请求失败。", catalogErrorSchema),
      },
    }),
    orgMemberRoute(),
    queryValidator(listQuerySchema),
    async (c) => {
      try {
        const query = c.req.valid("query")
        return c.json(await listSkillsCatalog(catalogConfig(), {
          query: query.q,
          view: query.view,
          page: query.page,
          perPage: query.perPage,
        }))
      } catch (error) {
        return catalogErrorResponse(c, error)
      }
    },
  )

  app.get(
    "/v1/skill-catalog/detail",
    describeRoute({
      tags: ["Skills"],
      summary: "读取魔搭技能文件",
      responses: {
        200: jsonResponse("已返回在线技能文件。", catalogResponseSchema),
        401: jsonResponse("请求者必须先登录。", unauthorizedSchema),
        502: jsonResponse("在线技能目录请求失败。", catalogErrorSchema),
      },
    }),
    orgMemberRoute(),
    queryValidator(detailQuerySchema),
    async (c) => {
      try {
        return c.json(await getSkillsCatalogDetail(catalogConfig(), c.req.valid("query").id))
      } catch (error) {
        return catalogErrorResponse(c, error)
      }
    },
  )

  app.get(
    "/v1/skill-catalog/audit",
    describeRoute({
      tags: ["Skills"],
      summary: "执行在线技能本地安全检查",
      responses: {
        200: jsonResponse("已返回在线技能安全审计。", catalogResponseSchema),
        401: jsonResponse("请求者必须先登录。", unauthorizedSchema),
        502: jsonResponse("在线技能目录请求失败。", catalogErrorSchema),
      },
    }),
    orgMemberRoute(),
    queryValidator(detailQuerySchema),
    async (c) => {
      try {
        return c.json(await getSkillsCatalogAudit(catalogConfig(), c.req.valid("query").id))
      } catch (error) {
        return catalogErrorResponse(c, error)
      }
    },
  )
}
