import { and, desc, eq, inArray, isNull } from "@openwork-ee/den-db/drizzle"
import {
  ConfigObjectAccessGrantTable,
  ConfigObjectTable,
  ConfigObjectVersionTable,
  MemberTable,
  OrganizationTable,
  PluginAccessGrantTable,
  PluginConfigObjectTable,
  PluginTable,
  TeamTable,
} from "@openwork-ee/den-db/schema"
import { createDenTypeId } from "@openwork-ee/utils/typeid"
import { db } from "../../db.js"
import {
  buildCompanySkillVersionPayload,
  COMPANY_SKILL_BUNDLE_SCHEMA_VERSION,
  companySkillRelativePath,
  companySkillSlugFromRelativePath,
  parseCompanySkillVersionPayload,
} from "./company-skill-bundle.js"
import {
  validateCompanySkillBundleFiles,
  type ParsedSkillZipItem,
} from "./skill-zip-import.js"

type OrganizationId = typeof OrganizationTable.$inferSelect.id
type MemberId = typeof MemberTable.$inferSelect.id
type TeamId = typeof TeamTable.$inferSelect.id
type PluginId = typeof PluginTable.$inferSelect.id
type ConfigObjectId = typeof ConfigObjectTable.$inferSelect.id
type PluginRow = typeof PluginTable.$inferSelect
type ConfigObjectRow = typeof ConfigObjectTable.$inferSelect
type ConfigObjectVersionRow = typeof ConfigObjectVersionTable.$inferSelect
type GrantRole = typeof PluginAccessGrantTable.$inferSelect.role
type PluginAccessGrantId = typeof PluginAccessGrantTable.$inferSelect.id
type ConfigObjectAccessGrantId = typeof ConfigObjectAccessGrantTable.$inferSelect.id
type SkillStoreTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type CompanySkillStoreDatabase = Pick<typeof db, "transaction">

type AccessGrantRow<TId extends string = string> = {
  id: TId
  orgMembershipId: MemberId | null
  orgWide: boolean
  removedAt: Date | null
  role: GrantRole
  teamId: TeamId | null
}

type AccessTarget =
  | { kind: "org" }
  | { id: MemberId; kind: "member" }
  | { id: TeamId; kind: "team" }

export type CompanySkillAccess = {
  memberIds: MemberId[]
  orgWide: boolean
  teamIds: TeamId[]
}

export type CompanySkillSaveAction = "created" | "updated" | "unchanged"

export class CompanySkillStoreError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "CompanySkillStoreError"
  }
}

function accessTargetKey(target: AccessTarget) {
  if (target.kind === "org") return "org"
  return `${target.kind}:${target.id}`
}

function grantTargetKey(row: Pick<AccessGrantRow, "orgMembershipId" | "orgWide" | "teamId">) {
  if (row.orgWide) return "org"
  if (row.orgMembershipId) return `member:${row.orgMembershipId}`
  if (row.teamId) return `team:${row.teamId}`
  return null
}

function targetValues(target: AccessTarget) {
  return {
    orgMembershipId: target.kind === "member" ? target.id : null,
    orgWide: target.kind === "org",
    teamId: target.kind === "team" ? target.id : null,
  }
}

function requestedAccessTargets(access: CompanySkillAccess): AccessTarget[] {
  if (access.orgWide) return [{ kind: "org" }]
  return [
    ...access.memberIds.map((id) => ({ id, kind: "member" as const })),
    ...access.teamIds.map((id) => ({ id, kind: "team" as const })),
  ]
}

export function companySkillAccessNeedsChange(rows: AccessGrantRow[], access: CompanySkillAccess) {
  const requestedKeys = new Set(requestedAccessTargets(access).map(accessTargetKey))
  const activeKeys = new Set(rows.flatMap((row) => {
    if (row.removedAt) return []
    const key = grantTargetKey(row)
    return key ? [key] : []
  }))

  if ([...requestedKeys].some((key) => !activeKeys.has(key))) return true
  return rows.some((row) => (
    !row.removedAt
    && row.role === "viewer"
    && Boolean(grantTargetKey(row))
    && !requestedKeys.has(grantTargetKey(row) ?? "")
  ))
}

async function lockOrganization(tx: SkillStoreTransaction, organizationId: OrganizationId) {
  const rows = await tx
    .select({ id: OrganizationTable.id })
    .from(OrganizationTable)
    .where(eq(OrganizationTable.id, organizationId))
    .for("update")
  if (!rows[0]) {
    throw new CompanySkillStoreError(404, "organization_not_found", "当前公司不存在或已被删除。")
  }
}

async function validateAccessTargets(tx: SkillStoreTransaction, input: {
  access: CompanySkillAccess
  organizationId: OrganizationId
}) {
  const memberIds = [...new Set(input.access.memberIds)]
  const teamIds = [...new Set(input.access.teamIds)]
  const members = memberIds.length === 0
    ? []
    : await tx.select({ id: MemberTable.id }).from(MemberTable).where(and(
        eq(MemberTable.organizationId, input.organizationId),
        inArray(MemberTable.id, memberIds),
        isNull(MemberTable.removedAt),
      ))
  const teams = teamIds.length === 0
    ? []
    : await tx.select({ id: TeamTable.id }).from(TeamTable).where(and(
        eq(TeamTable.organizationId, input.organizationId),
        inArray(TeamTable.id, teamIds),
      ))
  if (members.length !== memberIds.length) {
    throw new CompanySkillStoreError(400, "invalid_member_access", "共享范围中包含不属于当前公司的成员。")
  }
  if (teams.length !== teamIds.length) {
    throw new CompanySkillStoreError(400, "invalid_team_access", "共享范围中包含不属于当前公司的团队。")
  }
  return {
    memberIds: memberIds.sort(),
    orgWide: input.access.orgWide,
    teamIds: teamIds.sort(),
  } satisfies CompanySkillAccess
}

async function readPluginGrants(
  tx: SkillStoreTransaction,
  pluginId: PluginId,
): Promise<AccessGrantRow<PluginAccessGrantId>[]> {
  return tx
    .select({
      id: PluginAccessGrantTable.id,
      orgMembershipId: PluginAccessGrantTable.orgMembershipId,
      orgWide: PluginAccessGrantTable.orgWide,
      removedAt: PluginAccessGrantTable.removedAt,
      role: PluginAccessGrantTable.role,
      teamId: PluginAccessGrantTable.teamId,
    })
    .from(PluginAccessGrantTable)
    .where(eq(PluginAccessGrantTable.pluginId, pluginId))
}

async function readConfigObjectGrants(
  tx: SkillStoreTransaction,
  configObjectId: ConfigObjectId,
): Promise<AccessGrantRow<ConfigObjectAccessGrantId>[]> {
  return tx
    .select({
      id: ConfigObjectAccessGrantTable.id,
      orgMembershipId: ConfigObjectAccessGrantTable.orgMembershipId,
      orgWide: ConfigObjectAccessGrantTable.orgWide,
      removedAt: ConfigObjectAccessGrantTable.removedAt,
      role: ConfigObjectAccessGrantTable.role,
      teamId: ConfigObjectAccessGrantTable.teamId,
    })
    .from(ConfigObjectAccessGrantTable)
    .where(eq(ConfigObjectAccessGrantTable.configObjectId, configObjectId))
}

function grantReconciliationPlan<TId extends string>(rows: AccessGrantRow<TId>[], access: CompanySkillAccess) {
  const targets = requestedAccessTargets(access)
  const requestedKeys = new Set(targets.map(accessTargetKey))
  const activeKeys = new Set(rows.flatMap((row) => {
    if (row.removedAt) return []
    const key = grantTargetKey(row)
    return key ? [key] : []
  }))
  return {
    additions: targets.filter((target) => !activeKeys.has(accessTargetKey(target))),
    removals: rows.filter((row) => (
      !row.removedAt
      && row.role === "viewer"
      && Boolean(grantTargetKey(row))
      && !requestedKeys.has(grantTargetKey(row) ?? "")
    )),
  }
}

async function reconcilePluginAccess(tx: SkillStoreTransaction, input: {
  access: CompanySkillAccess
  actorMemberId: MemberId
  organizationId: OrganizationId
  pluginId: PluginId
  rows: AccessGrantRow<PluginAccessGrantId>[]
}) {
  const now = new Date()
  const plan = grantReconciliationPlan(input.rows, input.access)
  for (const row of plan.removals) {
    await tx.update(PluginAccessGrantTable).set({ removedAt: now }).where(eq(PluginAccessGrantTable.id, row.id))
  }
  for (const target of plan.additions) {
    const key = accessTargetKey(target)
    const existing = input.rows.find((row) => grantTargetKey(row) === key)
    if (existing) {
      await tx.update(PluginAccessGrantTable).set({
        ...targetValues(target),
        createdByOrgMembershipId: input.actorMemberId,
        removedAt: null,
        role: "viewer",
      }).where(eq(PluginAccessGrantTable.id, existing.id))
      continue
    }
    await tx.insert(PluginAccessGrantTable).values({
      ...targetValues(target),
      createdAt: now,
      createdByOrgMembershipId: input.actorMemberId,
      id: createDenTypeId("pluginAccessGrant"),
      organizationId: input.organizationId,
      pluginId: input.pluginId,
      role: "viewer",
    })
  }
}

async function reconcileConfigObjectAccess(tx: SkillStoreTransaction, input: {
  access: CompanySkillAccess
  actorMemberId: MemberId
  configObjectId: ConfigObjectId
  organizationId: OrganizationId
  rows: AccessGrantRow<ConfigObjectAccessGrantId>[]
}) {
  const now = new Date()
  const plan = grantReconciliationPlan(input.rows, input.access)
  for (const row of plan.removals) {
    await tx.update(ConfigObjectAccessGrantTable).set({ removedAt: now }).where(eq(ConfigObjectAccessGrantTable.id, row.id))
  }
  for (const target of plan.additions) {
    const key = accessTargetKey(target)
    const existing = input.rows.find((row) => grantTargetKey(row) === key)
    if (existing) {
      await tx.update(ConfigObjectAccessGrantTable).set({
        ...targetValues(target),
        createdByOrgMembershipId: input.actorMemberId,
        removedAt: null,
        role: "viewer",
      }).where(eq(ConfigObjectAccessGrantTable.id, existing.id))
      continue
    }
    await tx.insert(ConfigObjectAccessGrantTable).values({
      ...targetValues(target),
      configObjectId: input.configObjectId,
      createdAt: now,
      createdByOrgMembershipId: input.actorMemberId,
      id: createDenTypeId("configObjectAccessGrant"),
      organizationId: input.organizationId,
      role: "viewer",
    })
  }
}

async function findExistingCompanySkill(tx: SkillStoreTransaction, input: {
  organizationId: OrganizationId
  slug: string
}) {
  const relativePath = companySkillRelativePath(input.slug)
  const objects = await tx
    .select()
    .from(ConfigObjectTable)
    .where(and(
      eq(ConfigObjectTable.organizationId, input.organizationId),
      eq(ConfigObjectTable.objectType, "skill"),
      eq(ConfigObjectTable.currentRelativePath, relativePath),
    ))
    .limit(2)
  if (objects.length > 1) {
    throw new CompanySkillStoreError(409, "duplicate_company_skill", "同名公司技能存在重复记录，请先联系管理员处理。")
  }
  const configObject = objects[0]
  if (!configObject) return null

  const memberships = await tx
    .select()
    .from(PluginConfigObjectTable)
    .where(and(
      eq(PluginConfigObjectTable.organizationId, input.organizationId),
      eq(PluginConfigObjectTable.configObjectId, configObject.id),
      isNull(PluginConfigObjectTable.removedAt),
    ))
    .limit(2)
  if (memberships.length !== 1) {
    throw new CompanySkillStoreError(409, "company_skill_membership_invalid", "公司技能与插件的关联不完整，请先联系管理员处理。")
  }
  const plugin = (await tx
    .select()
    .from(PluginTable)
    .where(and(
      eq(PluginTable.id, memberships[0]!.pluginId),
      eq(PluginTable.organizationId, input.organizationId),
    ))
    .limit(1))[0]
  if (!plugin) {
    throw new CompanySkillStoreError(409, "company_skill_plugin_missing", "公司技能对应的插件不存在，请先联系管理员处理。")
  }
  const version = (await tx
    .select()
    .from(ConfigObjectVersionTable)
    .where(and(
      eq(ConfigObjectVersionTable.organizationId, input.organizationId),
      eq(ConfigObjectVersionTable.configObjectId, configObject.id),
    ))
    .orderBy(desc(ConfigObjectVersionTable.createdAt), desc(ConfigObjectVersionTable.id))
    .limit(1))[0] ?? null
  return { configObject, plugin, version }
}

function serializeCompanySkill(input: {
  canManage: boolean
  configObject: ConfigObjectRow
  plugin: PluginRow
  version: ConfigObjectVersionRow
}) {
  const bundle = parseCompanySkillVersionPayload(input.version)
  const slug = companySkillSlugFromRelativePath(input.configObject.currentRelativePath)
  if (!bundle || !slug) {
    throw new CompanySkillStoreError(409, "company_skill_payload_invalid", "公司技能文件包不完整，请重新导入。")
  }
  return {
    bundleHash: bundle.bundleHash,
    canManage: input.canManage,
    description: input.configObject.description,
    files: bundle.files,
    id: input.configObject.id,
    pluginId: input.plugin.id,
    shared: bundle.shared === "org" ? "org" as const : null,
    skillText: bundle.skillText,
    slug,
    title: input.configObject.title,
    updatedAt: input.configObject.updatedAt.toISOString(),
  }
}

function createVersionRow(input: {
  actorMemberId: MemberId
  bundle: ParsedSkillZipItem
  configObjectId: ConfigObjectId
  organizationId: OrganizationId
  shared: "org" | "private"
  timestamp: Date
}): ConfigObjectVersionRow {
  return {
    configObjectId: input.configObjectId,
    connectorSyncEventId: null,
    createdAt: input.timestamp,
    createdByOrgMembershipId: input.actorMemberId,
    createdVia: "cloud",
    id: createDenTypeId("configObjectVersion"),
    isDeletedVersion: false,
    normalizedPayloadJson: buildCompanySkillVersionPayload(input.bundle, input.shared),
    organizationId: input.organizationId,
    rawSourceText: input.bundle.skillText,
    schemaVersion: COMPANY_SKILL_BUNDLE_SCHEMA_VERSION,
    sourceRevisionRef: `company-skill:${input.bundle.bundleHash}:${input.shared}`,
  }
}

export async function saveCompanySkill(input: {
  access: CompanySkillAccess
  actorIsAdmin: boolean
  actorMemberId: MemberId
  bundle: ParsedSkillZipItem
  organizationId: OrganizationId
  overwrite: boolean
}, dependencies: { database?: CompanySkillStoreDatabase } = {}) {
  const database = dependencies.database ?? db
  return database.transaction(async (tx) => {
    await lockOrganization(tx, input.organizationId)
    const access = await validateAccessTargets(tx, {
      access: input.access,
      organizationId: input.organizationId,
    })
    const existing = await findExistingCompanySkill(tx, {
      organizationId: input.organizationId,
      slug: input.bundle.slug,
    })
    const shared = access.orgWide ? "org" as const : "private" as const
    const relativePath = companySkillRelativePath(input.bundle.slug)
    const now = new Date()

    if (!existing) {
      const pluginId = createDenTypeId("plugin")
      const configObjectId = createDenTypeId("configObject")
      const plugin: PluginRow = {
        createdAt: now,
        createdByOrgMembershipId: input.actorMemberId,
        deletedAt: null,
        description: input.bundle.description,
        id: pluginId,
        name: input.bundle.title,
        organizationId: input.organizationId,
        status: "active",
        updatedAt: now,
      }
      const configObject: ConfigObjectRow = {
        connectorInstanceId: null,
        createdAt: now,
        createdByOrgMembershipId: input.actorMemberId,
        currentFileExtension: "md",
        currentFileName: "SKILL.md",
        currentRelativePath: relativePath,
        deletedAt: null,
        description: input.bundle.description,
        id: configObjectId,
        objectType: "skill",
        organizationId: input.organizationId,
        searchText: [input.bundle.title, input.bundle.description, input.bundle.skillText].filter(Boolean).join("\n"),
        sourceMode: "cloud",
        status: "active",
        title: input.bundle.title,
        updatedAt: now,
      }
      const version = createVersionRow({
        actorMemberId: input.actorMemberId,
        bundle: input.bundle,
        configObjectId,
        organizationId: input.organizationId,
        shared,
        timestamp: now,
      })

      await tx.insert(PluginTable).values(plugin)
      await tx.insert(ConfigObjectTable).values(configObject)
      await tx.insert(ConfigObjectVersionTable).values(version)
      await tx.insert(PluginConfigObjectTable).values({
        configObjectId,
        connectorMappingId: null,
        createdAt: now,
        createdByOrgMembershipId: input.actorMemberId,
        id: createDenTypeId("pluginConfigObject"),
        membershipSource: "manual",
        organizationId: input.organizationId,
        pluginId,
        removedAt: null,
      })
      await tx.insert(PluginAccessGrantTable).values({
        createdAt: now,
        createdByOrgMembershipId: input.actorMemberId,
        id: createDenTypeId("pluginAccessGrant"),
        organizationId: input.organizationId,
        orgMembershipId: input.actorMemberId,
        orgWide: false,
        pluginId,
        removedAt: null,
        role: "manager",
        teamId: null,
      })
      await tx.insert(ConfigObjectAccessGrantTable).values({
        configObjectId,
        createdAt: now,
        createdByOrgMembershipId: input.actorMemberId,
        id: createDenTypeId("configObjectAccessGrant"),
        organizationId: input.organizationId,
        orgMembershipId: input.actorMemberId,
        orgWide: false,
        removedAt: null,
        role: "manager",
        teamId: null,
      })
      await reconcilePluginAccess(tx, {
        access,
        actorMemberId: input.actorMemberId,
        organizationId: input.organizationId,
        pluginId,
        rows: await readPluginGrants(tx, pluginId),
      })
      await reconcileConfigObjectAccess(tx, {
        access,
        actorMemberId: input.actorMemberId,
        configObjectId,
        organizationId: input.organizationId,
        rows: await readConfigObjectGrants(tx, configObjectId),
      })

      return {
        action: "created" as const,
        item: serializeCompanySkill({
          canManage: true,
          configObject,
          plugin,
          version,
        }),
      }
    }

    const canManage = input.actorIsAdmin
      || existing.plugin.createdByOrgMembershipId === input.actorMemberId
      || existing.configObject.createdByOrgMembershipId === input.actorMemberId
    const storedBundle = existing.version ? parseCompanySkillVersionPayload(existing.version) : null
    const contentChanged = !storedBundle || storedBundle.bundleHash !== input.bundle.bundleHash
    const sharedChanged = !storedBundle || storedBundle.shared !== shared
    const pluginChanged = existing.plugin.name !== input.bundle.title
      || existing.plugin.description !== input.bundle.description
      || existing.plugin.status !== "active"
      || existing.plugin.deletedAt !== null
    const configObjectChanged = existing.configObject.title !== input.bundle.title
      || existing.configObject.description !== input.bundle.description
      || existing.configObject.currentFileName !== "SKILL.md"
      || existing.configObject.currentFileExtension !== "md"
      || existing.configObject.currentRelativePath !== relativePath
      || existing.configObject.status !== "active"
      || existing.configObject.deletedAt !== null
    const [pluginGrants, configObjectGrants] = await Promise.all([
      readPluginGrants(tx, existing.plugin.id),
      readConfigObjectGrants(tx, existing.configObject.id),
    ])
    const accessChanged = companySkillAccessNeedsChange(pluginGrants, access)
      || companySkillAccessNeedsChange(configObjectGrants, access)
    const changed = contentChanged || sharedChanged || pluginChanged || configObjectChanged || accessChanged

    if (changed && !canManage) {
      throw new CompanySkillStoreError(403, "skill_forbidden", "同名公司技能已存在，只有原创建者或管理员可以更新。")
    }
    if (contentChanged && !input.overwrite) {
      throw new CompanySkillStoreError(409, "skill_already_exists", "同名技能已存在且内容不同，请确认覆盖后重试。")
    }

    if (pluginChanged) {
      await tx.update(PluginTable).set({
        deletedAt: null,
        description: input.bundle.description,
        name: input.bundle.title,
        status: "active",
        updatedAt: now,
      }).where(eq(PluginTable.id, existing.plugin.id))
    }
    if (configObjectChanged) {
      await tx.update(ConfigObjectTable).set({
        currentFileExtension: "md",
        currentFileName: "SKILL.md",
        currentRelativePath: relativePath,
        deletedAt: null,
        description: input.bundle.description,
        searchText: [input.bundle.title, input.bundle.description, input.bundle.skillText].filter(Boolean).join("\n"),
        status: "active",
        title: input.bundle.title,
        updatedAt: now,
      }).where(eq(ConfigObjectTable.id, existing.configObject.id))
    }

    let version = existing.version
    if (contentChanged || sharedChanged || !version) {
      const nextVersion = createVersionRow({
        actorMemberId: input.actorMemberId,
        bundle: input.bundle,
        configObjectId: existing.configObject.id,
        organizationId: input.organizationId,
        shared,
        timestamp: now,
      })
      await tx.insert(ConfigObjectVersionTable).values(nextVersion)
      version = nextVersion
    }
    if (accessChanged) {
      await reconcilePluginAccess(tx, {
        access,
        actorMemberId: input.actorMemberId,
        organizationId: input.organizationId,
        pluginId: existing.plugin.id,
        rows: pluginGrants,
      })
      await reconcileConfigObjectAccess(tx, {
        access,
        actorMemberId: input.actorMemberId,
        configObjectId: existing.configObject.id,
        organizationId: input.organizationId,
        rows: configObjectGrants,
      })
    }
    if (!version) {
      throw new CompanySkillStoreError(404, "skill_version_not_found", "技能保存后未能重新读取文件版本。")
    }

    const configObject: ConfigObjectRow = configObjectChanged
      ? {
          ...existing.configObject,
          currentFileExtension: "md",
          currentFileName: "SKILL.md",
          currentRelativePath: relativePath,
          deletedAt: null,
          description: input.bundle.description,
          searchText: [input.bundle.title, input.bundle.description, input.bundle.skillText].filter(Boolean).join("\n"),
          status: "active",
          title: input.bundle.title,
          updatedAt: now,
        }
      : existing.configObject
    const plugin: PluginRow = pluginChanged
      ? {
          ...existing.plugin,
          deletedAt: null,
          description: input.bundle.description,
          name: input.bundle.title,
          status: "active",
          updatedAt: now,
        }
      : existing.plugin

    return {
      action: changed ? "updated" as const : "unchanged" as const,
      item: serializeCompanySkill({ canManage, configObject, plugin, version }),
    }
  })
}

export function singleFileCompanySkill(skillText: string) {
  return validateCompanySkillBundleFiles("skill", [{ path: "SKILL.md", contents: skillText }])
}
