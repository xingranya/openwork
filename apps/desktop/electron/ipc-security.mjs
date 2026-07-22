function mainWindowWebContents(getMainWindow) {
  const window = typeof getMainWindow === "function" ? getMainWindow() : null;
  if (!window || window.isDestroyed?.()) return null;
  return window.webContents ?? null;
}

export function isTrustedMainWindowIpcSender(event, getMainWindow) {
  const trustedWebContents = mainWindowWebContents(getMainWindow);
  if (!trustedWebContents || !event?.sender) return false;
  if (event.sender !== trustedWebContents && event.sender.id !== trustedWebContents.id) return false;
  return Boolean(
    event.senderFrame &&
    trustedWebContents.mainFrame &&
    event.senderFrame === trustedWebContents.mainFrame
  );
}

export function assertTrustedMainWindowIpcSender(event, getMainWindow) {
  if (!isTrustedMainWindowIpcSender(event, getMainWindow)) {
    throw new Error("拒绝来自非主窗口的桌面 IPC 请求");
  }
}

export function registerTrustedIpcHandler(ipcMain, channel, getMainWindow, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedMainWindowIpcSender(event, getMainWindow);
    return handler(event, ...args);
  });
}

export function resolveOwnHandler(handlers, command) {
  if (typeof command !== "string" || !Object.hasOwn(handlers, command)) return null;
  const handler = handlers[command];
  return typeof handler === "function" ? handler : null;
}
