import { describe, expect, test } from "bun:test";

import { createOpenworkServerClient } from "../src/app/lib/openwork-server";

describe("在线技能客户端契约", () => {
  test("不再暴露旧 GitHub Skill Hub，并保留 Den 目录安装接口", () => {
    const client = createOpenworkServerClient({ baseUrl: "http://127.0.0.1:1" });

    expect("listHubSkills" in client).toBe(false);
    expect("installHubSkill" in client).toBe(false);
    expect(typeof client.installCatalogSkill).toBe("function");
  });
});
