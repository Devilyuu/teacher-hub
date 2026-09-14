import { describe, expect, it } from "vitest";
import { compareIndicatorCode } from "@/lib/promotion";
import {
  buildPerformancePackage,
  buildPromotionPackage,
  filterForDeclaration,
  type ExportableAchievement,
} from "./declaration";


function item(over: Partial<ExportableAchievement> = {}): ExportableAchievement {
  const sourceId = over.sourceId ?? over.id ?? "a1";
  return {
    id: "a1",
    sourceKind: "ACHIEVEMENT",
    sourceId,
    href: `/achievements/${sourceId}`,
    schoolRewarded: false,
    title: "某某论文",
    year: 2026,
    isVerified: true,
    level: "省级",
    type: "论文",
    ownerRole: "第一作者",
    authorPosition: 1,
    dateText: null,
    attachmentCount: 1,
    perfCategory: { majorCategory: "科研与社会服务工作", minorCategory: "普通期刊发表" },
    declaredScore: 5,
    promotionCategory: { code: "5.1", majorIndicator: "科研成果及业绩", minorIndicator: "论文" },
    promotionScore: 2,
    ...over,
  };
}

/**
 * 两套包是两套坐标系。同一条成果可能同时进两个包——
 * 论文、教材、专利两边都算分，那不是重复，是各占各的格。
 */
describe("buildPromotionPackage", () => {
  it("课题在职称导出中只占一行并保留来源身份", () => {
    const pkg = buildPromotionPackage(
      [
        item({
          id: "project-1",
          sourceKind: "PROJECT",
          sourceId: "project-1",
          href: "/projects/project-1",
          title: "省级课题",
          type: "课题",
        }),
      ],
      2026,
      compareIndicatorCode,
    );

    expect(pkg.groups.flatMap((group) => group.rows)).toMatchObject([
      { sourceKind: "PROJECT", sourceId: "project-1", title: "省级课题" },
    ]);
  });

  it("只收挂了职称二级指标的", () => {
    const pkg = buildPromotionPackage(
      [item({ id: "a" }), item({ id: "b", promotionCategory: null })],
      2026,
      compareIndicatorCode,
    );
    expect(pkg.groups).toHaveLength(1);
    expect(pkg.groups[0].rows).toHaveLength(1);
    expect(pkg.groups[0].rows[0].sourceId).toBe("a");
  });

  it("用 promotionScore 不是 declaredScore——两套口径的分不能互相赋值", () => {
    const pkg = buildPromotionPackage(
      [item({ promotionScore: 2, declaredScore: 15 })],
      2026,
      compareIndicatorCode,
    );
    expect(pkg.total).toBe(2);
  });

  // 申报表就是按编号印的，4.10 必须排在 4.5 之后
  it("分组按指标编号排，不按字符串", () => {
    const pkg = buildPromotionPackage(
      [
        item({ id: "a", promotionCategory: { code: "4.10", majorIndicator: "教育教学", minorIndicator: "甲" } }),
        item({ id: "b", promotionCategory: { code: "4.5", majorIndicator: "教育教学", minorIndicator: "乙" } }),
      ],
      2026,
      compareIndicatorCode,
    );
    expect(pkg.groups.map((g) => g.key)).toEqual(["4.5", "4.10"]);
  });

  it("同一指标下的多条归到一组并小计", () => {
    const pkg = buildPromotionPackage(
      [item({ id: "a", promotionScore: 2 }), item({ id: "b", promotionScore: 3 })],
      2026,
      compareIndicatorCode,
    );
    expect(pkg.groups).toHaveLength(1);
    expect(pkg.groups[0].subtotal).toBe(5);
    expect(pkg.total).toBe(5);
  });

  /**
   * 序号要和材料目录、ZIP 里的文件名一一对应，所以必须**按最终表格顺序**
   * 从 1 连续编号。
   *
   * 这里故意把输入顺序和输出顺序反过来（先给 5.2 再给 5.1，输出要 5.1 在前）：
   * 早先的实现在分组时就编号、排序后不重编，实测第一条印出来是 9 号。
   */
  it("材料序号按最终顺序从 1 连续编，不是输入顺序", () => {
    const pkg = buildPromotionPackage(
      [
        item({ id: "b", promotionCategory: { code: "5.2", majorIndicator: "科研", minorIndicator: "课题" } }),
        item({ id: "a", promotionCategory: { code: "5.1", majorIndicator: "科研", minorIndicator: "论文" } }),
      ],
      2026,
      compareIndicatorCode,
    );
    const rows = pkg.groups.flatMap((g) => g.rows);
    expect(rows.map((r) => r.index)).toEqual([1, 2]);
    // 排在第 1 的是 5.1 那条，尽管它是后传进来的
    expect(rows[0].sourceId).toBe("a");
  });

  it("绩效包同样从 1 连续编——它按条数降序重排，更容易错位", () => {
    const rows = buildPerformancePackage(
      [
        item({ id: "x", perfCategory: { majorCategory: "教学", minorCategory: "只有一条" } }),
        item({ id: "y", perfCategory: { majorCategory: "科研", minorCategory: "有两条" } }),
        item({ id: "z", perfCategory: { majorCategory: "科研", minorCategory: "有两条" } }),
      ],
      2026,
    ).groups.flatMap((g) => g.rows);
    expect(rows.map((r) => r.index)).toEqual([1, 2, 3]);
    // 条数多的分组排前面，所以 y、z 在 x 之前
    expect(rows.map((r) => r.sourceId)).toEqual(["y", "z", "x"]);
  });

  // 申报时缺材料的要先补，这个数就是提醒
  it("数出有分但没附件的条数", () => {
    const pkg = buildPromotionPackage(
      [item({ id: "a", attachmentCount: 0 }), item({ id: "b", attachmentCount: 2 })],
      2026,
      compareIndicatorCode,
    );
    expect(pkg.missingMaterialCount).toBe(1);
  });

  it("排名写进本人角色——第 1 作者和第 2 作者分值差很多", () => {
    const pkg = buildPromotionPackage(
      [item({ ownerRole: "第一作者", authorPosition: 2 })],
      2026,
      compareIndicatorCode,
    );
    expect(pkg.groups[0].rows[0].ownerRole).toBe("第一作者（第 2）");
  });

  it("没填分的当 0 计入小计，但仍然列出来", () => {
    const pkg = buildPromotionPackage([item({ promotionScore: null })], 2026, compareIndicatorCode);
    expect(pkg.groups[0].rows).toHaveLength(1);
    expect(pkg.groups[0].subtotal).toBe(0);
    expect(pkg.groups[0].rows[0].score).toBeNull();
  });
});

describe("buildPerformancePackage", () => {
  it("同一课题的两个绩效事项按两个事实分别导出", () => {
    const pkg = buildPerformancePackage(
      [
        item({
          id: "event-apply",
          sourceKind: "PROJECT_EVENT",
          sourceId: "event-apply",
          href: "/projects/project-1",
          title: "省级课题 · 申报",
        }),
        item({
          id: "event-closeout",
          sourceKind: "PROJECT_EVENT",
          sourceId: "event-closeout",
          href: "/projects/project-1",
          title: "省级课题 · 结题",
        }),
      ],
      2026,
    );

    expect(pkg.groups.flatMap((group) => group.rows)).toHaveLength(2);
    expect(pkg.groups.flatMap((group) => group.rows).map((row) => row.sourceId)).toEqual([
      "event-apply",
      "event-closeout",
    ]);
  });

  it("只收挂了绩效小类的，用 declaredScore", () => {
    const pkg = buildPerformancePackage(
      [item({ declaredScore: 15, promotionScore: 2 }), item({ id: "b", perfCategory: null })],
      2026,
    );
    expect(pkg.groups).toHaveLength(1);
    expect(pkg.total).toBe(15);
  });

  it("按「大类 / 小类」分组", () => {
    const pkg = buildPerformancePackage(
      [
        item({ id: "a", perfCategory: { majorCategory: "科研与社会服务工作", minorCategory: "纵向课题（教科研）" } }),
        item({ id: "b", perfCategory: { majorCategory: "科研与社会服务工作", minorCategory: "普通期刊发表" } }),
      ],
      2026,
    );
    expect(pkg.groups).toHaveLength(2);
    expect(pkg.groups.every((g) => g.parent === "科研与社会服务工作")).toBe(true);
  });

  it("条数多的分组排前面", () => {
    const pkg = buildPerformancePackage(
      [
        item({ id: "a", perfCategory: { majorCategory: "教学", minorCategory: "少" } }),
        item({ id: "b", perfCategory: { majorCategory: "科研", minorCategory: "多" } }),
        item({ id: "c", perfCategory: { majorCategory: "科研", minorCategory: "多" } }),
      ],
      2026,
    );
    expect(pkg.groups[0].label).toBe("多");
  });
});

/** 同一条成果进两个包，不是重复计分 */
describe("两套包互不干扰", () => {
  it("两边都挂上的成果，两个包里都在，各拿各的分", () => {
    const both = [item({ promotionScore: 2, declaredScore: 15 })];
    const promotion = buildPromotionPackage(both, 2026, compareIndicatorCode);
    const performance = buildPerformancePackage(both, 2026);
    expect(promotion.total).toBe(2);
    expect(performance.total).toBe(15);
  });
});

describe("filterForDeclaration", () => {
  const candidates = [
    item({ id: "clean", year: 2026, isVerified: true }),
    item({ id: "wrong-year", year: 2025, isVerified: true }),
    item({ id: "missing-year", year: null, isVerified: true }),
    item({ id: "unverified", year: 2026, isVerified: false }),
    item({ id: "both-problems", year: null, isVerified: false }),
  ];

  it("默认只收年度精确匹配且已核实的成果", () => {
    expect(filterForDeclaration(candidates, 2026, "promotion").map((row) => row.id)).toEqual(["clean"]);
  });

  it("显式覆盖后可以包含未核实成果", () => {
    expect(
      filterForDeclaration(candidates, 2026, "promotion", { includeUnverified: true }).map((row) => row.id),
    ).toEqual(["clean", "unverified"]);
  });

  it("显式覆盖后可以包含未分配年度成果", () => {
    expect(
      filterForDeclaration(candidates, 2026, "promotion", { includeMissingYear: true }).map((row) => row.id),
    ).toEqual(["clean", "missing-year"]);
  });

  it("两个覆盖开关同时打开才包含同时有两类问题的成果", () => {
    expect(
      filterForDeclaration(candidates, 2026, "promotion", {
        includeUnverified: true,
        includeMissingYear: true,
      }).map((row) => row.id),
    ).toEqual(["clean", "missing-year", "unverified", "both-problems"]);
  });

  it("2026 年起学校已奖励对象永久排除在绩效之外，安全覆盖也不能带入", () => {
    const rewarded = item({ id: "rewarded", schoolRewarded: true });
    expect(
      filterForDeclaration([rewarded], 2026, "performance", {
        includeUnverified: true,
        includeMissingYear: true,
      }),
    ).toEqual([]);
  });

  it("学校奖励不影响职称评审导出", () => {
    const rewarded = item({ id: "rewarded", schoolRewarded: true });
    expect(filterForDeclaration([rewarded], 2026, "promotion")).toHaveLength(1);
  });

  it("不改写 2025 年及以前的二级学院绩效历史口径", () => {
    const rewarded = item({ id: "rewarded", year: 2025, schoolRewarded: true });
    expect(filterForDeclaration([rewarded], 2025, "performance")).toHaveLength(1);
  });
});
