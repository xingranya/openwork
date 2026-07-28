/**
 * 管理主进程向渲染器投递深层链接的时序。
 *
 * 渲染器完成事件监听前，链接只能暂存在主进程；监听就绪后再一次性投递。
 * 页面重载会重新进入未就绪状态，避免把链接发送给已经销毁的渲染上下文。
 */
export function createDeepLinkDelivery(send) {
  let rendererReady = false;
  const pending = [];

  function normalize(urls) {
    if (!Array.isArray(urls)) return [];
    return urls
      .filter((url) => typeof url === "string")
      .map((url) => url.trim())
      .filter(Boolean);
  }

  function deliver(urls) {
    if (urls.length === 0) return [];
    send(urls);
    return urls;
  }

  return {
    enqueue(urls) {
      const next = normalize(urls);
      if (next.length === 0) return [];
      if (!rendererReady) {
        pending.push(...next);
        return [];
      }
      try {
        return deliver(next);
      } catch (error) {
        pending.unshift(...next);
        throw error;
      }
    },

    setRendererReady(ready) {
      rendererReady = Boolean(ready);
      if (!rendererReady || pending.length === 0) return [];

      const next = pending.splice(0, pending.length);
      try {
        return deliver(next);
      } catch (error) {
        pending.unshift(...next);
        throw error;
      }
    },

    reset() {
      rendererReady = false;
    },

    isReady() {
      return rendererReady;
    },

    pendingUrls() {
      return [...pending];
    },
  };
}

/**
 * 只有即将替换当前渲染上下文的主框架导航才需要重新等待握手。
 * 被 SeeWayWork 拦截到内置浏览器的外部导航不会销毁当前页面。
 */
export function shouldResetDeepLinkDeliveryForNavigation({
  isMainFrame,
  isInPlace,
  isAllowed,
}) {
  return Boolean(isMainFrame) && !isInPlace && Boolean(isAllowed);
}
