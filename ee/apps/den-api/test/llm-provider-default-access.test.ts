import { createDenTypeId } from "@openwork-ee/utils/typeid";
import { afterAll, beforeAll, expect, mock, test } from "bun:test";

process.env.DATABASE_URL = process.env.DATABASE_URL ?? "mysql://root:password@127.0.0.1:3306/openwork_test_llm_default_access";
process.env.DEN_DB_ENCRYPTION_KEY = process.env.DEN_DB_ENCRYPTION_KEY ?? "local-dev-db-encryption-key-please-change-1234567890";
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "local-dev-secret-not-for-production-use!!";
process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:8790";
process.env.DEN_API_PUBLIC_URL = process.env.DEN_API_PUBLIC_URL ?? "http://127.0.0.1:8790";
process.env.CORS_ORIGINS = process.env.CORS_ORIGINS ?? "http://127.0.0.1:8790";

let app: typeof import("../src/app.js").default;
let db: typeof import("../src/db.js").db;
let schema: typeof import("@openwork-ee/den-db/schema");
let drizzle: typeof import("@openwork-ee/den-db/drizzle");
let session: typeof import("../src/session.js");

const adminUserId = createDenTypeId("user");
const existingUserId = createDenTypeId("user");
const futureUserId = createDenTypeId("user");
const organizationId = createDenTypeId("organization");
const adminMemberId = createDenTypeId("member");
const existingMemberId = createDenTypeId("member");
const futureMemberId = createDenTypeId("member");

const providerIds: string[] = [];

beforeAll(async () => {
  mock.restore();
  const realDb = (await import("@openwork-ee/den-db")).createDenDb({
    databaseUrl: process.env.DATABASE_URL ?? "",
    mode: "mysql",
  }).db;
  mock.module("../src/db.js", () => ({ db: realDb }));

  const [appMod, dbMod, schemaMod, drizzleMod, sessionMod] = await Promise.all([
    import("../src/app.js"),
    import("../src/db.js"),
    import("@openwork-ee/den-db/schema"),
    import("@openwork-ee/den-db/drizzle"),
    import("../src/session.js"),
  ]);
  app = appMod.default;
  db = dbMod.db;
  schema = schemaMod;
  drizzle = drizzleMod;
  session = sessionMod;

  await db.insert(schema.AuthUserTable).values([
    { id: adminUserId, name: "模型管理员", email: `model-admin+${adminUserId}@test.local` },
    { id: existingUserId, name: "现有员工", email: `model-existing+${existingUserId}@test.local` },
  ]);
  await db.insert(schema.OrganizationTable).values({
    id: organizationId,
    name: "模型策略测试公司",
    slug: `model-policy-${organizationId}`,
  });
  await db.insert(schema.MemberTable).values([
    { id: adminMemberId, organizationId, userId: adminUserId, role: "admin" },
    { id: existingMemberId, organizationId, userId: existingUserId, role: "member" },
  ]);
});

afterAll(async () => {
  if (providerIds.length > 0) {
    await db.delete(schema.LlmProviderAccessTable).where(drizzle.inArray(schema.LlmProviderAccessTable.llmProviderId, providerIds));
    await db.delete(schema.LlmProviderModelTable).where(drizzle.inArray(schema.LlmProviderModelTable.llmProviderId, providerIds));
    await db.delete(schema.LlmProviderTable).where(drizzle.inArray(schema.LlmProviderTable.id, providerIds));
  }
  await db.delete(schema.MemberTable).where(drizzle.eq(schema.MemberTable.organizationId, organizationId));
  await db.delete(schema.OrganizationRoleTable).where(drizzle.eq(schema.OrganizationRoleTable.organizationId, organizationId));
  await db.delete(schema.OrganizationTable).where(drizzle.eq(schema.OrganizationTable.id, organizationId));
  await db.delete(schema.AuthUserTable).where(drizzle.inArray(schema.AuthUserTable.id, [adminUserId, existingUserId, futureUserId]));
  mock.restore();
});

function request(userId: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-den-internal-mcp-principal", session.createInternalMcpPrincipalHeader({ userId, organizationId }));
  if (init.body) headers.set("content-type", "application/json");
  return app.fetch(new Request(`http://den-api.local${path}`, { ...init, headers }));
}

function providerBody(extra: Record<string, unknown> = {}) {
  return {
    name: "公司默认模型",
    source: "custom",
    customConfig: {
      id: "company-openai",
      name: "公司默认模型",
      npm: "@ai-sdk/openai-compatible",
      api: "https://models.test.local/v1",
      env: ["COMPANY_OPENAI_API_KEY"],
      models: {
        "gpt-company": { name: "GPT Company" },
      },
    },
    apiKey: "test-key",
    ...extra,
  };
}

async function usableProviders(userId: string) {
  const response = await request(userId, "/v1/llm-providers?scope=usable");
  expect(response.status).toBe(200);
  return (await response.json()) as { llmProviders: Array<{ id: string; defaultEnabled?: boolean }> };
}

async function resourceProviderIds(userId: string) {
  const response = await request(userId, "/v1/resources");
  expect(response.status).toBe(200);
  const payload = await response.json() as {
    resources: { llmProviders: Record<string, string> };
  };
  return Object.keys(payload.resources.llmProviders);
}

test("普通成员不能把模型默认开放给全公司", async () => {
  const response = await request(existingUserId, "/v1/llm-providers", {
    method: "POST",
    body: JSON.stringify(providerBody({ defaultEnabled: true })),
  });
  const payload = await response.json() as { llmProvider?: { id?: string } };
  if (payload.llmProvider?.id) providerIds.push(payload.llmProvider.id);

  expect(response.status).toBe(403);
});

test("默认全员模型覆盖现有与以后新增成员，关闭后保留明确授权", async () => {
  const created = await request(adminUserId, "/v1/llm-providers", {
    method: "POST",
    body: JSON.stringify(providerBody({
      defaultEnabled: true,
      memberIds: [existingMemberId],
      teamIds: [],
    })),
  });
  expect(created.status).toBe(201);
  const createdBody = await created.json() as { llmProvider: { id: string; defaultEnabled?: boolean } };
  const providerId = createdBody.llmProvider.id;
  providerIds.push(providerId);
  expect(createdBody.llmProvider.defaultEnabled).toBe(true);
  expect((await usableProviders(existingUserId)).llmProviders.map((provider) => provider.id)).toContain(providerId);

  await db.insert(schema.AuthUserTable).values({
    id: futureUserId,
    name: "新增员工",
    email: `model-future+${futureUserId}@test.local`,
  });
  await db.insert(schema.MemberTable).values({
    id: futureMemberId,
    organizationId,
    userId: futureUserId,
    role: "member",
  });
  expect((await usableProviders(futureUserId)).llmProviders.map((provider) => provider.id)).toContain(providerId);
  expect(await resourceProviderIds(futureUserId)).toContain(providerId);

  const updated = await request(adminUserId, `/v1/llm-providers/${providerId}`, {
    method: "PATCH",
    body: JSON.stringify(providerBody({ defaultEnabled: false })),
  });
  expect(updated.status).toBe(200);
  const updatedBody = await updated.json() as { llmProvider: { defaultEnabled?: boolean } };
  expect(updatedBody.llmProvider.defaultEnabled).toBe(false);

  expect((await usableProviders(existingUserId)).llmProviders.map((provider) => provider.id)).toContain(providerId);
  expect((await usableProviders(futureUserId)).llmProviders.map((provider) => provider.id)).not.toContain(providerId);
  expect(await resourceProviderIds(existingUserId)).toContain(providerId);
  expect(await resourceProviderIds(futureUserId)).not.toContain(providerId);
});
