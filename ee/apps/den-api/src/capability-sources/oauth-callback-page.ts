/** 外部 MCP 和内置服务共用的 OAuth 回调完成页。 */

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function callbackErrorMessage(message: string): string {
  const normalized = message.replace(/\s+/g, " ").trim()
  return /[\u3400-\u9fff]/u.test(normalized)
    ? normalized
    : "无法完成连接，请重试或联系管理员。"
}

export function connectCallbackPage(input:
  | { ok: true; name: string }
  | { ok: false; name: string; message: string; referenceId?: string }): string {
  const title = input.ok ? "连接成功" : "连接失败"
  const closeButton = `<button type="button" onclick="window.close()" style="margin-top:16px; border:0; border-radius:10px; background:#0f172a; color:white; padding:10px 14px; font:inherit; font-weight:600; cursor:pointer;">关闭窗口</button>`
  const body = input.ok
    ? `<p>${escapeHtml(input.name)} 已连接到 SeeWayWork。</p>
      <p>现在可以关闭此窗口。</p>
      ${closeButton}`
    : `<p>无法连接 ${escapeHtml(input.name)}：${escapeHtml(callbackErrorMessage(input.message))}</p>
      ${input.referenceId ? `<p style="font-size:12px; color:#64748b;">诊断编号：<code>${escapeHtml(input.referenceId)}</code></p>` : ""}
      ${closeButton}`
  return `<!doctype html>
<html lang="zh-CN">
  <head><meta charset="utf-8"><title>${title} — SeeWayWork</title></head>
  <body style="font-family: system-ui, sans-serif; max-width: 480px; margin: 64px auto; text-align: center; color: #0f172a;">
    <h1 style="font-size: 20px;">${title}</h1>
    ${body}
  </body>
</html>`
}
