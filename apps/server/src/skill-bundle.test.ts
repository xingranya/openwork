import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { computeSkillBundleHash, installSkillBundle } from "./skill-bundle.js";

async function withWorkspace(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "foxwork-skill-bundle-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("在线技能文件包安装", () => {
  test("完整写入 SKILL.md 和配套文件并校验摘要", async () => {
    await withWorkspace(async (root) => {
      const files = [
        { path: "SKILL.md", contents: "---\nname: research\ndescription: 研究资料\n---\n\n执行研究。" },
        { path: "references/checklist.md", contents: "# 检查表" },
      ];
      const result = await installSkillBundle(root, {
        name: "research",
        sourceId: "fox/skills/research",
        sourceHash: "a".repeat(64),
        bundleHash: computeSkillBundleHash(files),
        files,
      });

      expect(result.action).toBe("added");
      expect(result.written).toBe(2);
      expect(await readFile(join(root, ".opencode", "skills", "research", "references", "checklist.md"), "utf8"))
        .toBe("# 检查表");
    });
  });

  test("拒绝路径穿越、缺少入口和传输后摘要不一致", async () => {
    await withWorkspace(async (root) => {
      const unsafe = [{ path: "../outside.txt", contents: "no" }];
      await expect(installSkillBundle(root, {
        name: "unsafe",
        sourceId: "fox/skills/unsafe",
        bundleHash: computeSkillBundleHash(unsafe),
        files: unsafe,
      })).rejects.toThrow("路径不安全");

      const missingEntry = [{ path: "README.md", contents: "read me" }];
      await expect(installSkillBundle(root, {
        name: "missing-entry",
        sourceId: "fox/skills/missing-entry",
        bundleHash: computeSkillBundleHash(missingEntry),
        files: missingEntry,
      })).rejects.toThrow("缺少有效的 SKILL.md");

      await expect(installSkillBundle(root, {
        name: "changed",
        sourceId: "fox/skills/changed",
        bundleHash: "0".repeat(64),
        files: [{ path: "SKILL.md", contents: "changed" }],
      })).rejects.toThrow("校验失败");
    });
  });
});
