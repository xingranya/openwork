import { afterEach, describe, expect, test } from "bun:test";

import { createDenClient, DenApiError, getDenErrorMessage } from "../src/app/lib/den";

const originalFetch = globalThis.fetch;

function setFetch(fetchImpl: typeof fetch) {
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: fetchImpl,
  });
}

afterEach(() => {
  setFetch(originalFetch);
});

describe("Den sign-out", () => {
  test("unknown English and HTML server errors use a Chinese fallback", () => {
    expect(getDenErrorMessage(
      { message: "The upstream service failed unexpectedly." },
      "加载公司信息失败，请重试。",
    )).toBe("加载公司信息失败，请重试。");
    expect(getDenErrorMessage(
      "<!doctype html><html><body>Bad Gateway</body></html>",
      "登录失败，请重试。",
    )).toBe("登录失败，请重试。 公司服务返回了异常页面。");
    expect(getDenErrorMessage(
      { message: "Unexpected failure.", error: "permission_denied" },
      "操作失败，请重试。",
    )).toBe("当前账号没有执行此操作的权限。");
  });

  test("resolves only after the server confirms sign-out", async () => {
    const requests: Array<{ url: string; method: string; authorization: string | null }> = [];
    setFetch(async (input, init) => {
      const headers = new Headers(init?.headers);
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        authorization: headers.get("authorization"),
      });
      return new Response(null, { status: 204 });
    });

    await expect(
      createDenClient({ baseUrl: "https://den.test", token: "tok_test" }).signOut(),
    ).resolves.toBeUndefined();
    expect(requests).toEqual([
      {
        url: "https://den.test/api/auth/sign-out",
        method: "POST",
        authorization: "Bearer tok_test",
      },
    ]);
  });

  test("rejects a non-success response so local credentials can be retained", async () => {
    setFetch(async () =>
      new Response(JSON.stringify({ error: "sign_out_failed", message: "Try again." }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = createDenClient({ baseUrl: "https://den.test", token: "tok_test" }).signOut();
    await expect(result).rejects.toBeInstanceOf(DenApiError);
    await expect(result).rejects.toMatchObject({ status: 503, code: "sign_out_failed" });
    await expect(result).rejects.toThrow("公司服务请求失败（503）。");
  });

  test("translates known server errors before they reach the interface", async () => {
    setFetch(async () =>
      new Response(JSON.stringify({ error: "permission_denied", message: "Permission denied." }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      createDenClient({ baseUrl: "https://den.test", token: "tok_test" }).signOut(),
    ).rejects.toThrow("当前账号没有执行此操作的权限。");
  });

  test("rejects a network failure so the user can retry", async () => {
    setFetch(async () => {
      throw new TypeError("Failed to fetch");
    });

    await expect(
      createDenClient({ baseUrl: "https://den.test", token: "tok_test" }).signOut(),
    ).rejects.toThrow("无法连接公司服务，请检查网络后重试。");
  });
});
