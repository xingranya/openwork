/** @jsxImportSource react */
import {
  createContext,
  useCallback,
  use,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type {
  OpenworkAffordanceDescriptor,
  OpenworkAffordanceEffects,
  OpenworkAffordanceRequest,
  OpenworkAffordanceResult,
} from "@openwork/types/openwork-affordance";
import type { OpenworkContextSnapshot } from "@openwork/types/openwork-context";

export type OpenworkControlSideEffect = "none" | "navigation" | "mutation" | "external";

export type OpenworkControlActionArg = {
  name: string;
  type?: "string" | "number" | "boolean" | "object" | "array" | "unknown";
  required?: boolean;
  description?: string;
};

export type OpenworkControlActionMetadata = {
  id: string;
  label: string;
  description?: string;
  kind: "query" | "command";
  effects: OpenworkAffordanceEffects;
  sideEffect: OpenworkControlSideEffect;
  requiresConfirmation: boolean;
  requiresArgs: boolean;
  hasPreviewArgs: boolean;
  previewArgs?: unknown;
  args?: OpenworkControlActionArg[];
  disabled: boolean;
  busy: boolean;
};

export type OpenworkControlSnapshot = {
  version: number;
  enabled: boolean;
  route: string;
  status: "off" | "ready" | "acting";
  busyActionId: string | null;
  narration: string;
  actions: OpenworkControlActionMetadata[];
};

export type OpenworkControlResult =
  | { ok: true; actionId: string; result?: unknown }
  | { ok: false; actionId: string; error: string };

export type OpenworkControlHelpers = {
  setNarration: (text: string) => void;
};

export type OpenworkControlTargetRef = {
  readonly current: HTMLElement | null;
};

export type OpenworkControlAction = {
  id: string;
  label: string;
  description?: string;
  kind?: "query" | "command";
  effects?: OpenworkAffordanceEffects;
  sideEffect?: OpenworkControlSideEffect;
  requiresConfirmation?: boolean;
  requiresArgs?: boolean;
  args?: OpenworkControlActionArg[];
  previewArgs?: unknown;
  disabled?: boolean;
  targetRef?: OpenworkControlTargetRef;
  execute: (args: unknown, helpers: OpenworkControlHelpers) => unknown | Promise<unknown>;
};

type ControlActionRef = {
  readonly current: OpenworkControlAction | null;
};

type RegisteredAction = {
  id: string;
  order: number;
  token: symbol;
  ref: ControlActionRef;
};

type SpotlightState = {
  visible: boolean;
  phase: "target" | "press";
  rect: { x: number; y: number; width: number; height: number } | null;
};

type OpenworkControlContextValue = {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  route: string;
  narration: string;
  busyActionId: string | null;
  actions: OpenworkControlActionMetadata[];
  registerAction: (actionId: string, actionRef: ControlActionRef) => () => void;
  executeAction: (actionId: string, args?: unknown) => Promise<OpenworkControlResult>;
  publishContext: (context: OpenworkContextSnapshot) => void;
  snapshot: () => OpenworkControlSnapshot;
};

type OpenworkControlAPI = {
  version: number;
  snapshot: () => OpenworkControlSnapshot;
  listActions: () => OpenworkControlActionMetadata[];
  execute: (actionId: string, args?: unknown) => Promise<OpenworkControlResult>;
  context: () => OpenworkContextSnapshot;
  query: (request: OpenworkAffordanceRequest) => Promise<OpenworkAffordanceResult>;
  command: (request: OpenworkAffordanceRequest) => Promise<OpenworkAffordanceResult>;
  setEnabled: (enabled: boolean) => void;
  subscribe: (listener: (snapshot: OpenworkControlSnapshot) => void) => () => void;
};

declare global {
  interface Window {
    __openworkControl?: OpenworkControlAPI;
  }
}

const CONTROL_API_VERSION = 2;
const OpenworkControlContext = createContext<OpenworkControlContextValue | null>(null);
const SPOTLIGHT_TIMING_MS = Object.freeze({
  missingTarget: 80,
  scrollIntoView: 180,
  target: 260,
  press: 130,
  release: 80,
  done: 280,
});

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function describeError(error: unknown) {
  if (error instanceof Error && /[\u3400-\u9fff]/.test(error.message)) return error.message;
  return "操作失败，请稍后重试。";
}

function returnedActionError(result: unknown) {
  if (!result || typeof result !== "object") return null;
  const payload = result as { ok?: unknown; error?: unknown };
  if (payload.ok !== false) return null;
  return typeof payload.error === "string" && payload.error.trim()
    ? payload.error
    : "操作未能完成。";
}

function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function effectsForSideEffect(sideEffect: OpenworkControlSideEffect): OpenworkAffordanceEffects {
  if (sideEffect === "navigation") {
    return { data: "none", ui: "navigate", external: false };
  }
  if (sideEffect === "mutation") {
    return { data: "write", ui: "none", external: false };
  }
  if (sideEffect === "external") {
    return { data: "none", ui: "none", external: true };
  }
  return { data: "none", ui: "none", external: false };
}

function metadataForAction(registered: RegisteredAction, busyActionId: string | null): OpenworkControlActionMetadata {
  const action = registered.ref.current;
  const sideEffect = action?.sideEffect ?? "none";
  return {
    id: registered.id,
    label: action?.label ?? registered.id,
    description: action?.description,
    kind: action?.kind ?? "command",
    effects: action?.effects ?? effectsForSideEffect(sideEffect),
    sideEffect,
    requiresConfirmation: action?.requiresConfirmation === true,
    requiresArgs: action?.requiresArgs === true,
    hasPreviewArgs: action?.previewArgs !== undefined,
    previewArgs: action?.previewArgs,
    args: action?.args,
    disabled: action?.disabled === true,
    busy: busyActionId === registered.id,
  };
}

function affordanceForAction(action: OpenworkControlActionMetadata): OpenworkAffordanceDescriptor {
  return {
    id: action.id,
    kind: action.kind,
    title: action.label,
    description: action.description ?? action.label,
    provider: { id: "openwork-ui", kind: "builtin" },
    arguments: (action.args ?? []).map((argument) => ({
      name: argument.name,
      type: argument.type ?? "unknown",
      required: argument.required === true,
      ...(argument.description ? { description: argument.description } : {}),
    })),
    effects: action.effects,
    confirmation: action.requiresConfirmation ? "destructive" : "never",
    availability: {
      enabled: !action.disabled && !action.busy,
      ...(action.disabled ? { reason: "This action is not available in the current app state." } : {}),
    },
    executor: { kind: "openwork" },
  };
}

function ControlModeSpotlight({ spotlight }: { spotlight: SpotlightState }) {
  const rect = spotlight.rect;
  if (!spotlight.visible || !rect) return null;

  const pad = spotlight.phase === "press" ? 8 : 12;
  return (
    <div
      className="pointer-events-none fixed z-[9998] rounded-[18px] bg-[rgba(var(--dls-accent-rgb),0.1)] shadow-[0_0_0_9999px_rgba(7,10,18,0.08),0_0_36px_rgba(var(--dls-accent-rgb),0.32),inset_0_0_0_1px_rgba(var(--dls-accent-rgb),0.24)] transition-all duration-200 ease-out"
      style={{
        left: `${rect.x - pad}px`,
        top: `${rect.y - pad}px`,
        width: `${rect.width + pad * 2}px`,
        height: `${rect.height + pad * 2}px`,
        transform: spotlight.phase === "press" ? "scale(0.985)" : "scale(1)",
      }}
    />
  );
}

export function OpenworkControlProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const actionsRef = useRef(new Map<string, RegisteredAction>());
  const listenersRef = useRef(new Set<(snapshot: OpenworkControlSnapshot) => void>());
  const contextRef = useRef<OpenworkContextSnapshot | null>(null);
  const contextRevisionRef = useRef(0);
  const nextOrderRef = useRef(1);
  const [version, setVersion] = useState(0);
  const [enabledState, setEnabledState] = useState(false);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [narration, setNarration] = useState("界面控制已关闭。");
  const [spotlight, setSpotlight] = useState<SpotlightState>({ visible: false, phase: "target", rect: null });
  const busyActionIdRef = useRef<string | null>(null);
  const busyActorRef = useRef<string | null>(null);
  const spotlightRunRef = useRef(0);

  const route = `${location.pathname}${location.search}${location.hash}`;
  const enabled = enabledState;
  const status: OpenworkControlSnapshot["status"] = !enabled ? "off" : busyActionId ? "acting" : "ready";

  const setEnabled = useCallback((nextEnabled: boolean) => {
    setEnabledState(nextEnabled);
  }, []);

  const listActionMetadata = useCallback((nextBusyActionId = busyActionId) => {
    return Array.from(actionsRef.current.values())
      .sort((left, right) => left.order - right.order)
      .map((action) => metadataForAction(action, nextBusyActionId));
  }, [busyActionId, version]);

  const actions = useMemo(() => {
    return listActionMetadata();
  }, [listActionMetadata]);

  const snapshot = useCallback((): OpenworkControlSnapshot => ({
    version: CONTROL_API_VERSION,
    enabled,
    route,
    status,
    busyActionId,
    narration,
    actions: listActionMetadata(),
  }), [busyActionId, enabled, listActionMetadata, narration, route, status]);

  const publishContext = useCallback((context: OpenworkContextSnapshot) => {
    if (contextRef.current === context) return;
    contextRef.current = context;
    contextRevisionRef.current += 1;
  }, []);

  const contextSnapshot = useCallback((): OpenworkContextSnapshot => {
    const availableAffordances = listActionMetadata().map(affordanceForAction);
    const published = contextRef.current;
    const revision = contextRevisionRef.current;
    if (published) {
      return {
        ...published,
        revision,
        capturedAt: new Date().toISOString(),
        availableAffordances,
        execution: {
          ...published.execution,
          busyCommandId: busyActionId,
          busyActor: busyActorRef.current,
        },
      };
    }
    return {
      schemaVersion: 1,
      revision,
      capturedAt: new Date().toISOString(),
      screen: { kind: "other", route },
      conversations: { tabs: [], layout: { kind: "empty" } },
      chrome: {
        sidebarOpen: true,
        applicationMenuVisible: false,
        rightSidebarExpanded: false,
      },
      execution: {
        queries: "parallel",
        commands: "serialized",
        busyCommandId: busyActionId,
        busyActor: busyActorRef.current,
      },
      sidePanel: {
        open: false,
        ownerSessionId: null,
        kind: null,
        tabs: [],
        activeTabId: null,
      },
      resources: [{
        ref: `screen:${route}`,
        kind: "screen",
        title: "SeeWayWork",
        provider: { id: "openwork-ui", kind: "builtin" },
        state: { kind: "other", route },
      }],
      availableAffordances,
      contributions: [],
    };
  }, [busyActionId, listActionMetadata, route]);

  const registerAction = useCallback((actionId: string, actionRef: ControlActionRef) => {
    const token = Symbol(actionId);
    const previous = actionsRef.current.get(actionId);
    actionsRef.current.set(actionId, {
      id: actionId,
      order: previous?.order ?? nextOrderRef.current++,
      token,
      ref: actionRef,
    });
    contextRevisionRef.current += 1;
    setVersion((current) => current + 1);

    return () => {
      const current = actionsRef.current.get(actionId);
      if (current?.token === token) {
        actionsRef.current.delete(actionId);
        contextRevisionRef.current += 1;
        setVersion((value) => value + 1);
      }
    };
  }, []);

  const playTargetChoreography = useCallback(async (action: OpenworkControlAction, runId: number) => {
    if (!isBrowser()) return;
    const stillCurrent = () => spotlightRunRef.current === runId;
    const target = action.targetRef?.current;
    if (!target) {
      await wait(SPOTLIGHT_TIMING_MS.missingTarget);
      return;
    }

    target.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    await wait(SPOTLIGHT_TIMING_MS.scrollIntoView);
    if (!stillCurrent() || !target.isConnected) return;
    const rect = target.getBoundingClientRect();
    setSpotlight({
      visible: true,
      phase: "target",
      rect: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      },
    });
    await wait(SPOTLIGHT_TIMING_MS.target);
    if (!stillCurrent()) return;
    setSpotlight((current) => ({ ...current, phase: "press" }));
    await wait(SPOTLIGHT_TIMING_MS.press);
    if (!stillCurrent()) return;
    setSpotlight((current) => ({ ...current, phase: "target" }));
    await wait(SPOTLIGHT_TIMING_MS.release);
  }, []);

  const executeAction = useCallback(async (actionId: string, args?: unknown): Promise<OpenworkControlResult> => {
    const registered = actionsRef.current.get(actionId);
    const action = registered?.ref.current;
    if (!registered || !action) return { ok: false, actionId, error: `未知操作：${actionId}` };
    if (action.disabled) return { ok: false, actionId, error: `当前无法执行：${action.label}` };
    if (busyActionIdRef.current) return { ok: false, actionId, error: `已有操作正在执行：${busyActionIdRef.current}` };

    if (action.requiresConfirmation && isBrowser()) {
      const confirmed = window.confirm(`允许控制模式执行“${action.label}”吗？`);
      if (!confirmed) return { ok: false, actionId, error: "用户已取消操作。" };
    }

    const runId = spotlightRunRef.current + 1;
    spotlightRunRef.current = runId;
    busyActionIdRef.current = action.id;
    contextRevisionRef.current += 1;
    setEnabled(true);
    setBusyActionId(action.id);
    setNarration(`正在定位：${action.label}…`);

    try {
      await playTargetChoreography(action, runId);
      setNarration(`正在执行：${action.label}…`);
      const effectiveArgs = args === undefined ? action.previewArgs : args;
      const result = await action.execute(effectiveArgs, { setNarration });
      const resultError = returnedActionError(result);
      if (resultError) {
        setNarration(`无法完成“${action.label}”：${resultError}`);
        if (spotlightRunRef.current === runId) {
          setSpotlight({ visible: false, phase: "target", rect: null });
        }
        return { ok: false, actionId, error: resultError };
      }
      setNarration(`已完成：${action.label}`);
      await wait(SPOTLIGHT_TIMING_MS.done);
      if (spotlightRunRef.current === runId) {
        setSpotlight({ visible: false, phase: "target", rect: null });
      }
      return { ok: true, actionId, result };
    } catch (error) {
      const message = describeError(error);
      setNarration(`无法完成“${action.label}”：${message}`);
      if (spotlightRunRef.current === runId) {
        setSpotlight({ visible: false, phase: "target", rect: null });
      }
      return { ok: false, actionId, error: message };
    } finally {
      if (busyActionIdRef.current === action.id) busyActionIdRef.current = null;
      contextRevisionRef.current += 1;
      setBusyActionId(null);
    }
  }, [playTargetChoreography, setEnabled]);

  const queryAffordance = useCallback(async (
    request: OpenworkAffordanceRequest,
  ): Promise<OpenworkAffordanceResult> => {
    const action = actionsRef.current.get(request.id)?.ref.current;
    const revision = contextRevisionRef.current;
    if (!action || action.kind !== "query") {
      return {
        ok: false,
        id: request.id,
        error: `Unknown query: ${request.id}`,
        code: "unavailable",
        revision,
      };
    }
    if (action.disabled) {
      return {
        ok: false,
        id: request.id,
        error: `Query is disabled: ${action.label}`,
        code: "unavailable",
        revision,
      };
    }
    try {
      const effectiveArgs = request.args === undefined ? action.previewArgs : request.args;
      const result = await action.execute(effectiveArgs, { setNarration: () => undefined });
      const resultError = returnedActionError(result);
      if (resultError) {
        return {
          ok: false,
          id: request.id,
          error: resultError,
          code: "failed",
          revision,
        };
      }
      return {
        ok: true,
        id: request.id,
        result,
        revision,
        effects: action.effects ?? { data: "read", ui: "none", external: false },
      };
    } catch (error) {
      return {
        ok: false,
        id: request.id,
        error: describeError(error),
        code: "failed",
        revision,
      };
    }
  }, []);

  const executeCommand = useCallback(async (
    request: OpenworkAffordanceRequest,
  ): Promise<OpenworkAffordanceResult> => {
    const action = actionsRef.current.get(request.id)?.ref.current;
    const revision = contextRevisionRef.current;
    if (!action || action.kind === "query") {
      return {
        ok: false,
        id: request.id,
        error: `Unknown command: ${request.id}`,
        code: "unavailable",
        revision,
      };
    }
    if (busyActionIdRef.current) {
      const actor = busyActorRef.current ? ` for ${busyActorRef.current}` : "";
      return {
        ok: false,
        id: request.id,
        error: `Already acting: ${busyActionIdRef.current}${actor}`,
        code: "conflict",
        revision,
      };
    }
    if (request.expectedRevision !== undefined && request.expectedRevision !== revision) {
      return {
        ok: false,
        id: request.id,
        error: `SeeWayWork context changed from revision ${request.expectedRevision} to ${revision}.`,
        code: "conflict",
        revision,
      };
    }
    busyActorRef.current = request.actor ?? null;
    const result = await executeAction(request.id, request.args);
    if (!busyActionIdRef.current) busyActorRef.current = null;
    if (!result.ok) {
      return {
        ok: false,
        id: request.id,
        error: result.error,
        code: result.error.startsWith("Already acting:") ? "conflict" : "failed",
        revision: contextRevisionRef.current,
      };
    }
    const sideEffect = action.sideEffect ?? "none";
    return {
      ok: true,
      id: request.id,
      result: result.result,
      revision: contextRevisionRef.current,
      effects: action.effects ?? effectsForSideEffect(sideEffect),
    };
  }, [executeAction]);

  const value = useMemo<OpenworkControlContextValue>(() => ({
    enabled,
    setEnabled,
    route,
    narration,
    busyActionId,
    actions,
    registerAction,
    executeAction,
    publishContext,
    snapshot,
  }), [
    actions,
    busyActionId,
    enabled,
    executeAction,
    narration,
    publishContext,
    registerAction,
    route,
    setEnabled,
    snapshot,
  ]);

  useEffect(() => {
    if (!enabled) {
      setNarration("界面控制已关闭。");
    } else if (narration === "界面控制已关闭。") {
      setNarration("界面控制已就绪，可以查看并执行当前页面提供的操作。");
    }
  }, [enabled, narration]);

  useEffect(() => {
    if (!isBrowser()) return;

    const api: OpenworkControlAPI = {
      version: CONTROL_API_VERSION,
      snapshot,
      listActions: () => snapshot().actions,
      execute: executeAction,
      context: contextSnapshot,
      query: queryAffordance,
      command: executeCommand,
      setEnabled,
      subscribe(listener) {
        listenersRef.current.add(listener);
        listener(snapshot());
        return () => {
          listenersRef.current.delete(listener);
        };
      },
    };

    window.__openworkControl = api;
    return () => {
      if (window.__openworkControl === api) {
        delete window.__openworkControl;
      }
    };
  }, [contextSnapshot, executeAction, executeCommand, queryAffordance, setEnabled, snapshot]);

  useEffect(() => {
    busyActionIdRef.current = busyActionId;
  }, [busyActionId]);

  useEffect(() => {
    const next = snapshot();
    listenersRef.current.forEach((listener) => listener(next));
  }, [snapshot, version]);

  return (
    <OpenworkControlContext.Provider value={value}>
      {children}
      <ControlModeSpotlight spotlight={spotlight} />
    </OpenworkControlContext.Provider>
  );
}

export function useOpenworkControl() {
  return use(OpenworkControlContext);
}

export function usePublishOpenworkContext(context: OpenworkContextSnapshot) {
  const control = useOpenworkControl();
  const publishContext = control?.publishContext;

  useEffect(() => {
    publishContext?.(context);
  }, [context, publishContext]);
}

export function useControlAction(action: OpenworkControlAction | null | false | undefined) {
  const control = useOpenworkControl();
  const registerAction = control?.registerAction;
  const latestActionRef = useRef<OpenworkControlAction | null>(action || null);
  latestActionRef.current = action || null;
  const actionId = action ? action.id : null;

  useEffect(() => {
    if (!registerAction || !actionId) return undefined;
    return registerAction(actionId, latestActionRef);
  }, [actionId, registerAction]);
}

/**
 * 注册可动态变化的控制操作列表。每项操作使用稳定 ID 跟踪，执行时读取最新闭包，
 * 已移除的操作会自动注销，同时避免在循环中调用 Hook。
 */
export function useControlActions(actions: readonly OpenworkControlAction[]) {
  const control = useOpenworkControl();
  const registerAction = control?.registerAction;

  // 每个操作 ID 使用独立引用，确保执行时读取最新闭包。
  const refsById = useRef<Map<string, { current: OpenworkControlAction | null }>>(new Map());
  for (const action of actions) {
    const existing = refsById.current.get(action.id);
    if (existing) {
      existing.current = action;
    } else {
      refsById.current.set(action.id, { current: action });
    }
  }

  const ids = actions.map((action) => action.id).join("\u0000");

  useEffect(() => {
    if (!registerAction) return undefined;
    const liveIds = new Set(actions.map((action) => action.id));
    // 清理已经不在列表中的操作引用。
    for (const id of Array.from(refsById.current.keys())) {
      if (!liveIds.has(id)) refsById.current.delete(id);
    }
    const cleanups = actions.map((action) => {
      const ref = refsById.current.get(action.id);
      return ref ? registerAction(action.id, ref) : undefined;
    });
    return () => {
      for (const cleanup of cleanups) cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerAction, ids]);
}

import { SETTINGS_TAB_VALUES } from "../../../app/types";

const SETTINGS_TABS: ReadonlySet<string> = new Set<string>(SETTINGS_TAB_VALUES);

export function OpenworkRouteControlActions() {
  const navigate = useNavigate();

  const actions = useMemo<OpenworkControlAction[]>(() => [
    {
      id: "route.session",
      label: "打开会话",
      description: "进入主会话页面。",
      sideEffect: "navigation",
      execute: () => navigate("/session"),
    },
    {
      id: "route.settings.general",
      label: "打开常规设置",
      description: "进入常规设置页面。",
      sideEffect: "navigation",
      execute: () => navigate("/settings/general"),
    },
    {
      id: "route.settings.skills",
      label: "打开技能设置",
      description: "进入技能设置页面。",
      sideEffect: "navigation",
      execute: () => navigate("/settings/extensions/skills"),
    },
    {
      id: "route.settings.providers",
      label: "打开模型设置",
      description: "进入模型和供应商设置页面。",
      sideEffect: "navigation",
      execute: () => navigate("/settings/ai"),
    },
    {
      id: "route.settings.authorized_folders",
      label: "打开文件授权设置",
      description: "进入文件夹和文件访问授权页面。",
      sideEffect: "navigation",
      execute: () => navigate("/settings/permissions"),
    },
    {
      id: "route.settings.appearance",
      label: "打开外观设置",
      description: "进入外观设置页面。",
      sideEffect: "navigation",
      execute: () => navigate("/settings/appearance"),
    },
    {
      id: "settings.panel.open",
      label: "打开指定设置页",
      description: "根据页面标识进入指定设置页面。",
      sideEffect: "navigation",
      requiresArgs: true,
      args: [
        {
          name: "panel",
          type: "string",
          required: true,
          description:
            "设置页标识：general | ai | preferences | permissions | shell | extensions | skills | environment | advanced | appearance | updates | recovery | debug | cloud-account | cloud-providers | cloud-marketplaces",
        },
      ],
      previewArgs: { panel: "ai" },
      execute: (args) => {
        const requested = (args as { panel?: unknown } | undefined)?.panel;
        const panel = typeof requested === "string" ? requested.trim() : "";
        if (!SETTINGS_TABS.has(panel)) {
          return {
            ok: false,
            error: `未知设置页：${panel || "未填写"}。可用值：${Array.from(SETTINGS_TABS).join("、")}。`,
          };
        }
        navigate(`/settings/${panel}`);
        return { ok: true, panel };
      },
    },
    {
      id: "route.back",
      label: "返回上一页",
      description: "返回浏览历史中的上一页。",
      sideEffect: "navigation",
      execute: () => navigate(-1),
    },
    {
      id: "route.forward",
      label: "前往下一页",
      description: "前往浏览历史中的下一页。",
      sideEffect: "navigation",
      execute: () => navigate(1),
    },
    {
      id: "help.capabilities",
      label: "查看 SeeWayWork 能力",
      description: "列出 SeeWayWork 当前提供的主要能力。",
      sideEffect: "none",
      execute: () => ({
        capabilities: [
          { id: "browse", label: "浏览器", description: "打开网页、提取内容并自动完成网页任务。" },
          { id: "providers", label: "模型", description: "使用公司共享模型或配置获准的自定义模型服务。" },
          { id: "extensions", label: "MCP 扩展", description: "使用公司下发或当前工作区配置的 MCP 服务。" },
          { id: "voice", label: "语音对话", description: "通过实时语音与 SeeWayWork 对话。" },
          { id: "files", label: "文件管理", description: "在获授权的工作区中读取、写入和整理文件。" },
          { id: "code", label: "代码与命令", description: "在当前工作区权限范围内生成、编辑和运行代码。" },
          { id: "computer-use", label: "电脑操作", description: "经本机授权后使用截图、鼠标和键盘完成操作。" },
          { id: "skills", label: "技能", description: "安装适合具体工作流程的技能。" },
          { id: "automations", label: "自动任务", description: "安排重复任务和后台智能体。" },
          { id: "sharing", label: "会话协作", description: "在公司权限范围内与同事协作处理工作区会话。" },
        ],
        hint: "可使用 settings.panel.open 打开相应设置页。例如，panel 设为 ai 可配置模型，设为 extensions 可管理 MCP。",
      }),
    },
  ], [navigate]);

  useControlActions(actions);
  return null;
}
