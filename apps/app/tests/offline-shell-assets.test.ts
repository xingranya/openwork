import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const coreOfflineSurfaces = [
  "../src/react-app/domains/onboarding/welcome-page.tsx",
  "../src/react-app/domains/cloud/den-signin-surface.tsx",
  "../src/react-app/domains/session/chat/session-page.tsx",
];

describe("offline shell assets", () => {
  test("核心桌面界面不依赖外部图标 CDN", () => {
    for (const relativePath of coreOfflineSurfaces) {
      const sourcePath = fileURLToPath(new URL(relativePath, import.meta.url));
      const source = readFileSync(sourcePath, "utf8");
      expect(source).not.toContain("cdn.simpleicons.org");
    }
  });
});
