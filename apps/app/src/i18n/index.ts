import zh from "./locales/zh";
export const LANGUAGE_PREF_KEY = "openwork.language";

/** FoxWork 固定使用的语言。 */
export type Language = "en" | "ja" | "zh" | "vi" | "pt-BR" | "th" | "fr" | "ca" | "es" | "ru";
export type Locale = Language;

/** 唯一允许的界面语言。 */
export const LANGUAGES: Language[] = ["zh"];

/** 界面语言信息；设置页不提供切换入口。 */
export const LANGUAGE_OPTIONS = [
  { value: "zh" as Language, label: "简体中文", nativeName: "简体中文" },
] as const;

/** FoxWork 固定使用中文，不生成英文复数后缀。 */
export const pluralSuffix = (locale: Language, count: number): string => {
  void locale;
  void count;
  return "";
};

/** 发行包只载入简体中文资源。 */
const TRANSLATIONS: Partial<Record<Language, Record<string, string>>> = {
  zh,
};

/** 判断输入是否为受支持的语言值。 */
export const isLanguage = (value: unknown): value is Language => {
  return typeof value === "string" && LANGUAGES.includes(value as Language);
};

let localeValue: Language = "zh";

/** 返回当前语言。 */
export const currentLocale = (): Language => locale();
function locale(): Language {
  return localeValue;
}

/** FoxWork 不允许切换语言，此入口始终保持简体中文。 */
export const setLocale = (newLocale: Language) => {
  void newLocale;
  localeValue = "zh";

  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.setAttribute("lang", "zh-CN");
  }
};

/** 查找中文文案；不存在时返回空值。 */
const lookupEntry = (loc: Language, candidateKey: string): string | null => {
  void loc;
  if (TRANSLATIONS.zh?.[candidateKey]) return TRANSLATIONS.zh[candidateKey];
  return null;
};

const chinesePluralRules = new Intl.PluralRules("zh");
const pluralRule = (loc: Language, count: number): Intl.LDMLPluralRule => {
  void loc;
  return chinesePluralRules.select(count);
};

/** 按数量选择对应文案；中文优先使用基础键，并兼容带数量后缀的资源。 */
const resolvePluralKey = (loc: Language, key: string, count: number): string => {
  const candidates: string[] = [];
  if (count === 0) candidates.push(`${key}_zero`);
  candidates.push(`${key}_${pluralRule(loc, count)}`, `${key}_other`, key);

  for (const candidate of candidates) {
    if (lookupEntry(loc, candidate) !== null) return candidate;
  }
  return key;
};

/** 读取中文文案并替换参数；未知键不得暴露内部名称。 */
type TranslationParams = Record<string, string | number> & { lng?: Language };

export const t = (
  key: string,
  paramsOrLocale?: TranslationParams | Language,
  legacyParams?: Record<string, string | number>,
): string => {
  const params = legacyParams ?? (typeof paramsOrLocale === "string" ? undefined : paramsOrLocale);
  const loc: Language = typeof paramsOrLocale === "string"
    ? paramsOrLocale
    : isLanguage(params?.lng)
      ? params.lng
      : locale();

  const lookupKey =
    typeof params?.count === "number" ? resolvePluralKey(loc, key, params.count) : key;

  const result = lookupEntry(loc, lookupKey);
  if (result === null) return "暂不可用";

  if (!params) return result;

  let out = result;
  for (const [k, v] of Object.entries(params)) {
    if (k === "lng") continue;
    out = out.replace(`{${k}}`, String(v));
  }
  return out;
};

/** 初始化页面语言并固定为简体中文。 */
export const initLocale = (): Language => {
  localeValue = "zh";
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.setAttribute("lang", "zh-CN");
  }
  return "zh";
};
