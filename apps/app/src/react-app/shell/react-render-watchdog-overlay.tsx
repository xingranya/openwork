/** @jsxImportSource react */
import { useEffect, useReducer } from "react";

import {
  readReactRenderWatchdogSnapshot,
  resetReactRenderWatchdogStats,
} from "./react-render-watchdog";

function readStoredPreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("openwork.debug.renderOverlay") === "1";
  } catch {
    return false;
  }
}

function writeStoredPreference(value: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem("openwork.debug.renderOverlay", value ? "1" : "0");
  } catch {
    // ignore
  }
}

type OverlayState = {
  visible: boolean;
  collapsed: boolean;
  snapshot: ReturnType<typeof readReactRenderWatchdogSnapshot>;
};

type OverlayAction =
  | { type: "toggleVisible" }
  | { type: "hide" }
  | { type: "toggleCollapsed" }
  | { type: "snapshot"; snapshot: ReturnType<typeof readReactRenderWatchdogSnapshot> };

function overlayReducer(state: OverlayState, action: OverlayAction): OverlayState {
  switch (action.type) {
    case "toggleVisible": {
      const visible = !state.visible;
      writeStoredPreference(visible);
      return { ...state, visible };
    }
    case "hide":
      writeStoredPreference(false);
      return { ...state, visible: false };
    case "toggleCollapsed":
      return { ...state, collapsed: !state.collapsed };
    case "snapshot":
      return { ...state, snapshot: action.snapshot };
  }
}

export function ReactRenderWatchdogOverlay() {
  const [state, dispatch] = useReducer(overlayReducer, undefined, () => ({
    visible: readStoredPreference(),
    collapsed: false,
    snapshot: readReactRenderWatchdogSnapshot(),
  }));
  const { visible, collapsed, snapshot } = state;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const metaOrCtrl = event.metaKey || event.ctrlKey;
      if (!metaOrCtrl || !event.shiftKey) return;
      if (event.key.toLowerCase() !== "l") return;
      event.preventDefault();
      dispatch({ type: "toggleVisible" });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const tick = () => dispatch({ type: "snapshot", snapshot: readReactRenderWatchdogSnapshot() });
    tick();
    const interval = window.setInterval(tick, 500);
    return () => window.clearInterval(interval);
  }, [visible]);

  if (!visible) return null;

  const hot = snapshot.slice(0, 12);

  return (
    <div className="pointer-events-auto fixed bottom-3 left-3 z-[1100] w-[320px] overflow-hidden rounded-lg border border-dls-border bg-dls-canvas/95 text-[11px] text-dls-text shadow-lg backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-dls-border px-2.5 py-1.5">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-dls-secondary">
            渲染监控
          </div>
          <div className="text-[10px] text-dls-secondary">
            提交最频繁的 React 界面
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-[10px] text-dls-secondary hover:bg-dls-hover"
            onClick={() => {
              resetReactRenderWatchdogStats();
              dispatch({ type: "snapshot", snapshot: [] });
            }}
          >
            重置
          </button>
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-[10px] text-dls-secondary hover:bg-dls-hover"
            onClick={() => dispatch({ type: "toggleCollapsed" })}
          >
            {collapsed ? "+" : "–"}
          </button>
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-[10px] text-dls-secondary hover:bg-dls-hover"
            onClick={() => dispatch({ type: "hide" })}
            title="隐藏（按 Cmd+Shift+L 可再次显示）"
          >
            ×
          </button>
        </div>
      </div>
      {collapsed ? null : (
        <div className="max-h-[50vh] overflow-y-auto">
          {hot.length === 0 ? (
            <div className="p-3 text-dls-secondary">
              暂无渲染样本，请先操作应用。
            </div>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-[10px] uppercase tracking-[0.1em] text-dls-secondary">
                  <th className="px-2 py-1 text-left font-medium">界面</th>
                  <th className="px-2 py-1 text-right font-medium">2s</th>
                  <th className="px-2 py-1 text-right font-medium">累计</th>
                  <th className="px-2 py-1 text-right font-medium">最近</th>
                </tr>
              </thead>
              <tbody>
                {hot.map((item) => (
                  <tr key={item.name} className="border-t border-dls-border">
                    <td className="max-w-[160px] px-2 py-1 font-mono text-[11px] text-dls-text">
                      <span className="block truncate" title={item.name}>{item.name}</span>
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {item.windowCommits}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-dls-secondary">
                      {item.totalCommits}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-dls-secondary">
                      {Math.round(item.lastCommitAgeMs)} 毫秒
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      <div className="border-t border-dls-border px-2.5 py-1 text-[10px] text-dls-secondary">
        按 Cmd+Shift+L 显示或隐藏，也可通过开发者控制台查看。
      </div>
    </div>
  );
}
