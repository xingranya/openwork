import { afterAll, beforeAll, expect, test } from "bun:test";

import {
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

test("首次启动必须先连接公司，再登录，最后才能选择工作区", () => {
  expect(resolveWelcomePrimaryAction("", "signed_out")).toBe("configure_company");
  expect(resolveWelcomePrimaryAction("https://company.foxwork.test", "signed_out")).toBe("sign_in");
  expect(resolveWelcomePrimaryAction("https://company.foxwork.test", "checking")).toBe("wait_for_company");
  expect(resolveWelcomePrimaryAction("https://company.foxwork.test", "unavailable")).toBe("wait_for_company");
  expect(resolveWelcomePrimaryAction("https://company.foxwork.test", "signed_in")).toBe("choose_workspace");
});
