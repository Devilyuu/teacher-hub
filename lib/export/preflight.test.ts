import { describe, expect, it } from "vitest";
import { preflightDeclaration, verifyProgress, type PreflightAchievement } from "./preflight";

function make(overrides: Partial<PreflightAchievement> = {}): PreflightAchievement {
  const sourceId = overrides.sourceId ?? overrides.id ?? "a1";
  return {
    id: overrides.id ?? "a1",
    sourceKind: "ACHIEVEMENT",
    sourceId,
    href: `/achievements/${sourceId}`,
    schoolRewarded: false,
    title: overrides.title ?? "某篇论文",
    year: 2026,
    isVerified: true,
    status: "PUBLISHED",
    attachmentCount: 1,
    perfCategoryId: "perf-1",
    promotionCategoryId: "promo-1",
    declaredScore: 3,
    promotionScore: 2,
    ...overrides,
  };
}

const codesOf = (items: { code: string }[]) => items.map((i) => i.code);

describe("preflightDeclaration · 纳入判定与导出对齐", () => {
  it("干净数据不产出任何问题", () => {
    const report = preflightDeclaration([make()], 2026, "promotion");
    expect(report.issues).toEqual([]);
    expect(report.includedCount).toBe(1);
    expect(report.flaggedCount).toBe(0);
  });

  it("年度不符的既不纳入也不报问题——它属于别的年度，不是毛病", () => {
    const report = preflightDeclaration([make({ year: 2024 })], 2026, "promotion");
    expect(report.includedCount).toBe(0);
    expect(report.issues).toEqual([]);
  });

  it("没填年度的默认排除，并且被标成可覆盖问题", () => {
    const report = preflightDeclaration([make({ year: null })], 2026, "promotion");
    expect(report.includedCount).toBe(0);
    expect(report.issues.find((issue) => issue.code === "missingYear")?.scope).toBe("excluded");
  });

  it("未核实成果默认排除，打开覆盖开关后纳入", () => {
    const item = make({ isVerified: false });
    expect(preflightDeclaration([item], 2026, "promotion").includedCount).toBe(0);
    expect(
      preflightDeclaration([item], 2026, "promotion", {
        includeUnverified: true,
      }).includedCount,
    ).toBe(1);
  });

  it("两个覆盖开关与导出筛选逐条一致", () => {
    const items = [
      make({ id: "clean" }),
      make({ id: "unverified", isVerified: false }),
      make({ id: "missing-year", year: null }),
      make({ id: "both", year: null, isVerified: false }),
    ];
    const report = preflightDeclaration(items, 2026, "promotion", {
      includeUnverified: true,
      includeMissingYear: true,
    });
    expect(report.includedCount).toBe(4);
  });

  it("给界面四种开关组合的精确最终条数，双重问题不会虚增单开关结果", () => {
    const items = [
      make({ id: "clean" }),
      make({ id: "unverified", isVerified: false }),
      make({ id: "missing-year", year: null }),
      make({ id: "both", year: null, isVerified: false }),
    ];
    expect(preflightDeclaration(items, 2026, "promotion").includedCounts).toEqual({
      safe: 1,
      includeUnverified: 2,
      includeMissingYear: 2,
      includeBoth: 4,
    });
  });

  it("职称口径只看职称分类，绩效口径只看绩效分类", () => {
    const onlyPerf = make({ promotionCategoryId: null, promotionScore: null });
    expect(preflightDeclaration([onlyPerf], 2026, "promotion").includedCount).toBe(0);
    expect(preflightDeclaration([onlyPerf], 2026, "performance").includedCount).toBe(1);
  });
});

describe("preflightDeclaration · 被漏掉的记录", () => {
  it("2026 年绩效预检把学校已奖励对象列为不可覆盖的排除项并给可信原对象地址", () => {
    const report = preflightDeclaration(
      [
        make({
          id: "rewarded",
          sourceKind: "PROJECT_EVENT",
          sourceId: "event-1",
          href: "/projects/project-1",
          schoolRewarded: true,
        }),
      ],
      2026,
      "performance",
      { includeUnverified: true, includeMissingYear: true },
    );

    expect(report.includedCount).toBe(0);
    expect(report.issues.find((issue) => issue.code === "schoolRewarded")).toMatchObject({
      scope: "excluded",
      samples: [
        {
          sourceKind: "PROJECT_EVENT",
          sourceId: "event-1",
          href: "/projects/project-1",
        },
      ],
    });
  });

  it("2025 年绩效预检不按新规则排除学校奖励", () => {
    const report = preflightDeclaration(
      [make({ year: 2025, schoolRewarded: true })],
      2025,
      "performance",
    );
    expect(report.includedCount).toBe(1);
    expect(codesOf(report.issues)).not.toContain("schoolRewarded");
  });

  /**
   * 填分不等于挂分类。口径过滤只看 categoryId，完全不看分值——
   * 用户以为「设了职称分数」就算数了，界面却一声不吭。
   * 这是唯一一条 scope=excluded 的问题：东西压根没进表。
   */
  it("填了分却没挂分类的，报成 excluded 而不是 included", () => {
    const orphan = make({ promotionCategoryId: null, promotionScore: 5 });
    const report = preflightDeclaration([orphan], 2026, "promotion");

    expect(report.includedCount).toBe(0);
    const issue = report.issues.find((i) => i.code === "scoreWithoutCategory");
    expect(issue?.scope).toBe("excluded");
    expect(issue?.count).toBe(1);
  });

  it("既没挂分类也没填分的不报——那只是「这条评职称用不上」，是客观事实不是问题", () => {
    const notCounted = make({ promotionCategoryId: null, promotionScore: null });
    const report = preflightDeclaration([notCounted], 2026, "promotion");
    expect(report.issues).toEqual([]);
  });

  it("漏掉的那条排在所有问题最前面——其他问题是数据脏，这条是根本没进表", () => {
    const report = preflightDeclaration(
      [
        make({ id: "a1", isVerified: false }),
        make({ id: "a2", promotionCategoryId: null, promotionScore: 5 }),
      ],
      2026,
      "promotion",
    );
    expect(report.issues[0]?.code).toBe("scoreWithoutCategory");
  });
});

describe("preflightDeclaration · 各类问题", () => {
  it("未核实默认标成不在表里", () => {
    const report = preflightDeclaration([make({ isVerified: false })], 2026, "promotion");
    expect(report.issues.find((issue) => issue.code === "unverified")?.scope).toBe("excluded");
  });

  it("缺分：职称口径看 promotionScore，绩效口径看 declaredScore", () => {
    const noPromoScore = make({ promotionScore: null });
    expect(codesOf(preflightDeclaration([noPromoScore], 2026, "promotion").issues)).toContain(
      "missingScore",
    );
    // 同一条在绩效口径下分值是齐的，不该报
    expect(codesOf(preflightDeclaration([noPromoScore], 2026, "performance").issues)).not.toContain(
      "missingScore",
    );
  });

  it("缺材料", () => {
    const report = preflightDeclaration([make({ attachmentCount: 0 })], 2026, "promotion");
    expect(codesOf(report.issues)).toContain("missingMaterial");
  });

  it.each(["PLANNED", "SHELVED", "REJECTED"])("状态存疑：%s", (status) => {
    const report = preflightDeclaration([make({ status })], 2026, "promotion");
    expect(codesOf(report.issues)).toContain("suspiciousStatus");
  });

  /**
   * 「写作中」「已投稿」「外审中」看着也没完成，但过程性申报报的就是在途工作。
   * 一刀切会把正常记录全标成问题，预检就没人看了。
   */
  it.each(["WRITING", "SUBMITTED", "UNDER_REVIEW", "ACCEPTED", "PUBLISHED"])(
    "在途或已完成状态不算问题：%s",
    (status) => {
      const report = preflightDeclaration([make({ status })], 2026, "promotion");
      expect(codesOf(report.issues)).not.toContain("suspiciousStatus");
    },
  );
});

describe("preflightDeclaration · 计数", () => {
  it("flaggedCount 按成果去重，不是各类问题数相加", () => {
    const messy = make({ isVerified: false, attachmentCount: 0, status: "PLANNED" });
    const report = preflightDeclaration([messy], 2026, "promotion");

    expect(codesOf(report.issues)).toEqual(["unverified"]);
    expect(report.flaggedCount).toBe(0);
  });

  it("flaggedCount 不含被漏掉的那条——它不在表里，谈不上「表里有问题」", () => {
    const orphan = make({ promotionCategoryId: null, promotionScore: 5 });
    const report = preflightDeclaration([orphan], 2026, "promotion");
    expect(report.flaggedCount).toBe(0);
  });

  it("样例最多 5 条，且计数是全量而不是样例数", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      make({ id: `a${i}`, title: `成果 ${i}`, isVerified: false }),
    );
    const issue = preflightDeclaration(many, 2026, "promotion").issues.find(
      (i) => i.code === "unverified",
    );

    expect(issue?.count).toBe(9);
    expect(issue?.samples).toHaveLength(5);
    expect(issue?.samples[0]).toEqual({
      sourceKind: "ACHIEVEMENT",
      sourceId: "a0",
      href: "/achievements/a0",
      title: "成果 0",
    });
  });
});

describe("verifyProgress", () => {
  it("统计目标年度候选的核实进度", () => {
    const items = [
      make({ id: "a", isVerified: true }),
      make({ id: "b", isVerified: false }),
      make({ id: "c", isVerified: false }),
      make({ id: "d", isVerified: false }),
    ];
    expect(verifyProgress(items, 2026)).toEqual({
      year: 2026,
      total: 4,
      verified: 1,
      remaining: 3,
      percent: 25,
    });
  });

  it("别的年度不计入", () => {
    const items = [make({ id: "a", year: 2024 }), make({ id: "b", year: 2026 })];
    expect(verifyProgress(items, 2026).total).toBe(1);
  });

  /** 治理进度只看目标年度精确匹配，缺年度的另列问题，不污染任何年度 */
  it("没填年度的不算进目标年度候选", () => {
    expect(verifyProgress([make({ year: null })], 2026).total).toBe(0);
  });

  /** 两个口径合起来去重——同时挂绩效小类和职称指标的只算一条 */
  it("两个口径都挂的只算一条", () => {
    const both = make({ perfCategoryId: "p1", promotionCategoryId: "q1" });
    expect(verifyProgress([both], 2026).total).toBe(1);
  });

  it("两边都没挂分类的不算候选——它进不了任何一张申报表", () => {
    const orphan = make({ perfCategoryId: null, promotionCategoryId: null });
    expect(verifyProgress([orphan], 2026).total).toBe(0);
  });

  /** 「无事可做」不该显示成 0%，那会让人以为一点没干 */
  it("没有候选时算 100%", () => {
    expect(verifyProgress([], 2026)).toMatchObject({ total: 0, percent: 100 });
  });

  it("全部核实完是 100%", () => {
    expect(verifyProgress([make({ isVerified: true })], 2026).percent).toBe(100);
  });
});
