import { describe, expect, test } from "bun:test";
import { DEFAULT_DEN_BASE_URL } from "../src/app/lib/den";
import { parseDebugDeepLinkInput, parseDenAuthDeepLink } from "../src/app/lib/openwork-links";

const GRANT = "one-time-desktop-grant";

describe("parseDenAuthDeepLink", () => {
  test("解析 SeeWayWork 和旧协议登录链接", () => {
    expect(parseDenAuthDeepLink(`foxwork://den-auth?grant=${GRANT}&denBaseUrl=http%3A%2F%2Fden.local`)).toEqual({
      grant: GRANT,
      denBaseUrl: "http://den.local",
    });
    expect(parseDenAuthDeepLink(`openwork://den-auth?grant=${GRANT}`)).toEqual({
      grant: GRANT,
      denBaseUrl: DEFAULT_DEN_BASE_URL,
    });
  });

  test("接受网页回跳地址，但拒绝缺少授权码或无关地址", () => {
    expect(parseDenAuthDeepLink(`http://localhost:3005/den-auth?grant=${GRANT}`)?.grant).toBe(GRANT);
    expect(parseDenAuthDeepLink("foxwork://den-auth?denBaseUrl=http%3A%2F%2Fden.local")).toBeNull();
    expect(parseDenAuthDeepLink(`foxwork://connect?grant=${GRANT}`)).toBeNull();
    expect(parseDenAuthDeepLink("not a url")).toBeNull();
  });

  test("调试输入统一识别登录深链", () => {
    expect(parseDebugDeepLinkInput(`前缀 foxwork://den-auth?grant=${GRANT}`)).toEqual({
      kind: "auth",
      link: { grant: GRANT, denBaseUrl: DEFAULT_DEN_BASE_URL },
    });
  });
});
