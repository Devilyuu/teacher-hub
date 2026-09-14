import { describe, expect, it } from "vitest";
import { dateOnly } from "./date";
import {
  calcProjectGap,
  calcRequirementGap,
  type GapProjectInput,
  type GapRequirementInput,
} from "./gap";

/**
 * TODAY 是"当前时刻"（本地），截止日是纯日期（UTC 午夜）——
 * 这正是生产环境的实际形态：new Date() 来自系统，@db.Date 列由 Prisma 给 UTC 午夜。
 * 见 lib/date.ts 对这套口径的说明。
 */
const TODAY = new Date(2026, 6, 26, 14, 30);
const daysFromToday = (n: number) => dateOnly(2026, 7, 26 + n);

function requirement(
  id: string,
  requiredCount: number,
  links: Array<[achievementId: string, isQualified: boolean]>,
  materials: Array<[attachmentId: string, isQualified: boolean]> = [],
): GapRequirementInput {
  return {
    id,
    requiredCount,
    links: links.map(([achievementId, isQualified]) => ({ achievementId, isQualified })),
    materials: materials.map(([attachmentId, isQualified]) => ({ attachmentId, isQualified })),
  };
}

function project(overrides: Partial<GapProjectInput> = {}): GapProjectInput {
  return {
    status: "ONGOING",
    closingDeadline: null,
    requirements: [],
    ...overrides,
  };
}

describe("calcRequirementGap · 单个要求项", () => {
  it("分别统计已达标与在途，缺口是二者之差", () => {
    const result = calcRequirementGap(
      requirement("r1", 2, [
        ["a1", true],
        ["a2", false],
        ["a3", false],
      ]),
    );

    expect(result).toMatchObject({
      requirementId: "r1",
      requiredCount: 2,
      qualifiedCount: 1,
      inProgressCount: 2,
      gap: 1,
    });
  });

  it("达标数超过要求数时缺口是 0，不能为负", () => {
    const result = calcRequirementGap(
      requirement("r1", 1, [
        ["a1", true],
        ["a2", true],
        ["a3", true],
      ]),
    );

    expect(result.qualifiedCount).toBe(3);
    expect(result.gap).toBe(0);
  });

  it("同一成果重复挂到同一要求项只算一次", () => {
    const result = calcRequirementGap(
      requirement("r1", 2, [
        ["a1", true],
        ["a1", true],
      ]),
    );

    expect(result.qualifiedCount).toBe(1);
    expect(result.gap).toBe(1);
  });

  it("要求数为 0 时缺口为 0", () => {
    expect(calcRequirementGap(requirement("r1", 0, [])).gap).toBe(0);
  });

  it("已人工确认的课题材料可以填补结题缺口", () => {
    const result = calcRequirementGap(
      requirement("研究报告", 1, [], [["report-file", true]]),
    );

    expect(result).toMatchObject({
      qualifiedCount: 1,
      inProgressCount: 0,
      gap: 0,
    });
  });

  it("只关联但未确认的课题材料仍算在途", () => {
    const result = calcRequirementGap(
      requirement("研究报告", 1, [], [["report-file", false]]),
    );

    expect(result).toMatchObject({
      qualifiedCount: 0,
      inProgressCount: 1,
      gap: 1,
    });
  });

  it("成果 id 与材料 id 即使同名也按两类资源计算", () => {
    const result = calcRequirementGap(
      requirement("混合要求", 2, [["same-id", true]], [["same-id", true]]),
    );

    expect(result.qualifiedCount).toBe(2);
    expect(result.gap).toBe(0);
  });
});

describe("calcProjectGap · 完成度", () => {
  it("按 Σ requiredCount 与达标数算比例", () => {
    const result = calcProjectGap(
      project({
        requirements: [
          requirement("r1", 2, [
            ["a1", true],
            ["a2", true],
          ]),
          requirement("r2", 2, [["a3", true]]),
        ],
      }),
      TODAY,
    );

    expect(result.totalRequired).toBe(4);
    expect(result.totalQualified).toBe(3);
    expect(result.completionRate).toBe(0.75);
    expect(result.totalGap).toBe(1);
  });

  // ── PRD 第 3 节硬规则之一 ──
  it("同一成果挂到多条要求项时，totalQualified 只计一次", () => {
    const result = calcProjectGap(
      project({
        requirements: [
          requirement("论文2篇", 1, [["同一篇论文", true]]),
          requirement("标志性成果1项", 1, [["同一篇论文", true]]),
        ],
      }),
      TODAY,
    );

    // 两条要求各自都算"有货"，所以各自 gap 为 0
    expect(result.requirements.map((r) => r.gap)).toEqual([0, 0]);
    // 但全课题只有一件成果，完成度不能显示 100%
    expect(result.totalRequired).toBe(2);
    expect(result.totalQualified).toBe(1);
    expect(result.completionRate).toBe(0.5);
  });

  it("同一材料挂到多条要求时全课题只计一次", () => {
    const result = calcProjectGap(
      project({
        requirements: [
          requirement("要求甲", 1, [], [["report-file", true]]),
          requirement("要求乙", 1, [], [["report-file", true]]),
        ],
      }),
      TODAY,
    );

    expect(result.requirements.map((item) => item.gap)).toEqual([0, 0]);
    expect(result.totalQualified).toBe(1);
    expect(result.completionRate).toBe(0.5);
  });

  it("不去重的话会虚高——这里锁死去重后的数值", () => {
    const result = calcProjectGap(
      project({
        requirements: [
          requirement("r1", 2, [
            ["a1", true],
            ["a2", true],
          ]),
          requirement("r2", 2, [
            ["a1", true],
            ["a2", true],
          ]),
        ],
      }),
      TODAY,
    );

    expect(result.totalQualified).toBe(2); // 不是 4
    expect(result.completionRate).toBe(0.5);
  });

  it("达标数超过要求数时，多出来的不计入 totalQualified", () => {
    const result = calcProjectGap(
      project({
        requirements: [
          requirement("r1", 1, [
            ["a1", true],
            ["a2", true],
            ["a3", true],
          ]),
        ],
      }),
      TODAY,
    );

    expect(result.totalRequired).toBe(1);
    expect(result.totalQualified).toBe(1);
    expect(result.completionRate).toBe(1);
  });

  it("结果与要求项顺序无关", () => {
    // 甲(需1)只有 A；乙(需1)有 A 和 B。最优解是甲取 A、乙取 B，共 2 件。
    // 顺序贪心会在"先乙"时把 A 分给乙，导致甲无货，只得 1 件。
    const 甲 = requirement("甲", 1, [["A", true]]);
    const 乙 = requirement("乙", 1, [
      ["A", true],
      ["B", true],
    ]);

    const 正序 = calcProjectGap(project({ requirements: [甲, 乙] }), TODAY);
    const 逆序 = calcProjectGap(project({ requirements: [乙, 甲] }), TODAY);

    expect(正序.totalQualified).toBe(2);
    expect(逆序.totalQualified).toBe(2);
    expect(正序.completionRate).toBe(逆序.completionRate);
  });

  it("未达标的挂接不计入完成度", () => {
    const result = calcProjectGap(
      project({
        requirements: [
          requirement("r1", 2, [
            ["a1", false],
            ["a2", false],
          ]),
        ],
      }),
      TODAY,
    );

    expect(result.totalQualified).toBe(0);
    expect(result.completionRate).toBe(0);
    expect(result.requirements[0].inProgressCount).toBe(2);
  });

  // ── PRD 第 3 节硬规则之二 ──
  it("一条要求都没录时 completionRate 是 null，不是 0", () => {
    const result = calcProjectGap(project({ requirements: [] }), TODAY);

    expect(result.totalRequired).toBe(0);
    expect(result.completionRate).toBeNull();
    expect(result.completionRate).not.toBe(0);
  });

  it("申报期课题不谈完成度", () => {
    const result = calcProjectGap(
      project({
        status: "APPLYING",
        requirements: [requirement("r1", 2, [["a1", true]])],
      }),
      TODAY,
    );

    expect(result.completionRate).toBeNull();
  });
});

describe("calcProjectGap · 重复使用提醒", () => {
  it("列出被多条要求项同时算作达标的成果", () => {
    const result = calcProjectGap(
      project({
        requirements: [
          requirement("r1", 1, [
            ["a1", true],
            ["a2", true],
          ]),
          requirement("r2", 1, [["a1", true]]),
        ],
      }),
      TODAY,
    );

    expect(result.reusedAchievementIds).toEqual(["a1"]);
  });

  it("只挂接未确认达标的不算重复使用", () => {
    const result = calcProjectGap(
      project({
        requirements: [
          requirement("r1", 1, [["a1", true]]),
          requirement("r2", 1, [["a1", false]]),
        ],
      }),
      TODAY,
    );

    expect(result.reusedAchievementIds).toEqual([]);
  });
});

describe("calcProjectGap · 倒计时", () => {
  it("没有结题截止日时 daysLeft 为 null", () => {
    expect(calcProjectGap(project({ closingDeadline: null }), TODAY).daysLeft).toBeNull();
  });

  it("按自然日算天数", () => {
    expect(calcProjectGap(project({ closingDeadline: daysFromToday(67) }), TODAY).daysLeft).toBe(67);
  });

  it("当天到期是 0，逾期为负", () => {
    expect(calcProjectGap(project({ closingDeadline: daysFromToday(0) }), TODAY).daysLeft).toBe(0);
    expect(calcProjectGap(project({ closingDeadline: daysFromToday(-5) }), TODAY).daysLeft).toBe(-5);
  });

  it("在研课题的 displayDaysLeft 取结题截止日", () => {
    const result = calcProjectGap(
      project({
        status: "ONGOING",
        closingDeadline: daysFromToday(67),
        applyDeadline: daysFromToday(3),
      }),
      TODAY,
    );

    expect(result.daysLeft).toBe(67);
    expect(result.applyDaysLeft).toBe(3);
    expect(result.displayDaysLeft).toBe(67);
  });

  it("申报期课题的 displayDaysLeft 取申报截止日", () => {
    const result = calcProjectGap(
      project({
        status: "APPLYING",
        closingDeadline: daysFromToday(67),
        applyDeadline: daysFromToday(3),
      }),
      TODAY,
    );

    expect(result.displayDaysLeft).toBe(3);
  });

  it("没填对应截止日时 displayDaysLeft 为 null", () => {
    expect(
      calcProjectGap(project({ status: "DRAFT", applyDeadline: null }), TODAY).displayDaysLeft,
    ).toBeNull();
  });
});

describe("calcProjectGap · 健康度", () => {
  const 有缺口 = [requirement("r1", 1, [])];

  it("已结题、已终止、已归档一律 GREY，且优先于缺口判定", () => {
    for (const status of ["CLOSED", "TERMINATED"] as const) {
      const result = calcProjectGap(
        project({ status, requirements: 有缺口, closingDeadline: daysFromToday(-100) }),
        TODAY,
      );
      expect(result.health).toBe("GREY");
    }

    const archived = calcProjectGap(
      project({
        status: "ONGOING",
        archivedAt: dateOnly(2020, 1, 1),
        requirements: 有缺口,
        closingDeadline: daysFromToday(-100),
      }),
      TODAY,
    );
    expect(archived.health).toBe("GREY");
  });

  describe("申报期走 applyDeadline", () => {
    const 申报 = (days: number | null) =>
      calcProjectGap(
        project({
          status: "APPLYING",
          applyDeadline: days == null ? null : daysFromToday(days),
        }),
        TODAY,
      ).health;

    it("7 天内 RED", () => {
      expect(申报(7)).toBe("RED");
      expect(申报(0)).toBe("RED");
      expect(申报(-3)).toBe("RED");
    });

    it("8–30 天 ORANGE", () => {
      expect(申报(8)).toBe("ORANGE");
      expect(申报(30)).toBe("ORANGE");
    });

    it("30 天以上 BLUE", () => {
      expect(申报(31)).toBe("BLUE");
      expect(申报(365)).toBe("BLUE");
    });

    it("没填申报截止日时 BLUE", () => {
      expect(申报(null)).toBe("BLUE");
    });

    it("DRAFT 与 APPLYING 同一分支", () => {
      const draft = calcProjectGap(
        project({ status: "DRAFT", applyDeadline: daysFromToday(3) }),
        TODAY,
      );
      expect(draft.health).toBe("RED");
    });
  });

  it("在研但一条要求都没录，是 UNSET 而不是 GREEN", () => {
    const result = calcProjectGap(project({ status: "ONGOING", requirements: [] }), TODAY);

    expect(result.health).toBe("UNSET");
    expect(result.completionRate).toBeNull();
  });

  it("缺口为 0 时 GREEN，不看倒计时", () => {
    const 齐备 = [requirement("r1", 1, [["a1", true]])];

    expect(calcProjectGap(project({ requirements: 齐备 }), TODAY).health).toBe("GREEN");
    expect(
      calcProjectGap(project({ requirements: 齐备, closingDeadline: daysFromToday(1) }), TODAY)
        .health,
    ).toBe("GREEN");
  });

  describe("有缺口时按 closingDeadline 着色", () => {
    const 着色 = (days: number | null) =>
      calcProjectGap(
        project({
          requirements: 有缺口,
          closingDeadline: days == null ? null : daysFromToday(days),
        }),
        TODAY,
      ).health;

    it("超过 90 天 YELLOW", () => {
      expect(着色(91)).toBe("YELLOW");
      expect(着色(365)).toBe("YELLOW");
    });

    it("没填结题截止日 YELLOW", () => {
      expect(着色(null)).toBe("YELLOW");
    });

    it("31–90 天 ORANGE", () => {
      expect(着色(90)).toBe("ORANGE");
      expect(着色(31)).toBe("ORANGE");
    });

    it("30 天以内 RED，逾期也是 RED", () => {
      expect(着色(30)).toBe("RED");
      expect(着色(0)).toBe("RED");
      expect(着色(-60)).toBe("RED");
    });
  });
});

describe("典型场景 · 课题 B（先研究后立项）", () => {
  // 立项通知要求研究报告 1 份，尚未产出；结题材料截止日距今 67 天
  const 课题B = project({
    status: "ONGOING",
    closingDeadline: daysFromToday(67),
    requirements: [requirement("研究报告1份", 1, [])],
  });

  it("显示 研究报告 0/1、剩余 67 天", () => {
    const result = calcProjectGap(课题B, TODAY);

    expect(result.requirements[0]).toMatchObject({ qualifiedCount: 0, requiredCount: 1, gap: 1 });
    expect(result.daysLeft).toBe(67);
    expect(result.completionRate).toBe(0);
  });

  it("健康度是 ORANGE", () => {
    // PRD 第 3 节：gap > 0 且 30 < daysLeft <= 90 → ORANGE，剩 30 天内才转 RED。
    // BUILD_PLAN 原写 RED 有误，2026-07-26 已按 PRD 定案。
    expect(calcProjectGap(课题B, TODAY).health).toBe("ORANGE");
  });
});

describe("典型场景 · 课题 A（结题要求尚未到手）", () => {
  it("要求项尚未到手，完成度显示 — 而不是 0%", () => {
    const result = calcProjectGap(
      project({ status: "ONGOING", closingDeadline: null, requirements: [] }),
      TODAY,
    );

    expect(result.completionRate).toBeNull();
    expect(result.totalRequired).toBe(0);
    expect(result.health).toBe("UNSET");
  });
});
