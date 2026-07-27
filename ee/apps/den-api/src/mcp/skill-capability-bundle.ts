import { computeCompanySkillBundleHash } from "../routes/org/skill-zip-import.js"

type SkillCapabilityBundleRow = {
  bundleFilesJson: Array<{ path: string; contents: string }> | null
  bundleHash: string | null
  skillText: string
}

export function serializeSkillCapabilityBundle(row: SkillCapabilityBundleRow) {
  const storedFiles = Array.isArray(row.bundleFilesJson) && row.bundleFilesJson.length > 0
    ? row.bundleFilesJson
    : [{ path: "SKILL.md", contents: row.skillText }]
  const files = storedFiles.map((file) => (
    file.path === "SKILL.md" ? { ...file, contents: row.skillText } : file
  ))
  const computedHash = computeCompanySkillBundleHash(files)
  return {
    bundleHash: row.bundleHash === computedHash ? row.bundleHash : computedHash,
    files,
    skillText: row.skillText,
  }
}
