import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const portValue = Number.parseInt(process.env.PORT ?? "", 10);
const devPort = Number.isFinite(portValue) && portValue > 0 ? portValue : 5173;
const allowedHosts = new Set<string>();
const envAllowedHosts = process.env.VITE_ALLOWED_HOSTS ?? "";

const addHost = (value?: string | null) => {
  const trimmed = value?.trim();
  if (!trimmed) return;
  allowedHosts.add(trimmed);
};

envAllowedHosts.split(",").forEach(addHost);
addHost(process.env.OPENWORK_PUBLIC_HOST ?? null);
const hostname = os.hostname();
addHost(hostname);
const shortHostname = hostname.split(".")[0];
if (shortHostname && shortHostname !== hostname) {
  addHost(shortHostname);
}
const appRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));
const appPackagePath = resolve(appRoot, "package.json");
const desktopPackagePath = resolve(appRoot, "..", "desktop", "package.json");

function firstNonEmpty(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }

  return null;
}

function readLocalGitSha(): string | null {
  try {
    const output = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: appRoot,
      encoding: "utf8",
      stdio: "pipe",
    });
    return output.trim() || null;
  } catch {
    return null;
  }
}

function readPackageVersion(packagePath: string): string | null {
  if (!existsSync(packagePath)) return null;

  const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: string };
  return parsed.version?.trim() || null;
}

const buildAppVersion =
  process.env.VITE_OPENWORK_APP_VERSION?.trim() ||
  readPackageVersion(desktopPackagePath) ||
  readPackageVersion(appPackagePath) ||
  "0.0.0";
const buildReleaseVersion = firstNonEmpty([
  process.env.VITE_OPENWORK_RELEASE_VERSION,
  process.env.RELEASE_TAG,
]);
const buildSha = firstNonEmpty([
  process.env.VITE_OPENWORK_BUILD_SHA,
  process.env.OPENWORK_GIT_SHA,
  process.env.GITHUB_SHA,
]) ?? readLocalGitSha();
const shortBuildSha = buildSha ? buildSha.slice(0, 7) : "";

// Electron 安装包通过 `file://` 加载页面，因此资源路径必须使用相对地址。
const isElectronPackagedBuild = process.env.OPENWORK_ELECTRON_BUILD === "1";
const unsupportedSdkServerMessage = [
  "Request is not supported by this version of Open",
  "Code Server (Server responded with text/html)",
].join("");

export default defineConfig({
  base: isElectronPackagedBuild ? "./" : "/",
  define: {
    "import.meta.env.VITE_OPENWORK_APP_VERSION": JSON.stringify(buildAppVersion),
    "import.meta.env.VITE_OPENWORK_RELEASE_VERSION": JSON.stringify(buildReleaseVersion ?? ""),
    "import.meta.env.VITE_OPENWORK_BUILD_SHA": JSON.stringify(shortBuildSha),
  },
  plugins: [
    {
      name: "openwork-dev-server-id",
      configureServer(server) {
        server.middlewares.use("/__openwork_dev_server_id", (_req, res) => {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ appRoot }));
        });
      },
    },
    {
      name: "foxwork-sdk-user-messages",
      enforce: "pre",
      transform(code, id) {
        if (!id.includes("@opencode-ai/sdk") || !code.includes(unsupportedSdkServerMessage)) {
          return null;
        }
        return {
          code: code.replaceAll(
            unsupportedSdkServerMessage,
            "当前运行服务版本不支持此请求，服务器返回了网页内容。",
          ),
          map: null,
        };
      },
    },
    tailwindcss(),
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", { compilationMode: "annotation" }]],
      },
    }),
  ],
  server: {
    port: devPort,
    strictPort: true,
    ...(allowedHosts.size > 0 ? { allowedHosts: Array.from(allowedHosts) } : {}),
  },
  build: {
    target: "esnext",
    rollupOptions: {
      input: {
        app: resolve(appRoot, "index.html"),
        overlay: resolve(appRoot, "overlay.html"),
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(appRoot, "src"),
    },
  },
});
