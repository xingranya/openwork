import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createDesktopUserHome } from "./desktop-user-home.mjs";

test("开发运行时改写 HOME 后仍读取真实用户的全局 Skill", () => {
  const actualHome = os.homedir();
  const desktopUserHome = createDesktopUserHome(actualHome);
  const previousHome = process.env.HOME;

  try {
    process.env.HOME = "/tmp/foxwork-isolated-home";

    assert.equal(desktopUserHome.homeDir, actualHome);
    assert.deepEqual(
      desktopUserHome.globalSkillRoots("/tmp/opencode"),
      [
        "/tmp/opencode/skills",
        path.join(actualHome, ".claude", "skills"),
        path.join(actualHome, ".agents", "skills"),
        path.join(actualHome, ".agent", "skills"),
      ],
    );
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
  }
});
