export const DEFAULT_ANALYTICS_ENABLED = false;

/**
 * Resolve explicitly configured PostHog settings. Missing or blank values
 * keep analytics offline in every build.
 */
export function resolvePosthogSetting(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

export function resolveAnalyticsPreference(raw: string | null): boolean {
  if (!raw) return DEFAULT_ANALYTICS_ENABLED;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !("analyticsEnabled" in parsed)) {
      return DEFAULT_ANALYTICS_ENABLED;
    }
    return parsed.analyticsEnabled === true;
  } catch {
    return DEFAULT_ANALYTICS_ENABLED;
  }
}
