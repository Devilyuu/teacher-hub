import { describe, expect, it } from "vitest";
import { emphasizedStat, type HomeStatValues } from "@/lib/home-stats";

const base: HomeStatValues = { dueToday: 0, overdue: 0, weekMeetings: 0, dueSoon: 0 };

describe("emphasizedStat", () => {
  it("有逾期时强调逾期，哪怕今天也有到期的", () => {
    expect(emphasizedStat({ ...base, overdue: 1, dueToday: 5 })).toBe("overdue");
  });

  it("没有逾期时才轮到今日到期", () => {
    expect(emphasizedStat({ ...base, dueToday: 3 })).toBe("dueToday");
  });

  it("两样都是 0 时谁也不强调——不许把 0 涂成全屏最重的元素", () => {
    expect(emphasizedStat(base)).toBeNull();
    expect(emphasizedStat({ ...base, weekMeetings: 4, dueSoon: 2 })).toBeNull();
  });

  it("本周会议和临近到期再多也不抢强调位", () => {
    expect(emphasizedStat({ dueToday: 0, overdue: 0, weekMeetings: 9, dueSoon: 9 })).toBeNull();
  });
});
