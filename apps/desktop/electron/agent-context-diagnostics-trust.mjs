function isLoopbackHostname(hostname) {
  const value = String(hostname ?? "").toLowerCase();
  if (value === "localhost" || value === "::1" || value === "[::1]") return true;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  return Boolean(match) && Number(match[1]) === 127 && match.slice(1).every((part) => Number(part) <= 255);
}

function companyOrigin(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.username || url.password) return "";
    if (url.protocol === "https:") return url.origin;
    return url.protocol === "http:" && isLoopbackHostname(url.hostname) ? url.origin : "";
  } catch {
    return "";
  }
}

/**
 * 把员工已保存的公司服务地址加入诊断探针的受控白名单。诊断只会携带
 * MCP 凭据访问该地址；任意其他非 HTTPS 地址和陌生地址仍由服务端拒绝。
 */
export function mergeCompanyOriginIntoDiagnosticsTrust(existing, denBaseUrl) {
  const origin = companyOrigin(denBaseUrl);
  if (!origin) return String(existing ?? "").trim();

  const entries = String(existing ?? "")
    .split(",")
    .map((entry) => entry.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  if (entries.some((entry) => entry === origin)) return entries.join(",");
  return [...entries, origin].join(",");
}
