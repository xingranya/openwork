import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const typesPackageUrl = new URL("../../../packages/types/package.json", import.meta.url);

test("桌面正式包只加载 types 包构建后的 JavaScript", async () => {
  const packageJson = JSON.parse(await readFile(typesPackageUrl, "utf8"));
  const exportsMap = packageJson.exports ?? {};

  for (const [exportName, conditions] of Object.entries(exportsMap)) {
    assert.equal(typeof conditions, "object", `${exportName} 缺少条件导出`);
    assert.match(
      conditions.default,
      /^\.\/dist\/.+\.js$/,
      `${exportName} 的生产导出不得指向 TypeScript 源文件`,
    );
  }
});
