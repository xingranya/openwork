import { describe, expect, test } from "bun:test"

import { serializeSkillCapabilityBundle } from "../src/mcp/skill-capability-bundle.js"

describe("MCP 公司技能文件包", () => {
  test("从 ConfigObjectVersion 返回完整多文件包和已存摘要", () => {
    const files = [
      { path: "SKILL.md", contents: "---\nname: research\n---\n\n执行研究。" },
      { path: "references/checklist.md", contents: "# 检查表" },
    ]
    expect(serializeSkillCapabilityBundle({
      normalizedPayloadJson: {
        foxworkSkillBundle: {
          version: 1,
          bundleHash: "2242bfeebebb3edf1d747dc0333ff9471c05a5b066fb71b0fcba37e4368dfc0d",
          files,
          shared: "org",
        },
      },
      rawSourceText: files[0]!.contents,
    })).toEqual({
      bundleHash: "2242bfeebebb3edf1d747dc0333ff9471c05a5b066fb71b0fcba37e4368dfc0d",
      files,
      shared: "org",
      skillText: files[0]!.contents,
    })
  })

  test("摘要或入口正文不一致时拒绝损坏的公司技能载荷", () => {
    expect(serializeSkillCapabilityBundle({
      normalizedPayloadJson: {
        foxworkSkillBundle: {
          version: 1,
          bundleHash: "0".repeat(64),
          files: [{ path: "SKILL.md", contents: "---\nname: broken\n---\n\n损坏。" }],
          shared: "private",
        },
      },
      rawSourceText: "---\nname: broken\n---\n\n正文不同。",
    })).toBeNull()
  })

  test("普通上游 Skill ConfigObject 不伪装成公司完整文件包", () => {
    expect(serializeSkillCapabilityBundle({
      normalizedPayloadJson: null,
      rawSourceText: "---\nname: upstream\n---\n\n普通技能。",
    })).toBeNull()
  })
})
