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

const preflightItems: PreflightAchievement[] = exportItems.map((item) => ({
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
}));

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

describe("预检与组表交叉验证", () => {
  it.each(cases)("$label 的纳入条数逐条一致", ({ kind, options }) => {
    const scoped = filterForDeclaration(exportItems, 2026, kind, options);
    const pkg =
      kind === "promotion"
        ? buildPromotionPackage(scoped, 2026, compareIndicatorCode)
        : buildPerformancePackage(scoped, 2026);
    const exportedCount = pkg.groups.reduce((count, group) => count + group.rows.length, 0);

    expect(preflightDeclaration(preflightItems, 2026, kind, options).includedCount).toBe(
      exportedCount,
    );
  });
});
