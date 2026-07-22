const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const INTERNAL_NETWORK_PROTOCOLS = new Set(["file:", "data:", "blob:", "chrome:", "chrome-extension:", "devtools:"]);
const CONFIGURED_NETWORK_URL_KEYS = [
  "OPENWORK_DEN_BASE_URL",
  "OPENWORK_ELECTRON_START_URL",
  "ELECTRON_START_URL",
  "OPENWORK_UPDATER_STABLE_URL",
  "OPENWORK_UPDATER_ALPHA_URL",
];
const CONFIGURED_EXTERNAL_URL_KEYS = ["OPENWORK_UPDATER_RELEASE_PAGE_URL"];
const CONFIGURED_MAIN_DOCUMENT_URL_KEYS = ["OPENWORK_ELECTRON_START_URL", "ELECTRON_START_URL"];

function parseUrl(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return null;
  try {
    return new URL(rawUrl.trim());
  } catch {
    return null;
  }
}

function isLoopbackUrl(url) {
  return LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
}

function commaSeparatedUrls(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function createNavigationPolicy(environment = process.env) {
  const allowedNetworkOrigins = new Set();
  const runtimeNetworkOrigins = new Set();
  const allowedExternalOrigins = new Set();
  const allowedMainDocumentOrigins = new Set();
  const allowedMainDocumentFiles = new Set();

  function allow(rawUrl) {
    const url = parseUrl(rawUrl);
    if (!url || (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "ws:" && url.protocol !== "wss:")) {
      return false;
    }
    allowedNetworkOrigins.add(url.origin);
    return true;
  }

  function allowExternal(rawUrl) {
    const url = parseUrl(rawUrl);
    if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) return false;
    allowedExternalOrigins.add(url.origin);
    allow(rawUrl);
    return true;
  }

  function allowMainDocument(rawUrl) {
    const url = parseUrl(rawUrl);
    if (!url) return false;
    if (url.protocol === "file:") {
      url.search = "";
      url.hash = "";
      allowedMainDocumentFiles.add(url.href);
      return true;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    allowedMainDocumentOrigins.add(url.origin);
    allow(rawUrl);
    return true;
  }

  function replaceRuntimeNetworkUrls(rawUrls) {
    runtimeNetworkOrigins.clear();
    for (const rawUrl of rawUrls ?? []) {
      const url = parseUrl(rawUrl);
      if (!url || !["http:", "https:", "ws:", "wss:"].includes(url.protocol)) continue;
      runtimeNetworkOrigins.add(url.origin);
    }
  }

  for (const key of CONFIGURED_NETWORK_URL_KEYS) allow(environment[key]);
  for (const key of CONFIGURED_EXTERNAL_URL_KEYS) allowExternal(environment[key]);
  for (const key of CONFIGURED_MAIN_DOCUMENT_URL_KEYS) allowMainDocument(environment[key]);
  for (const rawUrl of commaSeparatedUrls(environment.OPENWORK_RENDERER_NETWORK_ALLOWLIST)) allow(rawUrl);
  for (const rawUrl of commaSeparatedUrls(environment.OPENWORK_EXTERNAL_URL_ALLOWLIST)) allowExternal(rawUrl);

  function allowsNetworkUrl(rawUrl) {
    const url = parseUrl(rawUrl);
    if (!url) return false;
    if (INTERNAL_NETWORK_PROTOCOLS.has(url.protocol)) return true;
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return false;
    return isLoopbackUrl(url) || allowedNetworkOrigins.has(url.origin) || runtimeNetworkOrigins.has(url.origin);
  }

  function allowsExternalUrl(rawUrl) {
    const url = parseUrl(rawUrl);
    if (!url || !["http:", "https:"].includes(url.protocol)) return false;
    return isLoopbackUrl(url) || allowedExternalOrigins.has(url.origin);
  }

  function allowsMainWindowNavigation(rawUrl) {
    if (rawUrl === "about:blank") return true;
    const url = parseUrl(rawUrl);
    if (!url) return false;
    if (url.protocol === "file:") {
      url.search = "";
      url.hash = "";
      return allowedMainDocumentFiles.has(url.href);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return allowedMainDocumentOrigins.has(url.origin);
  }

  return {
    allow,
    allowExternal,
    allowMainDocument,
    allowsExternalUrl,
    allowsMainWindowNavigation,
    allowsNetworkUrl,
    replaceRuntimeNetworkUrls,
    allowedOrigins: () => Array.from(new Set([...allowedNetworkOrigins, ...runtimeNetworkOrigins])).sort(),
  };
}

export function installMainWindowNetworkAllowlist(defaultSession, policy) {
  defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !policy.allowsNetworkUrl(details.url) });
  });
}
