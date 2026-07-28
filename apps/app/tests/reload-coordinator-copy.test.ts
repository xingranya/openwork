import { describe, expect, test } from "bun:test";

import {
  describeAppliedReloadTrigger,
  describeReloadTrigger,
} from "../src/react-app/shell/reload-coordinator";

describe("运行环境重新连接提示", () => {
  test("不向员工暴露内部运行配置文件名或英文重载指令", () => {
    const message = describeReloadTrigger("", {
      type: "config",
      name: "runtime-opencode-config.json",
      action: "updated",
    });

    expect(message).toBe("模型和工具配置已更新，正在重新连接。");
    expect(message).not.toContain("runtime-opencode-config.json");
    expect(message).not.toContain("Reload");
  });

  test("自动重连完成后以中文确认生效", () => {
    expect(describeAppliedReloadTrigger({
      type: "mcp",
      name: "foxwork-company",
      action: "updated",
    })).toBe("MCP“foxwork-company”已经生效。");
  });
});
