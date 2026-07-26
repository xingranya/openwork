import type { EnablementCondition, EnablementResult } from "./extensions";
import type { McpStatusMap } from "./types";

/** 检查启用条件所需的运行时上下文；缺少的字段按条件未满足处理。 */
export type EnablementContext = {
  /** 以服务名为键的 MCP 运行状态。 */
  mcpStatuses?: McpStatusMap;
  /** 已完成基础配置的 MCP 服务名集合。 */
  mcpConfigured?: Set<string>;
  /** 已加载的插件包名或路径片段。 */
  loadedPlugins?: Set<string>;
  /** 已连接的模型服务 ID。 */
  connectedProviders?: Set<string>;
  /** 已配置的环境变量名。 */
  configuredEnvKeys?: Set<string>;
  /** 电脑操作组件返回的权限检查结果。 */
  permissions?: { accessibility?: boolean; screenRecording?: boolean };
  /** 扩展开关状态读取函数。 */
  isToggleEnabled?: (ref: string) => boolean;
};

/** 根据运行时上下文检查单项启用条件。 */
function evaluateCondition(condition: EnablementCondition, ctx: EnablementContext): boolean {
  switch (condition.type) {
    case "mcp-connected": {
      const status = ctx.mcpStatuses?.[condition.ref];
      return status?.status === "connected";
    }
    case "plugin-loaded":
      return ctx.loadedPlugins?.has(condition.ref) === true;
    case "provider-connected":
      return ctx.connectedProviders?.has(condition.ref) === true;
    case "env-set":
      return ctx.configuredEnvKeys?.has(condition.ref) === true;
    case "permission-granted": {
      if (!ctx.permissions) return false;
      if (condition.ref === "accessibility") return ctx.permissions.accessibility === true;
      if (condition.ref === "screenRecording") return ctx.permissions.screenRecording === true;
      return false;
    }
    case "toggle-enabled":
      return ctx.isToggleEnabled?.(condition.ref) === true;
    default:
      return false;
  }
}

/** 检查扩展的全部启用条件，并返回逐项结果和整体可用状态。 */
export function evaluateEnablement(
  conditions: EnablementCondition[] | undefined,
  ctx: EnablementContext,
): { active: boolean; results: EnablementResult[] } {
  if (!conditions || conditions.length === 0) {
    return { active: false, results: [] };
  }
  const results = conditions.map((condition) => ({
    condition,
    met: evaluateCondition(condition, ctx),
  }));
  return {
    active: results.every((r) => r.met),
    results,
  };
}

/** 为没有扩展清单的普通 MCP 生成默认连接条件。 */
export function defaultMcpEnablement(serverName: string): EnablementCondition[] {
  return [{ type: "mcp-connected", ref: serverName, label: "MCP 服务已连接" }];
}
