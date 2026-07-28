import {
  validateCompanySkillBundleFiles,
  type ParsedSkillZipItem,
} from "./skill-zip-import.js"

export const COMPANY_SKILL_BUNDLE_SCHEMA_VERSION = "foxwork.skill-bundle.v1"
const COMPANY_SKILL_PATH_PREFIX = "company-skills/"

type CompanySkillVersionRow = {
  normalizedPayloadJson: Record<string, unknown> | null
  rawSourceText: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function companySkillRelativePath(slug: string) {
  return `${COMPANY_SKILL_PATH_PREFIX}${slug}/SKILL.md`
}

export function companySkillSlugFromRelativePath(value: string | null) {
  if (!value?.startsWith(COMPANY_SKILL_PATH_PREFIX) || !value.endsWith("/SKILL.md")) {
    return null
  }
  const slug = value.slice(COMPANY_SKILL_PATH_PREFIX.length, -"/SKILL.md".length)
  return /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/u.test(slug) ? slug : null
}

export function buildCompanySkillVersionPayload(
  bundle: ParsedSkillZipItem,
  shared: "org" | "private",
) {
  return {
    foxworkSkillBundle: {
      version: 1,
      bundleHash: bundle.bundleHash,
      files: bundle.files,
      shared,
    },
  }
}

export function parseCompanySkillVersionPayload(row: CompanySkillVersionRow) {
  const payload = row.normalizedPayloadJson?.foxworkSkillBundle
  if (!isRecord(payload) || payload.version !== 1 || !Array.isArray(payload.files)) {
    return null
  }
  if (
    typeof payload.bundleHash !== "string"
    || !/^[a-f0-9]{64}$/u.test(payload.bundleHash)
    || (payload.shared !== "org" && payload.shared !== "private")
    || typeof row.rawSourceText !== "string"
  ) {
    return null
  }

  const files = payload.files.flatMap((file) => {
    if (!isRecord(file) || typeof file.path !== "string" || typeof file.contents !== "string") {
      return []
    }
    return [{ path: file.path, contents: file.contents }]
  })
  if (files.length !== payload.files.length) return null

  try {
    const bundle = validateCompanySkillBundleFiles("company-skill", files)
    if (bundle.bundleHash !== payload.bundleHash || bundle.skillText !== row.rawSourceText) {
      return null
    }
    return {
      bundleHash: bundle.bundleHash,
      description: bundle.description,
      files: bundle.files,
      shared: payload.shared,
      slug: bundle.slug,
      skillText: bundle.skillText,
      title: bundle.title,
    }
  } catch {
    return null
  }
}
