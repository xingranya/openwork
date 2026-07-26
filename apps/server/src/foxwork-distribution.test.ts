import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const packageMetadata = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as Record<string, unknown>;
const embeddedSource = readFileSync(new URL("./embedded.ts", import.meta.url), "utf8");
const diagnosticsProbeSource = readFileSync(
  new URL("./agent-context-cloud-probe.ts", import.meta.url),
  "utf8",
);

describe("FoxWork 服务发行边界", () => {
  test("安装包元数据不指向上游仓库或公开发布渠道", () => {
    expect(packageMetadata.description).toBe("FoxWork 本机运行与远程工作区服务");
    expect(packageMetadata.author).toEqual({ name: "Fox" });
    expect(packageMetadata).not.toHaveProperty("repository");
    expect(packageMetadata).not.toHaveProperty("homepage");
    expect(packageMetadata).not.toHaveProperty("bugs");
    expect(packageMetadata).not.toHaveProperty("publishConfig");
  });

  test("模型代理和诊断目标必须由公司显式配置", () => {
    expect(embeddedSource).toContain("OPENWORK_MODELS_BASE_URL");
    expect(embeddedSource).not.toContain("models.openworklabs.com");
    expect(diagnosticsProbeSource).toContain("OPENWORK_AGENT_DIAGNOSTICS_TRUSTED_ORIGINS");
    expect(diagnosticsProbeSource).not.toContain("openworklabs.com");
  });
});
