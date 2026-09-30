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

/**
 * 职称表的年份是申报年度：按 2027 年申报，时间窗算到 2026-12-31，
 * make() 默认的 2026 年正好在窗里。绩效表照旧用成果年度 2026
 */
const DECLARE = 2027;

describe("preflightDeclaration · 纳入判定与导出对齐", () => {
  it("干净数据不产出任何问题", () => {
    const report = preflightDeclaration([make()], DECLARE, "promotion", null);
    expect(report.issues).toEqual([]);
    expect(report.includedCount).toBe(1);
    expect(report.flaggedCount).toBe(0);
  });

  it("绩效表年度不符的既不纳入也不报问题——它属于别的年度，不是毛病", () => {
    const report = preflightDeclaration([make({ year: 2024 })], 2026, "performance", null);
    expect(report.includedCount).toBe(0);
    expect(report.issues).toEqual([]);
  });

  it("没填年度的默认排除，并且被标成可覆盖问题", () => {
    const report = preflightDeclaration([make({ year: null })], DECLARE, "promotion", null);
    expect(report.includedCount).toBe(0);
    expect(report.issues.find((issue) => issue.code === "missingYear")?.scope).toBe("excluded");
  });

  it("未核实成果默认排除，打开覆盖开关后纳入", () => {
    const item = make({ isVerified: false });
    expect(preflightDeclaration([item], DECLARE, "promotion", null).includedCount).toBe(0);
    expect(
      preflightDeclaration([item], DECLARE, "promotion", null, {
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
    const report = preflightDeclaration(items, DECLARE, "promotion", null, {
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
    expect(preflightDeclaration(items, DECLARE, "promotion", null).includedCounts).toEqual({
      safe: 1,
      includeUnverified: 2,
      includeMissingYear: 2,
      includeBoth: 4,
    });
  });

  /** 界面「连同支撑材料打包（N 份）」读的就是它，和包里的文件数、明细表「材料份数」之和一致 */
  it("四种组合各自的支撑材料份数，是纳入那几条的材料份数之和", () => {
    const items = [
      make({ id: "clean", attachmentCount: 2 }),
      make({ id: "unverified", isVerified: false, attachmentCount: 3 }),
      make({ id: "missing-year", year: null, attachmentCount: 1 }),
      make({ id: "both", year: null, isVerified: false, attachmentCount: 0 }),
      // 不在表里的不算
      make({ id: "no-category", promotionCategoryId: null, promotionScore: null, attachmentCount: 9 }),
    ];
    expect(preflightDeclaration(items, DECLARE, "promotion", null).materialCounts).toEqual({
      safe: 2,
      includeUnverified: 5,
      includeMissingYear: 3,
      includeBoth: 6,
    });
  });

  it("职称口径只看职称分类，绩效口径只看绩效分类", () => {
    const onlyPerf = make({ promotionCategoryId: null, promotionScore: null });
    expect(preflightDeclaration([onlyPerf], DECLARE, "promotion", null).includedCount).toBe(0);
    expect(preflightDeclaration([onlyPerf], 2026, "performance", null).includedCount).toBe(1);
  });
});

/**
 * 职称表按申报年度取「任现职以来 → 上一年 12-31」（附件2 说明第 2 条）。
 * 纳入判定必须和 filterForDeclaration 一样（alignment.test.ts 交叉验证）
 */
describe("preflightDeclaration · 职称表的任现职时间窗", () => {
  const since = new Date(Date.UTC(2020, 8, 1));

  it("时间窗里的几年都进表，不只申报年度那一年", () => {
    const items = [2020, 2023, 2026].map((year) => make({ id: `y${year}`, year }));
    expect(preflightDeclaration(items, DECLARE, "promotion", since).includedCount).toBe(3);
  });

  /** 一大批老成果，每次都列一遍就成了噪音，也不会有人以为它们该在表里 */
  it("任现职之前的不进表，也不报问题", () => {
    const report = preflightDeclaration([make({ year: 2019 })], DECLARE, "promotion", since);
    expect(report.includedCount).toBe(0);
    expect(report.issues).toEqual([]);
  });

  /**
   * 申报当年刚出的成果不算是规定，但反直觉：刚挂好指标的东西在表里找不到，
   * 第一反应是没存上。所以报成 excluded，写明留到下一次
   */
  it("申报当年及以后的报成「不在表里」，说明留到下一次", () => {
    const report = preflightDeclaration(
      [make({ id: "now", year: 2027 }), make({ id: "later", year: 2028, isVerified: false })],
      DECLARE,
      "promotion",
      since,
    );
    expect(report.includedCount).toBe(0);
    const issue = report.issues.find((i) => i.code === "afterPromotionWindow");
    expect(issue).toMatchObject({ scope: "excluded", count: 2, label: "2027 年及以后的成果" });
    expect(issue?.hint).toContain("2026-12-31");
    // 超窗的不再重复报成「未核实」——它本来就不属于这张表
    expect(codesOf(report.issues)).not.toContain("unverified");
    expect(report.flaggedCount).toBe(0);
  });

  it("没挂职称指标的超窗成果不报——它本来就进不了职称表", () => {
    const report = preflightDeclaration(
      [make({ year: 2027, promotionCategoryId: null, promotionScore: null })],
      DECLARE,
      "promotion",
      since,
    );
    expect(report.issues).toEqual([]);
  });

  it("绩效表不报超窗", () => {
    const report = preflightDeclaration([make({ year: 2027 })], 2026, "performance", since);
    expect(codesOf(report.issues)).not.toContain("afterPromotionWindow");
  });

  it("档案没填任现职日期时只卡上限：再早的成果也进表", () => {
    expect(
      preflightDeclaration([make({ year: 2008 })], DECLARE, "promotion", null).includedCount,
    ).toBe(1);
  });

  it("缺年度的提示说的是「这张职称表」而不是某一年的表", () => {
    const issue = preflightDeclaration([make({ year: null })], DECLARE, "promotion", since)
      .issues.find((i) => i.code === "missingYear");
    expect(issue?.hint).toContain("这张职称表");
    expect(issue?.hint).not.toContain(`${DECLARE} 年表`);
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
      null,
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
      null,
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
    const report = preflightDeclaration([orphan], DECLARE, "promotion", null);

    expect(report.includedCount).toBe(0);
    const issue = report.issues.find((i) => i.code === "scoreWithoutCategory");
    expect(issue?.scope).toBe("excluded");
    expect(issue?.count).toBe(1);
  });

  it("既没挂分类也没填分的不报——那只是「这条评职称用不上」，是客观事实不是问题", () => {
    const notCounted = make({ promotionCategoryId: null, promotionScore: null });
    const report = preflightDeclaration([notCounted], DECLARE, "promotion", null);
    expect(report.issues).toEqual([]);
  });

  it("漏掉的那条排在所有问题最前面——其他问题是数据脏，这条是根本没进表", () => {
    const report = preflightDeclaration(
      [
        make({ id: "a1", isVerified: false }),
        make({ id: "a2", promotionCategoryId: null, promotionScore: 5 }),
      ],
      DECLARE,
      "promotion",
      null,
    );
    expect(report.issues[0]?.code).toBe("scoreWithoutCategory");
  });
});

describe("preflightDeclaration · 各类问题", () => {
  it("未核实默认标成不在表里", () => {
    const report = preflightDeclaration([make({ isVerified: false })], DECLARE, "promotion", null);
    expect(report.issues.find((issue) => issue.code === "unverified")?.scope).toBe("excluded");
  });

  it("缺分：职称口径看 promotionScore，绩效口径看 declaredScore", () => {
    const noPromoScore = make({ promotionScore: null });
    expect(codesOf(preflightDeclaration([noPromoScore], DECLARE, "promotion", null).issues)).toContain(
      "missingScore",
    );
    // 同一条在绩效口径下分值是齐的，不该报
    expect(codesOf(preflightDeclaration([noPromoScore], 2026, "performance", null).issues)).not.toContain(
      "missingScore",
    );
  });

  it("缺材料", () => {
    const report = preflightDeclaration([make({ attachmentCount: 0 })], DECLARE, "promotion", null);
    expect(codesOf(report.issues)).toContain("missingMaterial");
  });

  it.each(["PLANNED", "SHELVED", "REJECTED"])("状态存疑：%s", (status) => {
    const report = preflightDeclaration([make({ status })], DECLARE, "promotion", null);
    expect(codesOf(report.issues)).toContain("suspiciousStatus");
  });

  /**
   * 「写作中」「已投稿」「外审中」看着也没完成，但过程性申报报的就是在途工作。
   * 一刀切会把正常记录全标成问题，预检就没人看了。
   */
  it.each(["WRITING", "SUBMITTED", "UNDER_REVIEW", "ACCEPTED", "PUBLISHED"])(
    "在途或已完成状态不算问题：%s",
    (status) => {
      const report = preflightDeclaration([make({ status })], DECLARE, "promotion", null);
      expect(codesOf(report.issues)).not.toContain("suspiciousStatus");
    },
  );
});

describe("preflightDeclaration · 计数", () => {
  it("flaggedCount 按成果去重，不是各类问题数相加", () => {
    const messy = make({ isVerified: false, attachmentCount: 0, status: "PLANNED" });
    const report = preflightDeclaration([messy], DECLARE, "promotion", null);

    expect(codesOf(report.issues)).toEqual(["unverified"]);
    expect(report.flaggedCount).toBe(0);
  });

  it("flaggedCount 不含被漏掉的那条——它不在表里，谈不上「表里有问题」", () => {
    const orphan = make({ promotionCategoryId: null, promotionScore: 5 });
    const report = preflightDeclaration([orphan], DECLARE, "promotion", null);
    expect(report.flaggedCount).toBe(0);
  });

  it("样例最多 5 条，且计数是全量而不是样例数", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      make({ id: `a${i}`, title: `成果 ${i}`, isVerified: false }),
    );
    const issue = preflightDeclaration(many, DECLARE, "promotion", null).issues.find(
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

  // ── 2026-09-25 接回成果页时改成跨来源口径 ──

  /** 课题没有核实这一步（导出时恒为已核实），算进来会让进度一开始就是六七成 */
  it("课题本身不算——它没有核实这一步", () => {
    const project = make({
      id: "p1",
      sourceKind: "PROJECT",
      isVerified: true,
      perfCategoryId: null,
      promotionCategoryId: "promo-1",
    });
    expect(verifyProgress([project], 2026).total).toBe(0);
  });

  it("课题的绩效事项要核实，每条事项各算一条", () => {
    const events = [
      make({ id: "p1", sourceKind: "PROJECT_EVENT", sourceId: "e1", isVerified: false, promotionCategoryId: null }),
      make({ id: "p1", sourceKind: "PROJECT_EVENT", sourceId: "e2", isVerified: true, promotionCategoryId: null }),
    ];
    expect(verifyProgress(events, 2026)).toMatchObject({ total: 2, verified: 1, remaining: 1 });
  });

  it("成果和事项的 id 撞了也不会被当成同一条去重", () => {
    const items = [
      make({ sourceKind: "ACHIEVEMENT", sourceId: "x", isVerified: false }),
      make({ sourceKind: "PROJECT_EVENT", sourceId: "x", isVerified: false, promotionCategoryId: null }),
    ];
    expect(verifyProgress(items, 2026).remaining).toBe(2);
  });

  it("2026 年起学校已奖励的：只挂绩效分类的不算，同时挂职称指标的照算", () => {
    const perfOnly = make({ sourceId: "a", schoolRewarded: true, promotionCategoryId: null, isVerified: false });
    const both = make({ sourceId: "b", schoolRewarded: true, isVerified: false });
    expect(verifyProgress([perfOnly, both], 2026).total).toBe(1);
    // 排除规则从 2026 起才有，2025 的照常是候选
    expect(verifyProgress([{ ...perfOnly, year: 2025 }], 2025).total).toBe(1);
  });

  /**
   * 进度按成果年度数。绩效表一年一张，直接对得上；职称表按任现职时间窗跨好几年，
   * 只取它「未核实」里年度是这一年的那几条——g 是 2025 年的，在职称表里但不算 2026 的账
   */
  it("「还剩 N 条」= 这一年绩效表的「未核实」+ 职称表「未核实」里这一年的", () => {
    const items = [
      make({ sourceId: "a", isVerified: false }),
      make({ sourceId: "b", isVerified: false, perfCategoryId: null }),
      make({ sourceId: "c", isVerified: false, promotionCategoryId: null }),
      make({ sourceId: "d", isVerified: true }),
      make({ sourceKind: "PROJECT_EVENT", sourceId: "e", isVerified: false, promotionCategoryId: null }),
      make({ sourceId: "f", isVerified: false, schoolRewarded: true, promotionCategoryId: null }),
      make({ sourceId: "g", isVerified: false, year: 2025 }),
    ];
    const keyOf = (s: { sourceKind: string; sourceId: string }) => `${s.sourceKind}:${s.sourceId}`;
    const yearByKey = new Map(items.map((item) => [keyOf(item), item.year]));
    const unverifiedIn = (kind: "promotion" | "performance") =>
      preflightDeclaration(items, kind === "promotion" ? DECLARE : 2026, kind, null)
        .issues.filter((issue) => issue.code === "unverified")
        .flatMap((issue) => issue.samples.map(keyOf));

    // 职称表确实把 2025 年的 g 也收进去了——不筛年度的话两边就对不上
    expect(unverifiedIn("promotion")).toContain("ACHIEVEMENT:g");
    const fromExport = new Set([
      ...unverifiedIn("promotion").filter((key) => yearByKey.get(key) === 2026),
      ...unverifiedIn("performance"),
    ]);

    expect(verifyProgress(items, 2026).remaining).toBe(fromExport.size);
    expect(fromExport.size).toBe(4);
  });
});
