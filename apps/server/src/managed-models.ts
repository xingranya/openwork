export type ManagedModelsEnvironment = {
  OPENCODE_MODELS_URL: string | undefined;
  OPENCODE_DISABLE_MODELS_FETCH: string | undefined;
};

function isLoopbackModelCatalogHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]";
}

export function resolveManagedModelsUrl(raw: string | undefined): string | undefined {
  const value = raw?.trim() ?? "";
  if (!value) return undefined;

  try {
    const url = new URL(value);
    if (url.username || url.password) return undefined;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackModelCatalogHost(url.hostname))) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

export function resolveManagedModelsEnvironment(raw: string | undefined): ManagedModelsEnvironment {
  const modelsUrl = resolveManagedModelsUrl(raw);
  return {
    OPENCODE_MODELS_URL: modelsUrl,
    OPENCODE_DISABLE_MODELS_FETCH: modelsUrl ? undefined : "1",
  };
}
