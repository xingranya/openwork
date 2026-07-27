import { describe, expect, test } from "bun:test"
import { strToU8, zipSync } from "fflate"

import { parseSkillZipArchive, SkillZipArchiveError } from "../src/routes/org/skill-zip-import.js"

function archive(files: Record<string, string>) {
  return zipSync(Object.fromEntries(
    Object.entries(files).map(([path, contents]) => [path, strToU8(contents)]),
  ))
}

describe("公司技能 ZIP 导入", () => {
  test("识别多个一级技能目录并保留每个技能的配套文件", () => {
    const parsed = parseSkillZipArchive(archive({
      "officecli/SKILL.md": [
        "---",
        "name: officecli",
        "description: 处理 Office 文档",
        "---",
        "",
        "按要求处理文档。",
      ].join("\n"),
      "officecli/references/checklist.md": "# 检查表",
      "research/SKILL.md": [
        "---",
        "name: research",
        "description: 调研并整理证据",
        "---",
        "",
        "先核对来源。",
      ].join("\n"),
      "research/scripts/collect.ts": "export const collect = () => true\n",
    }))

    expect(parsed.failures).toEqual([])
    expect(parsed.skills.map((skill) => skill.slug)).toEqual(["officecli", "research"])
    expect(parsed.skills[0]?.files).toEqual([
      expect.objectContaining({ path: "SKILL.md" }),
      { path: "references/checklist.md", contents: "# 检查表" },
    ])
    expect(parsed.skills[0]?.bundleHash).toMatch(/^[a-f0-9]{64}$/)
  })

  test("单个技能无效时保留其他有效技能并明确返回失败原因", () => {
    const parsed = parseSkillZipArchive(archive({
      "valid/SKILL.md": "---\nname: valid\ndescription: 可用技能\n---\n\n执行。\n",
      "broken/README.md": "缺少入口文件",
    }))

    expect(parsed.skills.map((skill) => skill.slug)).toEqual(["valid"])
    expect(parsed.failures).toEqual([
      {
        folder: "broken",
        code: "skill_entrypoint_missing",
        reason: "缺少 SKILL.md。",
      },
    ])
  })

  test("拒绝路径穿越、符号链接和二进制文件", () => {
    expect(() => parseSkillZipArchive(archive({
      "../outside/SKILL.md": "---\nname: outside\ndescription: 越界\n---\n",
    }))).toThrow(SkillZipArchiveError)

    expect(() => parseSkillZipArchive(archive({
      "unsafe/SKILL.md": "---\nname: unsafe\ndescription: 不安全\n---\n",
      "unsafe/tool.bin": "\u0000\u0001\u0002",
    }))).toThrow("包含不支持的二进制文件")
  })

  test("拒绝超过解压上限的压缩包", () => {
    const oversized = "x".repeat(8 * 1024 * 1024 + 1)
    expect(() => parseSkillZipArchive(archive({
      "large/SKILL.md": "---\nname: large\ndescription: 过大\n---\n",
      "large/references/data.txt": oversized,
    }))).toThrow("解压后的文件总量超过 8 MB")
  })
})
