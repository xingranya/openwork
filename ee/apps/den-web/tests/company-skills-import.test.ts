import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  buildCompanySkillImportForm,
  formatCompanySkillImportAction,
  parseCompanySkillImportPayload,
  parseCompanySkillsPayload,
} from "../app/(den)/dashboard/_components/company-skills-data";

describe("公司技能批量导入数据契约", () => {
  test("解析公司技能列表并忽略不完整记录", () => {
    const skillText = "---\nname: evidence-review\n---\n\n审查项目证据。";
    expect(parseCompanySkillsPayload({
      items: [
        {
          id: "cob_1",
          objectType: "skill",
          currentRelativePath: "company-skills/evidence-review/SKILL.md",
          title: "evidence-review",
          description: "审查项目证据",
          latestVersion: {
            rawSourceText: skillText,
            normalizedPayloadJson: {
              foxworkSkillBundle: {
                version: 1,
                files: [{ path: "SKILL.md", contents: skillText }],
                bundleHash: "a".repeat(64),
                shared: "org",
              },
            },
          },
          updatedAt: "2026-07-27T00:00:00.000Z",
        },
        {
          id: "cob_upstream",
          objectType: "skill",
          currentRelativePath: "skills/upstream/SKILL.md",
          title: "普通上游技能",
          latestVersion: { rawSourceText: skillText, normalizedPayloadJson: null },
        },
      ],
    })).toEqual([
      expect.objectContaining({
        id: "cob_1",
        slug: "evidence-review",
        fileCount: 1,
        orgWide: true,
      }),
    ]);
  });

  test("构建 ZIP、覆盖选项和成员团队范围表单", () => {
    const archive = new File(["zip"], "skills.zip", { type: "application/zip" });
    const form = buildCompanySkillImportForm({
      archive,
      memberIds: ["member_1", "member_1"],
      orgWide: false,
      overwrite: true,
      teamIds: ["team_1"],
    });

    expect(form.get("archive")).toMatchObject({
      name: "skills.zip",
      size: 3,
      type: "application/zip",
    });
    expect(form.get("orgWide")).toBe("false");
    expect(form.get("overwrite")).toBe("true");
    expect(form.get("memberIds")).toBe('["member_1"]');
    expect(form.get("teamIds")).toBe('["team_1"]');
  });

  test("保留每个技能的成功、未变化和失败原因", () => {
    expect(parseCompanySkillImportPayload({
      results: [
        { action: "created", folder: "new", slug: "new", fileCount: 2, bundleHash: "a".repeat(64), id: "cob_1", pluginId: "plg_1" },
        { action: "unchanged", folder: "same", slug: "same", fileCount: 1, bundleHash: "b".repeat(64), id: "cob_2", pluginId: "plg_2" },
      ],
      failures: [
        { folder: "broken", code: "skill_entrypoint_missing", reason: "缺少 SKILL.md。" },
      ],
    })).toEqual({
      results: [
        expect.objectContaining({ action: "created", folder: "new", slug: "new" }),
        expect.objectContaining({ action: "unchanged", folder: "same", slug: "same" }),
      ],
      failures: [
        { folder: "broken", code: "skill_entrypoint_missing", reason: "缺少 SKILL.md。", slug: null },
      ],
    });
    expect(formatCompanySkillImportAction("created")).toBe("已新建");
    expect(formatCompanySkillImportAction("updated")).toBe("已更新");
    expect(formatCompanySkillImportAction("unchanged")).toBe("未变化");
  });
});

describe("公司技能后台入口", () => {
  const panelSource = readFileSync(
    fileURLToPath(new URL("../app/(den)/dashboard/_components/company-skills-panel.tsx", import.meta.url)),
    "utf8",
  );
  const pluginsSource = readFileSync(
    fileURLToPath(new URL("../app/(den)/dashboard/_components/plugins-screen.tsx", import.meta.url)),
    "utf8",
  );
  const dataSource = readFileSync(
    fileURLToPath(new URL("../app/(den)/dashboard/_components/company-skills-data.ts", import.meta.url)),
    "utf8",
  );

  test("技能页提供 ZIP、分发范围、覆盖确认和逐项结果", () => {
    expect(panelSource).toContain("批量导入公司技能");
    expect(panelSource).toContain("每个一级文件夹代表一个技能");
    expect(panelSource).toContain("全公司成员");
    expect(panelSource).toContain("指定成员或团队");
    expect(panelSource).toContain("覆盖同名技能");
    expect(panelSource).toContain("失败原因");
  });

  test("现有插件技能列表与公司技能面板同时保留", () => {
    expect(pluginsSource).toContain("<CompanySkillsPanel");
    expect(pluginsSource).toContain("插件提供的技能会显示在这里。");
  });

  test("公司技能使用上游 ConfigObject 列表和插件 ZIP 导入端点", () => {
    expect(dataSource).toContain("/v1/config-objects?type=skill&status=active&limit=100");
    expect(dataSource).toContain("/v1/plugins/import-skills-zip");
    expect(dataSource).not.toContain('requestJson("/v1/skills"');
  });
});
