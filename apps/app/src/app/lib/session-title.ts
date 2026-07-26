import { t } from "../../i18n";

/** Raw English string — used for prefix matching against stored titles. */
export const DEFAULT_SESSION_TITLE = "New session";

const GENERATED_SESSION_TITLE_PREFIX = `${DEFAULT_SESSION_TITLE} - `;

export function isGeneratedSessionTitle(title: string | null | undefined) {
  const trimmed = title?.trim() ?? "";
  if (!trimmed.startsWith(GENERATED_SESSION_TITLE_PREFIX)) return false;
  const suffix = trimmed.slice(GENERATED_SESSION_TITLE_PREFIX.length).trim();
  return Boolean(suffix) && Number.isFinite(Date.parse(suffix));
}

export function shouldAutoTitleSession(title: string | null | undefined) {
  const trimmed = title?.trim() ?? "";
  return !trimmed || trimmed === DEFAULT_SESSION_TITLE || isGeneratedSessionTitle(trimmed);
}

function cleanTitleSource(value: string) {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/^[#>*`~\-\s]+/gm, "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildAutomaticSessionTitle(
  prompt: string,
  attachmentNames: string[] = [],
) {
  const source = cleanTitleSource(prompt) || (
    attachmentNames.length > 0
      ? `分析 ${attachmentNames.map((name) => name.trim()).filter(Boolean).join("、")}`
      : ""
  );
  if (!source) return null;

  const characters = Array.from(source);
  const maxLength = /[\u3400-\u9fff]/.test(source) ? 28 : 56;
  if (characters.length <= maxLength) return source;
  return `${characters.slice(0, maxLength).join("")}…`;
}

export function getDisplaySessionTitle(
  title: string | null | undefined,
  fallback?: string,
) {
  const trimmed = title?.trim() ?? "";
  if (!trimmed || isGeneratedSessionTitle(trimmed)) return fallback ?? t("session.default_title");
  return trimmed;
}
