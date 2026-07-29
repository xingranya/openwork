import { afterAll, beforeAll, expect, test } from "bun:test";

import {
  createDenClient,
  DenApiError,
  readDenBootstrapConfig,
  setDenBootstrapConfig,
} from "../src/app/lib/den";
import { saveControlPlaneUrl } from "../src/react-app/domains/settings/cloud/control-plane-url";
import { resolveWelcomePrimaryAction } from "../src/react-app/shell/welcome-route";

let originalBootstrap: ReturnType<typeof readDenBootstrapConfig>;

beforeAll(() => {
  originalBootstrap = readDenBootstrapConfig();
});

afterAll(async () => {
  await setDenBootstrapConfig(originalBootstrap);
});

test("公司地址探测失败时不得覆盖已经保存的服务器", async () => {
  await setDenBootstrapConfig({
    baseUrl: "https://existing.foxwork.test",
    requireSignin: false,
  });

  await expect(saveControlPlaneUrl("https://offline.foxwork.test", {
    probe: async () => {
      throw new Error("offline");
    },
  })).rejects.toThrow("offline");

  expect(readDenBootstrapConfig().baseUrl).toBe("https://existing.foxwork.test");
});

test("公司地址只有通过 Den 连通性检查后才会保存", async () => {
  let probedApiBaseUrl = "";
  const persisted = await saveControlPlaneUrl("https://company.foxwork.test/api/den", {
    probe: async (resolved) => {
      probedApiBaseUrl = resolved.apiBaseUrl;
    },
  });

  expect(probedApiBaseUrl).toBe("https://company.foxwork.test/api/den");
  expect(persisted?.baseUrl).toBe("https://company.foxwork.test");
  expect(readDenBootstrapConfig().baseUrl).toBe("https://company.foxwork.test");
});

test("首次桌面探测遇到短暂网络错误时会重试并保存公司地址", async () => {
  let attempts = 0;

  const persisted = await saveControlPlaneUrl("https://company.foxwork.test", {
    probe: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new DenApiError(0, "network_error", "无法连接公司服务，请检查网络后重试。");
      }
    },
  });

  expect(attempts).toBe(2);
  expect(persisted?.baseUrl).toBe("https://company.foxwork.test");
  expect(readDenBootstrapConfig().baseUrl).toBe("https://company.foxwork.test");
});

test("系统代理无法连接公司服务时给出可执行的中文提示", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("net::ERR_PROXY_CONNECTION_FAILED");
  };

  try {
    await expect(
      createDenClient({ baseUrl: "https://company.foxwork.test" }).getAppVersionMetadata(),
    ).rejects.toThrow("系统代理");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("桌面首次连接通过主进程访问公司服务，不依赖渲染器跨域请求", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const values = new Map<string, string>();
  let bootstrap = {
    baseUrl: "https://existing.foxwork.test",
    requireSignin: false,
  };
  const desktopRequests: string[] = [];

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
        key: (index: number) => Array.from(values.keys())[index] ?? null,
        get length() {
          return values.size;
        },
      },
      dispatchEvent: () => true,
      setTimeout,
      __OPENWORK_ELECTRON__: {
        invokeDesktop: async (command: string, ...args: unknown[]) => {
          if (command === "__fetch") {
            desktopRequests.push(String(args[0]));
            return {
              status: 200,
              statusText: "OK",
              headers: [["content-type", "application/json"]],
              body: JSON.stringify({
                latestAppVersion: "0.18.20",
                publishedDesktopVersions: ["0.18.20"],
              }),
            };
          }
          if (command === "setDesktopBootstrapConfig") {
            const next = args[0];
            if (!next || typeof next !== "object") {
              throw new Error("缺少桌面启动配置");
            }
            const baseUrl = Reflect.get(next, "baseUrl");
            const requireSignin = Reflect.get(next, "requireSignin");
            if (typeof baseUrl !== "string" || typeof requireSignin !== "boolean") {
              throw new Error("桌面启动配置无效");
            }
            bootstrap = { baseUrl, requireSignin };
            return bootstrap;
          }
          throw new Error(`Unexpected desktop command: ${command}`);
        },
      },
    },
  });
  globalThis.fetch = async () => {
    throw new Error("渲染器不应直接请求公司服务");
  };

  try {
    const persisted = await saveControlPlaneUrl("https://fox.xingranya.cn");

    expect(desktopRequests).toEqual(["https://fox.xingranya.cn/api/den/v1/app-version"]);
    expect(persisted?.baseUrl).toBe("https://fox.xingranya.cn");
    expect(bootstrap.baseUrl).toBe("https://fox.xingranya.cn");
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
});

test("首次启动必须先连接公司，再登录，最后才能选择工作区", () => {
  expect(resolveWelcomePrimaryAction("", "signed_out")).toBe("configure_company");
  expect(resolveWelcomePrimaryAction("https://company.foxwork.test", "signed_out")).toBe("sign_in");
  expect(resolveWelcomePrimaryAction("https://company.foxwork.test", "checking")).toBe("wait_for_company");
  expect(resolveWelcomePrimaryAction("https://company.foxwork.test", "unavailable")).toBe("wait_for_company");
  expect(resolveWelcomePrimaryAction("https://company.foxwork.test", "signed_in")).toBe("choose_workspace");
});
