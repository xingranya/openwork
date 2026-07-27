import { describe, expect, test } from "bun:test"

import { serializeSkillCapabilityBundle } from "../src/mcp/skill-capability-bundle.js"

describe("MCP 公司技能文件包", () => {
  test("返回完整多文件包和已存摘要", () => {
    const files = [
      { path: "SKILL.md", contents: "---\nname: research\n---\n\n执行研究。" },
      { path: "references/checklist.md", contents: "# 检查表" },
    ]
    expect(serializeSkillCapabilityBundle({
      bundleFilesJson: files,
      bundleHash: "2242bfeebebb3edf1d747dc0333ff9471c05a5b066fb71b0fcba37e4368dfc0d",
      skillText: files[0]!.contents,
    })).toEqual({
      bundleHash: "2242bfeebebb3edf1d747dc0333ff9471c05a5b066fb71b0fcba37e4368dfc0d",
      files,
      skillText: files[0]!.contents,
    })
  })

  test("旧单文件技能自动补成文件包并生成摘要", () => {
    const skillText = "---\nname: legacy\n---\n\n旧技能。"
    const result = serializeSkillCapabilityBundle({
      bundleFilesJson: null,
      bundleHash: null,
      skillText,
    })

    expect(result.files).toEqual([{ path: "SKILL.md", contents: skillText }])
    expect(result.bundleHash).toMatch(/^[a-f0-9]{64}$/u)
  })
})
