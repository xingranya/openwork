import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("../app/(den)/dashboard/_components/your-connections-screen.tsx", import.meta.url)),
  "utf8",
);

describe("我的连接管理员入口", () => {
  test("管理员读取完整连接列表并能从空态进入添加页", () => {
    expect(source).toContain('access.isAdmin ? "manageable" : "usable"');
    expect(source).toContain('href="/dashboard/mcp-connections"');
    expect(source).toContain("添加公司连接");
  });

  test("普通成员仍只看到联系管理员的提示", () => {
    expect(source).toContain("请联系公司管理员添加 MCP 连接");
  });
});
