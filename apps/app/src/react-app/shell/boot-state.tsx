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
import { toChineseUserMessage } from "../../app/lib/user-facing-error";

export type BootPhaseId =
  | "idle"
  | "bootstrapping-workspaces"
  | "starting-openwork-server"
  | "starting-engine"
  | "activating-workspace"
  | "ready"
  | "error";

export type BootStateSnapshot = {
  phase: BootPhaseId;
  message: string;
  detail: string | null;
  startedAt: number | null;
  completedAt: number | null;
  error: string | null;
};

type BootStateContextValue = BootStateSnapshot & {
  routeReady: boolean;
  setPhase: (phase: BootPhaseId, detail?: string | null) => void;
  setError: (message: string | null) => void;
  markReady: () => void;
  markRouteReady: () => void;
};

const DEFAULT_STATE: BootStateSnapshot = {
  phase: "idle",
  message: "",
  detail: null,
  startedAt: null,
  completedAt: null,
  error: null,
};

const PHASE_MESSAGES: Record<BootPhaseId, string> = {
  idle: "",
  "bootstrapping-workspaces": "正在加载工作区",
  "starting-openwork-server": "正在启动 FoxWork 本地服务",
  "starting-engine": "正在准备工作区",
  "activating-workspace": "正在打开工作区",
  ready: "已就绪",
  error: "FoxWork 启动失败",
};

const BootStateContext = createContext<BootStateContextValue | null>(null);

export function BootStateProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<BootStateSnapshot>(DEFAULT_STATE);
  // 主界面首次成功读取工作区和会话后即进入可交互状态；后续后台刷新不再显示启动浮层。
  const [routeReady, setRouteReady] = useState(false);
  const startedAtRef = useRef<number | null>(null);

  const setPhase = useCallback((phase: BootPhaseId, detail?: string | null) => {
    setSnapshot((current) => {
      const nextStartedAt =
        current.phase === "idle" && phase !== "idle"
          ? (startedAtRef.current = Date.now())
          : (startedAtRef.current ?? current.startedAt);
      return {
        ...current,
        phase,
        message: PHASE_MESSAGES[phase] ?? current.message,
        detail: detail ?? null,
        startedAt: nextStartedAt,
        completedAt: phase === "ready" ? Date.now() : null,
        error: phase === "error" ? current.error : null,
      };
    });
  }, []);

  const setError = useCallback((message: string | null) => {
    const visibleMessage = message
      ? toChineseUserMessage(message, "FoxWork 启动失败，请重试。")
      : null;
    setSnapshot((current) => ({
      ...current,
      error: visibleMessage,
      phase: visibleMessage ? "error" : current.phase,
      message: visibleMessage ? PHASE_MESSAGES.error : current.message,
    }));
  }, []);

  const markReady = useCallback(() => {
    setSnapshot((current) => ({
      ...current,
      phase: "ready",
      message: PHASE_MESSAGES.ready,
      detail: null,
      completedAt: Date.now(),
      error: null,
    }));
  }, []);

  const markRouteReady = useCallback(() => {
    setRouteReady(true);
  }, []);

  const value = useMemo<BootStateContextValue>(
    () => ({ ...snapshot, routeReady, setPhase, setError, markReady, markRouteReady }),
    [markReady, markRouteReady, routeReady, setError, setPhase, snapshot],
  );

  return <BootStateContext.Provider value={value}>{children}</BootStateContext.Provider>;
}

export function useBootState(): BootStateContextValue {
  const value = use(BootStateContext);
  if (!value) {
    throw new Error("useBootState must be used inside <BootStateProvider>");
  }
  return value;
}

/**
 * Overlay stays up until BOTH the desktop boot hook has reported `ready` AND
 * the main route has completed its first refresh (`routeReady`). After that
 * we hold for ~160ms so the fade feels intentional instead of a flicker.
 */
export function useBootOverlayVisible(): boolean {
  const { phase, routeReady } = useBootState();
  // HMR can remount the provider while the route tree stays mounted. In that
  // state the boot phase falls back to `idle`, but the already-rendered route
  // is interactive and can mark itself ready again. Treat `idle + routeReady`
  // the same as `ready + routeReady` so the full-screen boot overlay never
  // becomes a permanent pointer-events blocker during development.
  const canHide = routeReady && (phase === "ready" || phase === "idle");
  const [visible, setVisible] = useState(!canHide);

  useEffect(() => {
    if (canHide) {
      const handle = window.setTimeout(() => setVisible(false), 160);
      return () => window.clearTimeout(handle);
    }
    setVisible(true);
    return undefined;
  }, [canHide]);

  return visible;
}
