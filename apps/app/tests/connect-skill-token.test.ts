import { describe, expect, test } from "bun:test";

import {
  connectSkillPrompt,
  encodeConnectSkillToken,
  parseConnectSkillToken,
} from "@/react-app/domains/session/surface/composer/connect-skill-token";

describe("connect skill token", () => {
  const token = {
    slug: "daytona-chrome-cdp",
    name: "Daytona Chrome CDP",
    marketplace: "Engineering Marketplace",
    capability: "plugin:plg_01kx4t4h2aendr697p964fsg15:cob_01kx4t4hzjendr69kfjprv2wz6",
  };

  test("round-trips through the draft text token", () => {
    const encoded = encodeConnectSkillToken(token);
    expect(encoded.startsWith("[connect-skill ")).toBe(true);
    expect(encoded.endsWith("]")).toBe(true);
    expect(parseConnectSkillToken(encoded)).toEqual(token);
  });

  test("escapes separator and bracket characters in fields", () => {
    const tricky = { ...token, name: "A|B ] C % D", marketplace: "M|]%" };
    const encoded = encodeConnectSkillToken(tricky);
    expect(parseConnectSkillToken(encoded)).toEqual(tricky);
  });

  test("rejects non-token segments", () => {
    expect(parseConnectSkillToken("[skill fraimz]")).toBeNull();
    expect(parseConnectSkillToken("[connect-skill only|two]")).toBeNull();
    expect(parseConnectSkillToken("plain text")).toBeNull();
  });

  test("发送前会展开为完整的公司 Skill 提示", () => {
    const prompt = connectSkillPrompt(token);
    expect(prompt).toContain(`“${token.name}”Skill`);
    expect(prompt).toContain(`“${token.marketplace}”能力市场`);
    expect(prompt).toContain("foxwork-company_search_capabilities");
    expect(prompt).toContain("foxwork-company_execute_capability");
    expect(prompt).toContain(token.capability);
  });
});
