import { and, eq, inArray, isNull, or } from "@openwork-ee/den-db/drizzle"
import {
  MemberTable,
  SkillHubMemberTable,
  SkillHubSkillTable,
  SkillHubTable,
  SkillTable,
  TeamTable,
} from "@openwork-ee/den-db/schema"
import { parseSkillMarkdown } from "@openwork-ee/utils"
import { createDenTypeId } from "@openwork-ee/utils/typeid"
import { db } from "../../db.js"
import {
  computeCompanySkillBundleHash,
  validateCompanySkillBundleFiles,
  type ParsedSkillZipItem,
  type SkillBundleFile,
} from "./skill-zip-import.js"

type SkillId = typeof SkillTable.$inferSelect.id
type MemberId = typeof MemberTable.$inferSelect.id
type TeamId = typeof TeamTable.$inferSelect.id
type SkillRow = typeof SkillTable.$inferSelect
type SkillStoreTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

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

function sourceKeyForSlug(slug: string) {
  return `company:${slug}`
}

function managedHubKeyForSlug(slug: string) {
  return `company-skill:${slug}`
}

function legacyRowSlug(row: SkillRow) {
  if (row.slug?.trim()) return row.slug.trim()
  try {
    return parseSkillMarkdown(row.skillText).name.trim()
  } catch {
    return ""
  }
}

export function storedSkillFiles(row: Pick<SkillRow, "bundleFilesJson" | "skillText">): SkillBundleFile[] {
  if (Array.isArray(row.bundleFilesJson) && row.bundleFilesJson.length > 0) {
    return row.bundleFilesJson
  }
  return [{ path: "SKILL.md", contents: row.skillText }]
}

export function replaceCompanySkillEntrypoint(
  row: Pick<SkillRow, "bundleFilesJson" | "skillText">,
  skillText: string,
) {
  const files = storedSkillFiles(row).map((file) => (
    file.path === "SKILL.md" ? { ...file, contents: skillText } : file
  ))
  const bundle = validateCompanySkillBundleFiles("skill", files)
  return {
    bundleHash: bundle.bundleHash,
    files: bundle.files,
    skillText: bundle.skillText,
  }
}

export function serializeCompanySkill(row: SkillRow, canManage: boolean) {
  const files = storedSkillFiles(row)
  const slug = row.slug ?? legacyRowSlug(row)
  return {
    ...row,
    bundleFilesJson: undefined,
    bundleHash: row.bundleHash ?? computeCompanySkillBundleHash(files),
    canManage,
    files,
    slug: slug || row.id,
    sourceKey: undefined,
  }
}

async function validateAccessTargets(tx: SkillStoreTransaction, input: {
  access: CompanySkillAccess
  organizationId: SkillRow["organizationId"]
}) {
  const memberIds = [...new Set(input.access.memberIds)]
  const teamIds = [...new Set(input.access.teamIds)]
  const [members, teams] = await Promise.all([
    memberIds.length === 0
      ? Promise.resolve([])
      : tx.select({ id: MemberTable.id }).from(MemberTable).where(and(
          eq(MemberTable.organizationId, input.organizationId),
          inArray(MemberTable.id, memberIds),
          isNull(MemberTable.removedAt),
        )),
    teamIds.length === 0
      ? Promise.resolve([])
      : tx.select({ id: TeamTable.id }).from(TeamTable).where(and(
          eq(TeamTable.organizationId, input.organizationId),
          inArray(TeamTable.id, teamIds),
        )),
  ])
  if (members.length !== memberIds.length) {
    throw new CompanySkillStoreError(400, "invalid_member_access", "共享范围中包含不属于当前公司的成员。")
  }
  if (teams.length !== teamIds.length) {
    throw new CompanySkillStoreError(400, "invalid_team_access", "共享范围中包含不属于当前公司的团队。")
  }
  return { memberIds, teamIds }
}

async function findExistingSkill(tx: SkillStoreTransaction, input: {
  organizationId: SkillRow["organizationId"]
  slug: string
}) {
  const sourceKey = sourceKeyForSlug(input.slug)
  const rows = await tx
    .select()
    .from(SkillTable)
    .where(and(
      eq(SkillTable.organizationId, input.organizationId),
      or(eq(SkillTable.sourceKey, sourceKey), eq(SkillTable.slug, input.slug), isNull(SkillTable.sourceKey)),
    ))
  return rows.find((row) => row.sourceKey === sourceKey || legacyRowSlug(row) === input.slug) ?? null
}

async function replaceManagedHubAccess(tx: SkillStoreTransaction, input: {
  access: CompanySkillAccess
  actorMemberId: MemberId
  organizationId: SkillRow["organizationId"]
  skillId: SkillId
  slug: string
}) {
  const managedKey = managedHubKeyForSlug(input.slug)
  const now = new Date()
  let hub = (await tx
    .select()
    .from(SkillHubTable)
    .where(and(
      eq(SkillHubTable.organizationId, input.organizationId),
      eq(SkillHubTable.managedKey, managedKey),
    ))
    .limit(1))[0]

  if (!hub) {
    hub = {
      id: createDenTypeId("skillHub"),
      organizationId: input.organizationId,
      createdByOrgMembershipId: input.actorMemberId,
      name: `技能：${input.slug}`,
      description: "FoxWork 公司技能分发范围。",
      managedKey,
      createdAt: now,
      updatedAt: now,
    }
    await tx.insert(SkillHubTable).values(hub)
  }

  const existingLink = (await tx
    .select({ id: SkillHubSkillTable.id })
    .from(SkillHubSkillTable)
    .where(and(
      eq(SkillHubSkillTable.skillHubId, hub.id),
      eq(SkillHubSkillTable.skillId, input.skillId),
    ))
    .limit(1))[0]
  if (!existingLink) {
    await tx.insert(SkillHubSkillTable).values({
      id: createDenTypeId("skillHubSkill"),
      skillHubId: hub.id,
      skillId: input.skillId,
      addedByOrgMembershipId: input.actorMemberId,
      createdAt: now,
    })
  }

  await tx.delete(SkillHubMemberTable).where(eq(SkillHubMemberTable.skillHubId, hub.id))
  const memberIds = new Set<MemberId>([input.actorMemberId, ...input.access.memberIds])
  if (!input.access.orgWide) {
    for (const memberId of memberIds) {
      await tx.insert(SkillHubMemberTable).values({
        id: createDenTypeId("skillHubMember"),
        skillHubId: hub.id,
        orgMembershipId: memberId,
        teamId: null,
        createdAt: now,
      })
    }
    for (const teamId of input.access.teamIds) {
      await tx.insert(SkillHubMemberTable).values({
        id: createDenTypeId("skillHubMember"),
        skillHubId: hub.id,
        orgMembershipId: null,
        teamId,
        createdAt: now,
      })
    }
  } else {
    await tx.insert(SkillHubMemberTable).values({
      id: createDenTypeId("skillHubMember"),
      skillHubId: hub.id,
      orgMembershipId: input.actorMemberId,
      teamId: null,
      createdAt: now,
    })
  }
}

export async function saveCompanySkill(input: {
  access: CompanySkillAccess
  actorIsAdmin: boolean
  actorMemberId: MemberId
  bundle: ParsedSkillZipItem
  organizationId: SkillRow["organizationId"]
  overwrite: boolean
}) {
  return db.transaction(async (tx) => {
    const access = await validateAccessTargets(tx, {
      access: input.access,
      organizationId: input.organizationId,
    })
    const existing = await findExistingSkill(tx, {
      organizationId: input.organizationId,
      slug: input.bundle.slug,
    })
    const sourceKey = sourceKeyForSlug(input.bundle.slug)
    const shared = input.access.orgWide ? "org" as const : null
    const now = new Date()

    let action: CompanySkillSaveAction
    let skillId: SkillId
    if (existing) {
      const canManage = input.actorIsAdmin || existing.createdByOrgMembershipId === input.actorMemberId
      const contentChanged = existing.bundleHash !== input.bundle.bundleHash
        || existing.skillText !== input.bundle.skillText
      const accessChanged = existing.shared !== shared
      if ((contentChanged || accessChanged) && !canManage) {
        throw new CompanySkillStoreError(403, "skill_forbidden", "同名公司技能已存在，只有原创建者或管理员可以更新。")
      }
      if (contentChanged && !input.overwrite) {
        throw new CompanySkillStoreError(409, "skill_already_exists", "同名技能已存在且内容不同，请确认覆盖后重试。")
      }
      skillId = existing.id
      action = contentChanged || accessChanged || !existing.sourceKey ? "updated" : "unchanged"
      if (action !== "unchanged") {
        await tx.update(SkillTable).set({
          bundleFilesJson: input.bundle.files,
          bundleHash: input.bundle.bundleHash,
          description: input.bundle.description,
          shared,
          skillText: input.bundle.skillText,
          slug: input.bundle.slug,
          sourceKey,
          title: input.bundle.title,
          updatedAt: now,
        }).where(eq(SkillTable.id, existing.id))
      }
    } else {
      skillId = createDenTypeId("skill")
      action = "created"
      await tx.insert(SkillTable).values({
        id: skillId,
        organizationId: input.organizationId,
        createdByOrgMembershipId: input.actorMemberId,
        title: input.bundle.title,
        description: input.bundle.description,
        skillText: input.bundle.skillText,
        slug: input.bundle.slug,
        sourceKey,
        bundleHash: input.bundle.bundleHash,
        bundleFilesJson: input.bundle.files,
        shared,
        createdAt: now,
        updatedAt: now,
      })
    }

    await replaceManagedHubAccess(tx, {
      access: { ...input.access, ...access },
      actorMemberId: input.actorMemberId,
      organizationId: input.organizationId,
      skillId,
      slug: input.bundle.slug,
    })

    const row = (await tx.select().from(SkillTable).where(eq(SkillTable.id, skillId)).limit(1))[0]
    if (!row) {
      throw new CompanySkillStoreError(404, "skill_not_found", "技能保存后未能重新读取。")
    }
    return { action, row }
  })
}

export function singleFileCompanySkill(skillText: string) {
  return validateCompanySkillBundleFiles("skill", [{ path: "SKILL.md", contents: skillText }])
}
