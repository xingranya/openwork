import { describe, expect, test } from "bun:test";

import {
  getSettingsTabLabel,
  getWorkspaceSettingsTabs,
} from "../src/react-app/domains/settings/shell/settings-page";
import { parseSettingsPath } from "../src/react-app/shell/settings-route";

describe("settings route parsing", () => {
  test("recognizes the Connect settings tab", () => {
    expect(parseSettingsPath("/settings/connect")).toEqual({ tab: "connect", redirectPath: null });
    expect(parseSettingsPath("/workspace/workspace_1/settings/connect")).toEqual({
      tab: "connect",
      redirectPath: null,
    });
  });

  test("在线技能入口进入技能页而不是设置首页", () => {
    expect(parseSettingsPath("/settings/skills")).toEqual({ tab: "skills", redirectPath: null });
    expect(parseSettingsPath("/workspace/workspace_1/settings/skills")).toEqual({
      tab: "skills",
      redirectPath: null,
    });
    expect(parseSettingsPath("/settings/extensions/skills")).toEqual({
      tab: "skills",
      redirectPath: "skills",
    });
  });

  test("Skills 在工作区设置中独立显示并位于扩展上方", () => {
    expect(getWorkspaceSettingsTabs()).toEqual([
      "preferences",
      "permissions",
      "skills",
      "extensions",
      "advanced",
    ]);
    expect(getSettingsTabLabel("skills")).toBe("技能");
  });
});
