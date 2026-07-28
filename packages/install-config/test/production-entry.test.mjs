import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageUrl = new URL("../package.json", import.meta.url);

test("生产入口加载已编译的 JavaScript", async () => {
  const manifest = JSON.parse(await readFile(packageUrl, "utf8"));

  assert.equal(manifest.exports?.["."]?.default, "./dist/index.js");
  assert.equal(manifest.exports?.["."]?.development, "./src/index.ts");

  const runtime = await import("@openwork/install-config");
  assert.equal(typeof runtime.installConfigSchema?.parse, "function");
});
