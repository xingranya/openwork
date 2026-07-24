import { describe, expect, test } from "bun:test";

import { formatConnectionCreatorAttribution } from "../app/(den)/dashboard/_components/mcp-connection-display";

describe("MCP connection display helpers", () => {
  test("formats safe creator attribution when an admin manages connections", () => {
    expect(formatConnectionCreatorAttribution("Alex Admin")).toBe("由 Alex Admin 添加");
    expect(formatConnectionCreatorAttribution("  Alex Admin  ")).toBe("由 Alex Admin 添加");
  });

  test("omits creator attribution when the API has no safe display name", () => {
    expect(formatConnectionCreatorAttribution(null)).toBeNull();
    expect(formatConnectionCreatorAttribution("   ")).toBeNull();
  });
});
