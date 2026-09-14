import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENT_TYPE_OPTIONS,
  ACHIEVEMENT_USAGE_OPTIONS,
  DECLARE_NATURE_OPTIONS,
  LEVEL_OPTIONS,
  linkableAchievementTypeOptions,
} from "./options";

describe("linkableAchievementTypeOptions · 结题能挂接的成果类型", () => {
  it("每个 AchievementType 都被明确划入或划出，没有漏网的", () => {
    const linkable = new Set(linkableAchievementTypeOptions("VERTICAL").map((o) => o.value));
    // 结题验收不会认这几类：媒体报道、培训讲座、社会服务、指导学生。
    // 到账经费是横向专属，纵向课题这一档同样划出
    const excluded = new Set([
      "FUNDING_RECEIPT",
      "MEDIA_REPORT",
      "TRAINING",
      "SOCIAL_SERVICE",
      "STUDENT_ACHIEVEMENT",
    ]);

    for (const option of ACHIEVEMENT_TYPE_OPTIONS) {
      const decided = linkable.has(option.value) || excluded.has(option.value);
      expect(decided, `${option.value}（${option.label}）既没划入也没划出`).toBe(true);
    }
    expect(linkable.size + excluded.size).toBe(ACHIEVEMENT_TYPE_OPTIONS.length);
  });

  it("横向课题多出「到账经费」一档，文案与成果详情同一套词", () => {
    const horizontal = linkableAchievementTypeOptions("HORIZONTAL");
    expect(horizontal).toContainEqual({ value: "FUNDING_RECEIPT", label: "到账经费" });
    expect(linkableAchievementTypeOptions("VERTICAL").map((o) => o.value)).not.toContain(
      "FUNDING_RECEIPT",
    );
  });

  // 合并成平台前这里叫 PHASE1_*，筛的是"本工具只收结题用得上的成果"，
  // 获奖、指导学生留给绩效系统。那套分工已作废，成果库现在收全部 14 类
  it("成果库本身不再限制类型，14 类全放", () => {
    expect(ACHIEVEMENT_TYPE_OPTIONS).toHaveLength(14);
    expect(ACHIEVEMENT_TYPE_OPTIONS.map((o) => o.value)).toContain("AWARD");
    expect(ACHIEVEMENT_TYPE_OPTIONS.map((o) => o.value)).toContain("STUDENT_ACHIEVEMENT");
  });

  it("获奖能挂接——立项文件里「获省级以上奖项」是常见结题条件", () => {
    expect(linkableAchievementTypeOptions("VERTICAL").map((o) => o.value)).toContain("AWARD");
  });
});

describe("台账新增的两个枚举", () => {
  it("申报性质只有过程性 / 成果性两档", () => {
    expect(DECLARE_NATURE_OPTIONS.map((o) => o.value)).toEqual(["PROCESS", "RESULT"]);
  });

  it("用途三档，与学校口径分类、AchievementType 各管各的", () => {
    expect(ACHIEVEMENT_USAGE_OPTIONS.map((o) => o.value)).toEqual([
      "PERFORMANCE",
      "PROMOTION",
      "PROJECT_CLOSING",
    ]);
  });
});

describe("LEVEL_OPTIONS", () => {
  // 线上绩效库的 level 实际用到 国家级/省级/市级/校级/学院级。
  // DISTRICT 是行政区（市辖区、县级区等）不是院系，接不住"学院级"
  it("有学院级，且排在校级之后", () => {
    const values = LEVEL_OPTIONS.map((o) => o.value);
    expect(values).toContain("COLLEGE");
    expect(values.indexOf("COLLEGE")).toBe(values.indexOf("SCHOOL") + 1);
  });

  it("待确认必须保留——存量里有不少记录级别未核实", () => {
    expect(LEVEL_OPTIONS.map((o) => o.value)).toContain("UNRATED");
  });
});
