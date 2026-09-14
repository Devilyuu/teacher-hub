import type { QuickEditDefaults } from "@/app/(app)/achievements/quick-edit-row";
import { DATE_UNFILLED, formatDateByPrecision } from "@/lib/format";
import {
  ACHIEVEMENT_STATUS_LABELS,
  ACHIEVEMENT_TYPE_LABELS,
  ACHIEVEMENT_USAGE_LABELS,
  LEVEL_LABELS,
  PROJECT_STATUS_LABELS,
} from "@/lib/labels";
import {
  matchingPerformanceEntries,
  type LedgerScope,
  type OutcomeFilters,
} from "@/lib/outcomes/filters";
import {
  outcomeProjectHref,
  safeOutcomeReturnPath,
} from "@/lib/outcomes/links";
import type { PerformanceEntry, UnifiedOutcomeRow } from "@/lib/outcomes/types";

type OutcomeRowViewOptions = {
  scope: LedgerScope;
  currentOutcomePath: string;
  filters: Pick<OutcomeFilters, "year" | "major" | "minor" | "unverifiedOnly">;
};

export type OutcomeRowViewModel = {
  href: string;
  entityLabel: "课题" | "成果";
  performanceEntries: PerformanceEntry[];
  performanceCount: number;
  performanceSummary: string;
  schoolRewarded: boolean;
  quickEdit: QuickEditDefaults | null;
  linkedProjects: Array<{ id: string; name: string; href: string }>;
};

function visiblePerformanceEntries(
  row: UnifiedOutcomeRow,
  options: OutcomeRowViewOptions,
): PerformanceEntry[] {
  return matchingPerformanceEntries(row, {
    scope: options.scope,
    ...options.filters,
  });
}

function performanceSummary(entries: PerformanceEntry[]): string {
  const labels = new Set(
    entries.map((entry) =>
      entry.perfCategory
        ? `${entry.perfCategory.majorCategory} · ${entry.perfCategory.minorCategory}`
        : "未分类",
    ),
  );
  return [...labels].join("；") || "—";
}

export function outcomeRowViewModel(
  row: UnifiedOutcomeRow,
  options: OutcomeRowViewOptions,
): OutcomeRowViewModel {
  const returnPath = safeOutcomeReturnPath(options.currentOutcomePath);
  const entries = visiblePerformanceEntries(row, options);

  if (row.kind === "PROJECT") {
    return {
      href: outcomeProjectHref(row.id, returnPath),
      entityLabel: "课题",
      performanceEntries: entries,
      performanceCount: entries.length,
      performanceSummary: performanceSummary(entries),
      schoolRewarded: row.schoolRewarded,
      quickEdit: null,
      linkedProjects: [],
    };
  }

  const query = returnPath.slice("/achievements".length);
  return {
    href: `${row.href}${query}`,
    entityLabel: "成果",
    performanceEntries: entries,
    performanceCount: entries.length,
    performanceSummary: performanceSummary(entries),
    schoolRewarded: row.schoolRewarded,
    linkedProjects: row.linkedProjects.map((project) => ({
      ...project,
      href: outcomeProjectHref(project.id, returnPath),
    })),
    quickEdit: {
      id: row.id,
      year: row.year,
      type: row.achievementType,
      status: row.achievementStatus,
      level: row.level,
      perfCategoryId: row.perfCategoryId,
      promotionCategoryId: row.promotionCategoryId,
      promotionScore: row.promotionScore,
      declaredScore: row.declaredScore,
      usableFor: row.usableFor,
      isVerified: row.isVerified,
    },
  };
}

/**
 * 「年度」列第二行要不要显示日期。
 *
 * 年度和日期回答的都是「什么时候」但不是一回事：年度是绩效申报年度，
 * 日期是发表/完成的原文（按 `datePrecision` 渲染，第 8 条铁律）。
 * 台账里九成的成果只精确到年，于是两行会印出一模一样的「2026 / 2026 年」——
 * 看上去像同一个数字重复了两遍，读的人还得停下来想「这两个有什么区别」。
 *
 * 判据是**去掉非数字之后一样就不显示**：
 * `2026` vs `2026 年` 数字相同 → 不显示；`2026` vs `2026-04` → 显示，
 * 它比年度多了一层信息。
 *
 * `formatDateByPrecision` 在完全没有日期时会返回 `DATE_UNFILLED`，那也不显示——
 * 一行里已经有一列在说「这条没日期」了，不必再占一行重复。
 */
export function outcomeDateSubline(
  yearText: string,
  formattedDate: string,
): string | null {
  const date = formattedDate.trim();
  if (!date || date === DATE_UNFILLED) return null;

  const digitsOf = (text: string) => text.replace(/\D/g, "");
  if (digitsOf(date) === digitsOf(yearText)) return null;

  return date;
}

/** 「年度」列的文案。多个绩效事项跨年时并列显示，新的在前 */
export function displayOutcomeYears(years: Array<number | null>): string {
  const values = [...new Set(years)].sort((a, b) => {
    if (a == null) return 1;
    if (b == null) return -1;
    return b - a;
  });
  return values.map((year) => year ?? "未填").join("、") || "—";
}

/**
 * 行和面板共用的「时间」两行。
 *
 * 抽出来是因为**两处必须一致**：面板显示的年度/日期要和它旁边那一行完全对得上，
 * 各写一遍迟早分叉——尤其是 `outcomeDateSubline` 那条「一样就不显示」的判据。
 */
export function outcomeTimeText(
  row: UnifiedOutcomeRow,
  entries: PerformanceEntry[],
  promotion: boolean,
): { yearText: string; dateSubline: string | null } {
  const yearText = displayOutcomeYears(entries.map((entry) => entry.year));
  const dateSubline = outcomeDateSubline(
    promotion ? String(row.promotionYear ?? "") : yearText,
    row.kind === "ACHIEVEMENT"
      ? formatDateByPrecision(
          row.publishedAt ?? row.completedAt,
          row.datePrecision,
          row.dateText,
        )
      : "",
  );
  return { yearText, dateSubline };
}

/**
 * 右侧详情面板的数据。
 *
 * **不额外查库**：列表页已经把 `UnifiedOutcomeRow` 全量取回来了，面板要显示的
 * 每一项都在里面。面板只是把同一份数据换个排布——列表是「扫」，面板是「看清一条」。
 *
 * 枚举在这里就翻成中文，客户端组件不用再引 `lib/labels`——那份表会跟着
 * schema 一起长，没必要整份进浏览器。
 */
export type OutcomePanelData = {
  key: string;
  href: string;
  title: string;
  entityLabel: "课题" | "成果";
  /** 成果才有核实状态；课题恒为 null，面板据此决定显不显示那枚徽章 */
  isVerified: boolean | null;
  typeLabel: string;
  levelLabel: string;
  statusLabel: string;
  yearText: string;
  dateText: string | null;
  schoolRewarded: boolean;
  attachmentCount: number;
  performance: Array<{
    id: string;
    yearText: string;
    category: string;
    scoreText: string;
    isVerified: boolean;
  }>;
  promotion: { code: string; major: string; minor: string } | null;
  promotionScoreText: string;
  usageLabels: string[];
  tags: string[];
  linkedProjects: Array<{ id: string; name: string; href: string }>;
  /** 软提示，只说不拦（第 3 条铁律）。面板里和列表里是同一批 */
  warnings: string[];
};

export function outcomePanelData(
  row: UnifiedOutcomeRow,
  options: OutcomeRowViewOptions,
): OutcomePanelData {
  const view = outcomeRowViewModel(row, options);
  const { yearText, dateSubline } = outcomeTimeText(
    row,
    view.performanceEntries,
    options.scope === "promotion",
  );

  const warnings: string[] = [];
  if (row.kind === "ACHIEVEMENT") {
    if (row.needsLink) {
      warnings.push("用途里勾了「结题挂接」，但还没挂到任何一条结题要求上");
    }
    if (row.promotionScore != null && row.promotionCategory == null) {
      warnings.push(
        "填了职称分，但职称指标是「不计入职称」——这条进不了职称口径",
      );
    }
  }

  return {
    key: row.key,
    href: view.href,
    title: row.title,
    entityLabel: view.entityLabel,
    isVerified: row.kind === "ACHIEVEMENT" ? row.isVerified : null,
    typeLabel:
      row.kind === "ACHIEVEMENT"
        ? ACHIEVEMENT_TYPE_LABELS[row.achievementType]
        : "课题",
    levelLabel: LEVEL_LABELS[row.level],
    statusLabel:
      row.kind === "ACHIEVEMENT"
        ? ACHIEVEMENT_STATUS_LABELS[row.achievementStatus]
        : PROJECT_STATUS_LABELS[row.projectStatus],
    yearText,
    dateText: dateSubline,
    schoolRewarded: row.schoolRewarded,
    attachmentCount: row.attachmentCount,
    performance: view.performanceEntries.map((entry) => ({
      id: entry.id,
      yearText: entry.year == null ? "未填年度" : `${entry.year} 年`,
      category: entry.perfCategory
        ? `${entry.perfCategory.majorCategory} · ${entry.perfCategory.minorCategory}`
        : "未分类",
      scoreText:
        entry.declaredScore == null ? "—" : String(entry.declaredScore),
      isVerified: entry.isVerified,
    })),
    promotion: row.promotionCategory
      ? {
          code: row.promotionCategory.code,
          major: row.promotionCategory.majorIndicator,
          minor: row.promotionCategory.minorIndicator,
        }
      : null,
    promotionScoreText:
      row.promotionScore == null ? "—" : String(row.promotionScore),
    usageLabels:
      row.kind === "ACHIEVEMENT"
        ? row.usableFor.map((usage) => ACHIEVEMENT_USAGE_LABELS[usage])
        : [],
    tags: row.kind === "ACHIEVEMENT" ? row.tags : [],
    linkedProjects: view.linkedProjects,
    warnings,
  };
}
