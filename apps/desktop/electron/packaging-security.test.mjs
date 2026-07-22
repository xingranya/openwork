import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

async function source(relativeUrl) {
  return readFile(new URL(relativeUrl, import.meta.url), "utf8");
}

describe("offline desktop packaging", () => {
  it("forces macOS ATS and removes unrelated privacy declarations", async () => {
    const afterPack = await source("../scripts/electron-after-pack.cjs");
    const afterSign = await source("../scripts/electron-after-sign.cjs");
    assert.match(afterPack, /NSAllowsArbitraryLoads:\s*false/);
    assert.match(afterPack, /NSAllowsLocalNetworking:\s*true/);
    assert.match(afterPack, /NSCameraUsageDescription/);
    assert.match(afterPack, /Brand Project OS Computer Use\.app/);
    assert.match(afterSign, /Brand Project OS Computer Use\.app/);
    assert.doesNotMatch(`${afterPack}\n${afterSign}`, /OpenWork Computer Use\.app/);
  });

  it("does not package upstream docs, tests, or cloud knowledge", async () => {
    const builder = await source("../electron-builder.yml");
    const buildScript = await source("../scripts/electron-build.mjs");
    const runtimeConfig = await source("../../server/src/openwork-runtime-config.ts");
    assert.doesNotMatch(builder, /openwork-docs/);
    assert.match(builder, /!electron\/\*\*\/\*\.test\.mjs/);
    assert.match(builder, /!electron\/\*\*\/\*\.test\.cjs/);
    assert.match(builder, /!\*\.test\.js/);
    assert.match(builder, /!openwork-capabilities-knowledge\.js/);
    assert.match(buildScript, /removeCompiledTests/);
    assert.doesNotMatch(runtimeConfig, /openworkCapabilitiesKnowledgePluginPath/);
  });

  it("requires explicit cloud and sidecar download origins", async () => {
    const orchestrator = await source("../../orchestrator/src/cli.ts");
    const cloudProbe = await source("../../server/src/agent-context-cloud-probe.ts");
    const viteConfig = await source("../../app/vite.config.ts");
    const commandPalette = await source("../../app/src/react-app/shell/command-palette.tsx");
    const statusBar = await source("../../app/src/react-app/domains/session/chat/status-bar.tsx");
    const managedModels = await source("../../server/src/managed-models.ts");
    assert.doesNotMatch(orchestrator, /github\.com\/different-ai\/openwork\/releases/);
    assert.match(orchestrator, /OPENWORK_SIDECAR_BASE_URL/);
    assert.match(cloudProbe, /DEFAULT_TRUSTED_ORIGINS = new Set<string>\(\)/);
    assert.doesNotMatch(cloudProbe, /https:\/\/app\.openworklabs\.com/);
    assert.match(viteConfig, /OPENWORK_INCLUDE_MIGRATION_RELEASE/);
    assert.doesNotMatch(commandPalette, /openwork\.dev\/(?:docs|feedback)/);
    assert.doesNotMatch(statusBar, /openworklabs\.com\/(?:docs|feedback)/);
    assert.match(managedModels, /OPENCODE_DISABLE_MODELS_FETCH:\s*modelsUrl \? undefined : "1"/);
  });
});
