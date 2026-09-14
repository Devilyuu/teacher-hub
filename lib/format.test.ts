import { describe, expect, it } from "vitest";
import { formatFileSize, formatTimestampDate } from "./format";

describe("formatFileSize", () => {
  it("按量级切换单位", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("formatTimestampDate · 时间戳按本地时区取日期", () => {
  // 两个时刻都用本地构造函数生成，读出来必须是同一个日历日。
  // 这正是 toISOString().slice(0,10) 会挂的地方：东八区的凌晨会退到前一天，
  // 西半球的深夜会跳到后一天
  it("凌晨不退到前一天", () => {
    expect(formatTimestampDate(new Date(2026, 6, 27, 3, 0))).toBe("2026-07-27");
  });

  it("深夜不跳到后一天", () => {
    expect(formatTimestampDate(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });

  it("月份和日补零", () => {
    expect(formatTimestampDate(new Date(2026, 0, 1, 12, 0))).toBe("2026-01-01");
  });
});
