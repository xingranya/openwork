import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  BRAND_APP_IDENTIFIER,
  BRAND_APP_NAME,
  BRAND_PROTOCOL_SCHEME,
  isAcceptedDesktopDeepLink,
  migrateLegacyUserDataDirectory,
} from "./brand.mjs";

test("uses the Brand Project OS desktop identity", () => {
  assert.equal(BRAND_APP_NAME, "Brand Project OS");
  assert.equal(BRAND_APP_IDENTIFIER, "com.foxwork.brandprojectos");
  assert.equal(BRAND_PROTOCOL_SCHEME, "brandprojectos");
});

test("packages only the Brand Project OS identity without an upstream publisher", async () => {
  const builderConfig = await readFile(new URL("../electron-builder.yml", import.meta.url), "utf8");
  assert.match(builderConfig, /^appId: com\.foxwork\.brandprojectos$/m);
  assert.match(builderConfig, /^productName: Brand Project OS$/m);
  assert.match(builderConfig, /^\s+- brandprojectos$/m);
  assert.match(builderConfig, /^artifactName: brand-project-os-/m);
  assert.doesNotMatch(builderConfig, /^publish:/m);
  assert.doesNotMatch(builderConfig, /different-ai\/openwork/);
});

test("accepts the current deep link and legacy migration links", () => {
  assert.equal(isAcceptedDesktopDeepLink("brandprojectos://connect?token=test"), true);
  assert.equal(isAcceptedDesktopDeepLink("brandprojectos-dev://connect?token=test"), true);
  assert.equal(isAcceptedDesktopDeepLink("openwork://connect?token=test"), true);
  assert.equal(isAcceptedDesktopDeepLink("openwork-dev://connect?token=test"), true);
  assert.equal(isAcceptedDesktopDeepLink("https://example.com/connect"), false);
  assert.equal(isAcceptedDesktopDeepLink("not-a-url"), false);
});

test("copies only missing legacy data and leaves the source untouched", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "brand-project-os-migration-"));
  const sourcePath = path.join(root, "legacy");
  const destinationPath = path.join(root, "current");
  await mkdir(path.join(sourcePath, "nested"), { recursive: true });
  await mkdir(path.join(destinationPath, "nested"), { recursive: true });
  await writeFile(path.join(sourcePath, "settings.json"), "legacy-settings", "utf8");
  await writeFile(path.join(sourcePath, "nested", "missing.json"), "legacy-missing", "utf8");
  await writeFile(path.join(sourcePath, "nested", "existing.json"), "legacy-existing", "utf8");
  await writeFile(path.join(destinationPath, "nested", "existing.json"), "current-existing", "utf8");

  const result = await migrateLegacyUserDataDirectory({ sourcePath, destinationPath });

  assert.equal(result.migrated, true);
  assert.equal(result.copiedEntries, 2);
  assert.equal(await readFile(path.join(destinationPath, "settings.json"), "utf8"), "legacy-settings");
  assert.equal(await readFile(path.join(destinationPath, "nested", "missing.json"), "utf8"), "legacy-missing");
  assert.equal(await readFile(path.join(destinationPath, "nested", "existing.json"), "utf8"), "current-existing");
  assert.equal(await readFile(path.join(sourcePath, "nested", "existing.json"), "utf8"), "legacy-existing");
});

test("does nothing when no legacy directory exists", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "brand-project-os-migration-empty-"));
  const result = await migrateLegacyUserDataDirectory({
    sourcePath: path.join(root, "missing"),
    destinationPath: path.join(root, "current"),
  });
  assert.deepEqual(result, { migrated: false, copiedEntries: 0 });
});
