import { expect, test } from "bun:test";
import { getDesktopGrant } from "../app/(den)/_lib/desktop-handoff";

test("extracts a one-time grant from an OpenWork desktop handoff", () => {
  expect(
    getDesktopGrant(
      "foxwork://den-auth?grant=one-time-code&baseUrl=https%3A%2F%2Fapi.example.test"
    )
  ).toBe("one-time-code");
});

test("rejects missing and malformed desktop handoffs", () => {
  expect(
    getDesktopGrant(
      "foxwork://den-auth?baseUrl=https%3A%2F%2Fapi.example.test"
    )
  ).toBeNull();
  expect(getDesktopGrant("not a url")).toBeNull();
  expect(getDesktopGrant(null)).toBeNull();
});

test("兼容 FoxWork、旧协议和网页回跳链接", () => {
  expect(
    getDesktopGrant("foxwork://den-auth?grant=foxwork-grant&denBaseUrl=http%3A%2F%2Fden.local%2Fapi%2Fden")
  ).toBe("foxwork-grant");
  expect(getDesktopGrant("openwork://den-auth?grant=legacy-grant")).toBe("legacy-grant");
  expect(getDesktopGrant("http://localhost:3005/den-auth?grant=browser-grant")).toBe("browser-grant");
});
