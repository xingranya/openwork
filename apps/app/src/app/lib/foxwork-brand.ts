export const FOXWORK_APP_NAME = "FoxWork";
export const FOXWORK_PROTOCOL = "foxwork:";
export const FOXWORK_DEV_PROTOCOL = "foxwork-dev:";

const LEGACY_PROTOCOLS = new Set(["openwork:", "openwork-dev:"]);

function buildValue(name: string): string {
  return String(import.meta.env[name] ?? "").trim();
}

/** 公司 Den 地址必须由构建或桌面交接显式提供。 */
export const FOXWORK_DEN_BASE_URL =
  buildValue("VITE_FOXWORK_DEN_BASE_URL") || buildValue("VITE_DEN_BASE_URL");

/** 未配置公司更新源时保持空值，由界面安全地禁用更新入口。 */
export const FOXWORK_STABLE_UPDATE_BASE_URL = buildValue("VITE_FOXWORK_UPDATE_BASE_URL");
export const FOXWORK_ALPHA_UPDATE_BASE_URL = buildValue("VITE_FOXWORK_ALPHA_UPDATE_BASE_URL");
export const FOXWORK_RELEASE_PAGE_URL = buildValue("VITE_FOXWORK_RELEASE_PAGE_URL");
/** 公司文档、反馈和问题入口均由发行配置提供，不回退到上游地址。 */
export const FOXWORK_DOCS_URL = buildValue("VITE_FOXWORK_DOCS_URL");
export const FOXWORK_FEEDBACK_URL =
  buildValue("VITE_FOXWORK_FEEDBACK_URL") || buildValue("VITE_OPENWORK_FEEDBACK_URL");
export const FOXWORK_ISSUE_URL = buildValue("VITE_FOXWORK_ISSUE_URL");

/**
 * 新链接只使用 foxwork://，旧 openwork:// 仅用于已有安装升级兼容。
 */
export function isFoxWorkDesktopProtocol(
  protocol: string,
  options: { allowLegacy?: boolean } = {},
): boolean {
  const normalized = protocol.trim().toLowerCase();
  if (normalized === FOXWORK_PROTOCOL || normalized === FOXWORK_DEV_PROTOCOL) return true;
  return options.allowLegacy === true && LEGACY_PROTOCOLS.has(normalized);
}

export function foxWorkDesktopLinkPattern(): RegExp {
  return /(?:foxwork-dev|foxwork|openwork-dev|openwork):\/\/[^\s"'<>]+/i;
}
