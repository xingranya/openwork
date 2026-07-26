import { describe, expect, test } from "bun:test";

import {
  formatTrendPointTitle,
  formatWeekLabel,
} from "../app/(den)/dashboard/_components/analytics-screen";

describe("Den 用量图表中文提示", () => {
  test("日期不受操作系统语言影响", () => {
    expect(formatWeekLabel("2026-07-13")).toBe("7月13日");
  });

  test("悬停提示使用中文日期和中文结构", () => {
    const title = formatTrendPointTitle("2026-07-13", "已完成", 12);

    expect(title).toBe("7月13日当周 · 已完成：12");
    expect(title).not.toMatch(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i);
  });
});
