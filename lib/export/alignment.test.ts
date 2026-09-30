import { describe, expect, it } from "vitest";
import { compareIndicatorCode } from "@/lib/promotion";
import {
  buildPerformancePackage,
  buildPromotionPackage,
  filterForDeclaration,
  type DeclarationFilterOptions,
  type ExportableAchievement,
} from "./declaration";
import {
  preflightDeclaration,
  type DeclarationKind,
  type PreflightAchievement,
} from "./preflight";

const exportItems: ExportableAchievement[] = [
  {
    id: "clean",
    sourceKind: "ACHIEVEMENT",
    sourceId: "clean",
    href: "/achievements/clean",
    schoolRewarded: false,
    title: "干净成果",
    year: 2026,
    isVerified: true,
    level: "省级",
    type: "论文",
    ownerRole: "第一作者",
    authorPosition: 1,
    dateText: null,
    attachmentCount: 1,
    perfCategory: { majorCategory: "科研", minorCategory: "论文" },
    declaredScore: 3,
    promotionCategory: { code: "5.1", majorIndicator: "科研", minorIndicator: "论文" },
    promotionScore: 2,
  },
  {
    id: "unverified",
    sourceKind: "ACHIEVEMENT",
    sourceId: "unverified",
    href: "/achievements/unverified",
    schoolRewarded: false,
    title: "未核实成果",
    year: 2026,
    isVerified: false,
    level: "校级",
    type: "获奖",
    ownerRole: "负责人",
    authorPosition: null,
    dateText: null,
    attachmentCount: 0,
    perfCategory: { majorCategory: "教学", minorCategory: "获奖" },
    declaredScore: null,
    promotionCategory: null,
    promotionScore: null,
  },
  {
    id: "missing-year",
    sourceKind: "ACHIEVEMENT",
    sourceId: "missing-year",
    href: "/achievements/missing-year",
    schoolRewarded: false,
    title: "缺年度成果",
    year: null,
    isVerified: true,
    level: "省级",
    type: "课题",
    ownerRole: "主持",
    authorPosition: null,
    dateText: null,
    attachmentCount: 1,
    perfCategory: null,
    declaredScore: null,
    promotionCategory: { code: "5.2", majorIndicator: "科研", minorIndicator: "课题" },
    promotionScore: 3,
  },
  {
    id: "rewarded",
    sourceKind: "ACHIEVEMENT",
    sourceId: "rewarded",
    href: "/achievements/rewarded",
    schoolRewarded: true,
    title: "学校已奖励成果",
    year: 2026,
    isVerified: true,
    level: "省级",
    type: "获奖",
    ownerRole: "负责人",
    authorPosition: null,
    dateText: null,
    attachmentCount: 1,
    perfCategory: { majorCategory: "科研", minorCategory: "获奖" },
    declaredScore: 10,
    promotionCategory: null,
    promotionScore: null,
  },
];

function toPreflight(item: ExportableAchievement): PreflightAchievement {
  return {
    id: item.id,
    sourceKind: item.sourceKind,
    sourceId: item.sourceId,
    href: item.href,
    schoolRewarded: item.schoolRewarded,
    title: item.title,
    year: item.year,
    isVerified: item.isVerified,
    status: "PUBLISHED",
    attachmentCount: item.attachmentCount,
    perfCategoryId: item.perfCategory == null ? null : `perf-${item.id}`,
    promotionCategoryId: item.promotionCategory == null ? null : `promo-${item.id}`,
    declaredScore: item.declaredScore,
    promotionScore: item.promotionScore,
  };
}

const preflightItems: PreflightAchievement[] = exportItems.map(toPreflight);

const cases: Array<{
  label: string;
  kind: DeclarationKind;
  options: DeclarationFilterOptions;
}> = [
  { label: "职称安全默认", kind: "promotion", options: {} },
  { label: "绩效安全默认", kind: "performance", options: {} },
  {
    label: "职称包含未核实",
    kind: "promotion",
    options: { includeUnverified: true },
  },
  {
    label: "绩效包含未核实",
    kind: "performance",
    options: { includeUnverified: true },
  },
  {
    label: "职称包含缺年度",
    kind: "promotion",
    options: { includeMissingYear: true },
  },
  {
    label: "绩效包含缺年度",
    kind: "performance",
    options: { includeMissingYear: true },
  },
];

/** 职称表的年份是申报年度：按 2027 年申报，时间窗算到 2026-12-31，上面那批 2026 年的正好在窗里 */
const yearFor = (kind: DeclarationKind) => (kind === "promotion" ? 2027 : 2026);

describe("预检与组表交叉验证", () => {
  it.each(cases)("$label 的纳入条数逐条一致", ({ kind, options }) => {
    const year = yearFor(kind);
    const scoped = filterForDeclaration(exportItems, year, kind, null, options);
    const pkg =
      kind === "promotion"
        ? buildPromotionPackage(scoped, year, compareIndicatorCode)
        : buildPerformancePackage(scoped, year);
    const exportedCount = pkg.groups.reduce((count, group) => count + group.rows.length, 0);

    expect(exportedCount).toBeGreaterThan(0);
    expect(preflightDeclaration(preflightItems, year, kind, null, options).includedCount).toBe(
      exportedCount,
    );
  });

  /** 任现职日期卡掉一部分时，预检和组表也必须卡掉同样的那几条 */
  it.each([
    { label: "安全默认", options: {}, expected: 2 },
    { label: "包含缺年度", options: { includeMissingYear: true }, expected: 3 },
  ])("职称表带任现职日期时两边逐条一致：$label", ({ options, expected }) => {
    const since = new Date(Date.UTC(2024, 8, 1));
    // 2023 在任现职之前、2027 是申报当年，都不该进；2024、2026 在窗里；null 看开关
    const spread = [2023, 2024, 2026, 2027, null].map((year) => ({
      ...exportItems[0],
      id: `y${year}`,
      sourceId: `y${year}`,
      href: `/achievements/y${year}`,
      year,
    }));
    const scoped = filterForDeclaration(spread, 2027, "promotion", since, options);
    const pkg = buildPromotionPackage(scoped, 2027, compareIndicatorCode);
    const exportedCount = pkg.groups.reduce((count, group) => count + group.rows.length, 0);

    expect(exportedCount).toBe(expected);
    expect(
      preflightDeclaration(spread.map(toPreflight), 2027, "promotion", since, options)
        .includedCount,
    ).toBe(exportedCount);
  });
});
