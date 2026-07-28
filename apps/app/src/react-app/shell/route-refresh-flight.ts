/**
 * 工作区路由的刷新协调器。
 *
 * 同一时刻只允许一轮刷新，但后续调用必须等待正在执行的那一轮完成，
 * 不能把“已经有刷新在跑”误当作“数据已经刷新完成”。
 */
export function createRouteRefreshFlight() {
  let activeFlight: Promise<void> | null = null;

  return {
    run(operation: () => Promise<void>): Promise<void> {
      if (activeFlight) return activeFlight;

      // 延后一微任务再执行，确保 activeFlight 已经建立；同步触发的重入调用
      // 也会复用同一个 Promise。
      const flight = Promise.resolve().then(operation);
      activeFlight = flight;

      void flight.then(
        () => {
          if (activeFlight === flight) activeFlight = null;
        },
        () => {
          if (activeFlight === flight) activeFlight = null;
        },
      );
      return flight;
    },
  };
}

export const ROUTE_REFRESH_STEP_TIMEOUT_MS = 15_000;

/** 为路由刷新中的单个网络或桌面桥接步骤设置上限，避免整个页面永久等待。 */
export function withRouteRefreshTimeout<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = ROUTE_REFRESH_STEP_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label}响应超时，请检查网络后重试。`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
