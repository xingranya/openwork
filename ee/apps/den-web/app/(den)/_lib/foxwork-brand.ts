export const FOXWORK_DESKTOP_SCHEME = "foxwork";
export const FOXWORK_DEV_DESKTOP_SCHEME = "foxwork-dev";

const LEGACY_DESKTOP_SCHEMES = new Set(["openwork", "openwork-dev"]);

export function normalizeFoxWorkDesktopScheme(value?: string | null): string {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (normalized === FOXWORK_DESKTOP_SCHEME || normalized === FOXWORK_DEV_DESKTOP_SCHEME) {
    return normalized;
  }
  if (LEGACY_DESKTOP_SCHEMES.has(normalized)) {
    return normalized;
  }
  return FOXWORK_DESKTOP_SCHEME;
}

export function isFoxWorkDesktopProtocol(protocol: string, allowLegacy = false): boolean {
  const normalized = protocol.trim().toLowerCase().replace(/:$/, "");
  if (normalized === FOXWORK_DESKTOP_SCHEME || normalized === FOXWORK_DEV_DESKTOP_SCHEME) {
    return true;
  }
  return allowLegacy && LEGACY_DESKTOP_SCHEMES.has(normalized);
}

