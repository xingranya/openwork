import { describe, expect, test } from "bun:test";

import {
  DEFAULT_ANALYTICS_ENABLED,
  resolveAnalyticsPreference,
  resolvePosthogSetting,
} from "../src/app/lib/analytics-key";

describe("analytics-key", () => {
  test("keeps analytics disabled by default", () => {
    expect(DEFAULT_ANALYTICS_ENABLED).toBe(false);
  });

  test("requires an explicit setting in every build", () => {
    expect(resolvePosthogSetting(undefined)).toBe("");
    expect(resolvePosthogSetting(null)).toBe("");
  });

  test("treats an explicit blank as disabled", () => {
    expect(resolvePosthogSetting("")).toBe("");
  });

  test("trims whitespace to disabled", () => {
    expect(resolvePosthogSetting("  ")).toBe("");
  });

  test("uses an explicitly configured value", () => {
    expect(resolvePosthogSetting("  explicit-value  ")).toBe("explicit-value");
  });

  test("requires an explicit boolean opt-in", () => {
    expect(resolveAnalyticsPreference(null)).toBe(false);
    expect(resolveAnalyticsPreference("{}")).toBe(false);
    expect(resolveAnalyticsPreference('{"analyticsEnabled":false}')).toBe(false);
    expect(resolveAnalyticsPreference('{"analyticsEnabled":"true"}')).toBe(false);
    expect(resolveAnalyticsPreference('{"analyticsEnabled":true}')).toBe(true);
  });

  test("fails closed for a damaged preference", () => {
    expect(resolveAnalyticsPreference("not-json")).toBe(false);
  });
});
