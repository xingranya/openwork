import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const screenPath = fileURLToPath(
  new URL("../app/(den)/dashboard/_components/mcp-connections-screen.tsx", import.meta.url),
);

describe("MCP URL entry UI contract", () => {
  test("opens the generic MCP dialog directly on URL discovery", () => {
    const screen = readFileSync(screenPath, "utf8");

    expect(screen).toContain('useState<"smart" | "advanced">(preset ? "advanced" : "smart")');
    expect(screen).toContain("添加 MCP 服务");
    expect(screen).toContain("粘贴 MCP 服务地址");
    expect(screen).toContain("自动识别并检查认证要求");
    expect(screen).toContain('placeholder="https://mcp.example.com/mcp"');
    expect(screen).toContain('if (kind !== "url" && kind !== "domain")');
    expect(screen).not.toContain('data-testid="select-custom-mcp"');
    expect(screen).not.toContain('data-testid="mcp-service-picker"');
    expect(screen).not.toContain('aria-label="Filter services"');
    expect(screen).not.toContain('placeholder="Search services"');
    expect(screen).not.toContain("or just type a name");
  });

  test("keeps preset quick-add setup separate from the generic URL flow", () => {
    const screen = readFileSync(screenPath, "utf8");

    expect(screen).toContain("setFormPreset(preset);");
    expect(screen).toContain("{preset ? `添加 ${preset.displayName}` : \"添加自定义 MCP 服务\"}");
    expect(screen).toContain("disabled={Boolean(preset)}");
    expect(screen).not.toContain("existingConnectionUrls");
    expect(screen).not.toContain("onSelectPreset");
  });

  test("offers one compact bulk control for long optional permission lists", () => {
    const screen = readFileSync(screenPath, "utf8");

    expect(screen).toContain("optionalScopes.length > OPTIONAL_SCOPE_BULK_TOGGLE_THRESHOLD");
    expect(screen).toContain('role="checkbox"');
    expect(screen).toContain('"mixed"');
    expect(screen).toContain('"取消全选" : "全选"');
    expect(screen).toContain('data-testid="toggle-all-optional-permissions"');
    expect(screen).toContain("toggleAllOptionalScopes(current, optionalScopes)");
  });
});
