import { describe, expect, it } from "vitest";
import { gettingStartedSteps, shouldShowGettingStarted, type GettingStartedFacts } from "./getting-started";

const empty: GettingStartedFacts = { profile: null, promotionCategories: 0, perfCategories: 0, timetableSlots: 0 };
const complete: GettingStartedFacts = {
  profile: { name: "张老师", unit: "某职业技术学院", currentTitleSince: new Date("2021-12-01") },
  promotionCategories: 30,
  perfCategories: 60,
  timetableSlots: 12,
};

const doneKeys = (facts: GettingStartedFacts) => gettingStartedSteps(facts).filter((s) => s.done).map((s) => s.key);

describe("首页「开始使用」", () => {
  it("刚装好什么都没有：三步都没做，显示", () => {
    const steps = gettingStartedSteps(empty);
    expect(steps.map((s) => s.key)).toEqual(["profile", "rules", "timetable"]);
    expect(doneKeys(empty)).toEqual([]);
    expect(shouldShowGettingStarted(steps, false)).toBe(true);
  });

  it("全做完整块消失，不用人点「完成」", () => {
    expect(doneKeys(complete)).toEqual(["profile", "rules", "timetable"]);
    expect(shouldShowGettingStarted(gettingStartedSteps(complete), false)).toBe(false);
  });

  it("档案要有姓名、单位和任现职日期才算填了", () => {
    const base = complete.profile!;
    expect(doneKeys({ ...complete, profile: { ...base, currentTitleSince: null } })).not.toContain("profile");
    expect(doneKeys({ ...complete, profile: { ...base, unit: "  " } })).not.toContain("profile");
  });

  it("两张表缺一张都不算导完", () => {
    expect(doneKeys({ ...complete, perfCategories: 0 })).not.toContain("rules");
    expect(doneKeys({ ...complete, promotionCategories: 0 })).not.toContain("rules");
  });

  it("点了「不再显示」就不显示，哪怕还没做完（这学期没课的人不导课表）", () => {
    expect(shouldShowGettingStarted(gettingStartedSteps({ ...complete, timetableSlots: 0 }), true)).toBe(false);
  });
});
