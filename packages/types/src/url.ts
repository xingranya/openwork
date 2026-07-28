export type BaseUrlEnv = Record<string, string | undefined>;

export function normalizeBaseUrl(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\/+$/, "");
}

/**
 * 为 OpenAI、Anthropic 兼容协议补齐缺失的 API 版本路径。
 * 已明确填写 v1、v3 等版本路径时保持原值，避免改坏服务商专用地址。
 */
export function ensureProviderApiVersion(value: string | null | undefined): string {
  const normalized = normalizeBaseUrl(value);
  if (!normalized) return "";

  try {
    const url = new URL(normalized);
    const pathname = url.pathname.replace(/\/+$/, "");
    if (/\/v\d+$/i.test(pathname)) {
      url.pathname = pathname;
      return normalizeBaseUrl(url.toString());
    }
    url.pathname = `${pathname}/v1`.replace(/^\/\//, "/");
    return normalizeBaseUrl(url.toString());
  } catch {
    return /\/v\d+$/i.test(normalized) ? normalized : `${normalized}/v1`;
  }
}

export function joinBaseUrl(base: string | null | undefined, path: string): string {
  const normalizedBase = normalizeBaseUrl(base);
  const normalizedPath = path.trim().replace(/^\/+/, "");
  return normalizedPath ? `${normalizedBase}/${normalizedPath}` : normalizedBase;
}

export function readBaseUrlEnv(env: BaseUrlEnv, key: string): string | null {
  const normalized = normalizeBaseUrl(env[key]);
  return normalized ? normalized : null;
}

export function hostLabel(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    // Match existing UI fallback: remove a display-only http(s) prefix and trailing slashes.
    return normalizeBaseUrl(value).replace(/^https?:\/\//, "");
  }
}
