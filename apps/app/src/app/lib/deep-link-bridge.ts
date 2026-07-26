export const deepLinkBridgeEvent = "openwork:deep-link";
export const nativeDeepLinkEvent = "openwork:deep-link-native";

export type DeepLinkBridgeDetail = {
  urls: string[];
};

declare global {
  interface Window {
    __OPENWORK__?: {
      deepLinks?: string[];
    };
  }
}

function normalizeDeepLinks(urls: readonly string[]): string[] {
  return urls.flatMap((url) => {
    const trimmed = url.trim();
    return trimmed ? [trimmed] : [];
  });
}

export function pushPendingDeepLinks(target: Window, urls: readonly string[]): string[] {
  const normalized = normalizeDeepLinks(urls);
  if (normalized.length === 0) {
    return [];
  }

  target.__OPENWORK__ ??= {};
  const pending = target.__OPENWORK__.deepLinks ?? [];
  target.__OPENWORK__.deepLinks = [...pending, ...normalized];
  target.dispatchEvent(
    new CustomEvent<DeepLinkBridgeDetail>(deepLinkBridgeEvent, {
      detail: { urls: normalized },
    }),
  );
  return normalized;
}

export function drainPendingDeepLinks(
  target: Window,
  accept: (url: string) => boolean = () => true,
): string[] {
  const pending = target.__OPENWORK__?.deepLinks ?? [];
  if (target.__OPENWORK__) {
    target.__OPENWORK__.deepLinks = pending.filter((url) => !accept(url));
  }
  return pending.filter(accept);
}

/** 从共享待处理队列中移除已经被对应路由处理的链接。 */
export function consumePendingDeepLinks(target: Window, urls: readonly string[]): void {
  if (!target.__OPENWORK__ || urls.length === 0) return;

  const counts = new Map<string, number>();
  for (const url of normalizeDeepLinks(urls)) {
    counts.set(url, (counts.get(url) ?? 0) + 1);
  }

  target.__OPENWORK__.deepLinks = (target.__OPENWORK__.deepLinks ?? []).filter((url) => {
    const remaining = counts.get(url) ?? 0;
    if (remaining === 0) return true;
    counts.set(url, remaining - 1);
    return false;
  });
}
