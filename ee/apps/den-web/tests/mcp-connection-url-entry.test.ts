import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const screenPath = fileURLToPath(
  new URL("../app/(den)/dashboard/_components/mcp-connections-screen.tsx", import.meta.url),
);

describe("MCP URL entry UI contract", () => {
  test("默认打开完整的远程 HTTP MCP 配置向导", () => {
    const screen = readFileSync(screenPath, "utf8");

    expect(screen).toContain('useState<"smart" | "advanced">("advanced")');
    expect(screen).toContain('setView("advanced")');
    expect(screen).toContain("添加自定义 MCP 服务");
    expect(screen).toContain("连接类型");
    expect(screen).toContain("远程 HTTP（Streamable HTTP）");
    expect(screen).toContain("公司服务器只连接远程 MCP 服务，不会运行本地命令。");
    expect(screen).toContain("连接说明");
    expect(screen).toContain('placeholder="说明这个连接提供什么能力，以及适合哪些工作场景"');
    expect(screen).toContain('placeholder="https://mcp.example.com/mcp"');
    expect(screen).toContain("正在测试连接...");
    expect(screen).toContain("连接测试通过");
    expect(screen).toContain("重新测试");
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

  test("创建和编辑都会提交连接说明", () => {
    const screen = readFileSync(screenPath, "utf8");

    expect(screen).toContain('const [description, setDescription] = useState("")');
    expect(screen).toContain("description: description.trim()");
    expect(screen).toContain("setDescription(connection.description ?? \"\")");
    expect(screen).toContain('data-testid="edit-mcp-description"');
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
