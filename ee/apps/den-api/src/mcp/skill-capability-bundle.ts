import { parseCompanySkillVersionPayload } from "../routes/org/company-skill-bundle.js"

type SkillCapabilityBundleRow = {
  normalizedPayloadJson: Record<string, unknown> | null
  rawSourceText: string | null
}

export type SkillCapabilityBundle = {
  bundleHash: string
  files: Array<{ path: string; contents: string }>
  shared: "org" | "private"
  skillText: string
}

export function serializeSkillCapabilityBundle(row: SkillCapabilityBundleRow): SkillCapabilityBundle | null {
  const bundle = parseCompanySkillVersionPayload(row)
  if (!bundle) return null

  return {
    bundleHash: bundle.bundleHash,
    files: bundle.files,
    shared: bundle.shared as SkillCapabilityBundle["shared"],
    skillText: bundle.skillText,
  }
}
