/**
 * SeeWayWork 的发行配置只在桌面主进程读取。
 *
 * 正式更新地址固定指向公司 CNB Release；Den 和文档地址仍由公司构建
 * 显式提供。任何配置都不得回退到上游服务。
 */

export const FOXWORK_APP_NAME = "SeeWayWork";
export const FOXWORK_DEV_APP_NAME = "SeeWayWork - 开发";
export const FOXWORK_APP_IDENTIFIER = "com.foxwork.desktop";
export const FOXWORK_DEV_APP_IDENTIFIER = "com.foxwork.desktop.dev";
export const FOXWORK_PROTOCOL_SCHEME = "foxwork";
export const FOXWORK_DEV_PROTOCOL_SCHEME = "foxwork-dev";
export const FOXWORK_RELEASE_PAGE_URL = "https://cnb.cool/xingranya/foxwork/-/releases";
// CNB 不提供 GitHub 兼容的 latest/download 别名。稳定通道固定使用
// seewaywork-stable Release，发行流程会原子更新其清单与安装包。
export const FOXWORK_UPDATE_BASE_URL = `${FOXWORK_RELEASE_PAGE_URL}/download/seewaywork-stable`;

export const FOXWORK_LEGACY_PROTOCOL_SCHEMES = Object.freeze([
  "openwork",
  "openwork-dev",
]);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function httpUrl(value) {
  const candidate = text(value);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function baseUrl(value) {
  const normalized = httpUrl(value);
  return normalized ? normalized.replace(/\/+$/, "") : null;
}

/**
 * 读取 SeeWayWork 桌面构建配置。
 * @param {Record<string, string | undefined>} [env]
 */
export function resolveFoxWorkBrandConfig(env = process.env) {
  const appName = text(env.FOXWORK_APP_NAME) || FOXWORK_APP_NAME;
  const devAppName = text(env.FOXWORK_DEV_APP_NAME) || FOXWORK_DEV_APP_NAME;
  const appIdentifier = text(env.FOXWORK_APP_IDENTIFIER) || FOXWORK_APP_IDENTIFIER;
  const devAppIdentifier = text(env.FOXWORK_DEV_APP_IDENTIFIER) || FOXWORK_DEV_APP_IDENTIFIER;

  return Object.freeze({
    appName,
    devAppName,
    appIdentifier,
    devAppIdentifier,
    protocolScheme: FOXWORK_PROTOCOL_SCHEME,
    devProtocolScheme: FOXWORK_DEV_PROTOCOL_SCHEME,
    docsUrl: httpUrl(env.FOXWORK_DOCS_URL),
    releasePageUrl: httpUrl(env.FOXWORK_RELEASE_PAGE_URL) || FOXWORK_RELEASE_PAGE_URL,
    updateBaseUrl: baseUrl(env.FOXWORK_UPDATE_BASE_URL) || FOXWORK_UPDATE_BASE_URL,
    alphaUpdateBaseUrl: baseUrl(env.FOXWORK_ALPHA_UPDATE_BASE_URL),
    denBaseUrl: baseUrl(env.FOXWORK_DEN_BASE_URL),
  });
}

/**
 * 判断 URL 是否属于新发行协议。
 * @param {string} value
 */
export function isFoxWorkProtocolUrl(value) {
  try {
    const protocol = new URL(String(value ?? "")).protocol.toLowerCase();
    return protocol === `${FOXWORK_PROTOCOL_SCHEME}:` || protocol === `${FOXWORK_DEV_PROTOCOL_SCHEME}:`;
  } catch {
    return false;
  }
}

/**
 * 判断 URL 是否属于迁移兼容协议。
 * @param {string} value
 */
export function isLegacyFoxWorkProtocolUrl(value) {
  try {
    const protocol = new URL(String(value ?? "")).protocol.toLowerCase().replace(/:$/, "");
    return FOXWORK_LEGACY_PROTOCOL_SCHEMES.includes(protocol);
  } catch {
    return false;
  }
}
