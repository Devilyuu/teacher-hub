/**
 * 年度申报包的组装逻辑（BUILD_PLAN Phase 2 验收目标）。
 *
 * **两套包，两套坐标系，绝不混在一张表里**（CLAUDE.md 第 11 条）：
 *
 *   职称包  按人事处职称量化表的二级指标分组，分值走 promotionScore，
 *           按申报年度取「任现职以来」的时间窗
 *   绩效包  按二级学院的 11 个大类分组，分值走 declaredScore，按成果年度取
 *
 * 同一条成果可能同时出现在两个包里（论文、教材、专利两边都算分），
 * 这不是重复——它在两张表上各占一格，各拿各的分。
 *
 * 纯函数，不碰数据库也不生成文件，单测在同名 .test.ts。
 * Excel 的写出在 lib/export/workbook.ts。
 */

import {
  applyPromotionCaps,
  inPromotionWindow,
  promotionWindow,
  type PromotionCapResult,
  type PromotionCapRule,
} from "@/lib/promotion";

export type DeclarationSourceKind = "ACHIEVEMENT" | "PROJECT" | "PROJECT_EVENT";

/** 组装用得到的最小跨来源申报候选形状 */
export type ExportableAchievement = {
  /** 兼容业务对象主键；导出行身份一律使用 sourceKind + sourceId。 */
  id: string;
  sourceKind: DeclarationSourceKind;
  sourceId: string;
  href: string;
  schoolRewarded: boolean;
  title: string;
  year: number | null;
  isVerified: boolean;
  level: string;
  type: string;
  ownerRole: string | null;
  authorPosition: number | null;
  dateText: string | null;
  attachmentCount: number;
  /** 绩效口径 */
  perfCategory: { majorCategory: string; minorCategory: string } | null;
  declaredScore: number | null;
  /** 职称口径 */
  promotionCategory: { code: string; majorIndicator: string; minorIndicator: string } | null;
  promotionScore: number | null;
};

export type PackageRow = {
  /** 材料序号，导出后要和材料目录、ZIP 里的文件名对上 */
  index: number;
  sourceKind: DeclarationSourceKind;
  sourceId: string;
  title: string;
  year: number | null;
  level: string;
  ownerRole: string;
  score: number | null;
  attachmentCount: number;
};

export type PackageGroup = {
  /** 职称包是「5.2 纵向课题」，绩效包是「科研与社会服务工作 / 纵向课题（教科研）」 */
  key: string;
  label: string;
  /** 上一级分组名，用来在表里合并显示 */
  parent: string;
  rows: PackageRow[];
  subtotal: number;
};

export type DeclarationPackage = {
  kind: "promotion" | "performance";
  year: number;
  groups: PackageGroup[];
  /** 原始分相加，和明细表逐条对得上 */
  total: number;
  /** 有分但没有任何附件的条数——申报时这些要补材料 */
  missingMaterialCount: number;
  /**
   * 职称包套上量化表封顶之后的核算（`withPromotionCaps`）。绩效包没有；
   * 没导入过职称表、拿不到规则时也没有——那时不截，汇总表不写封顶后合计
   */
  caps?: PromotionCapResult;
};

/**
 * 分组排完序后统一编号。
 *
 * **不能在分组时就编号**：两个包都会重排分组（职称按指标编号、绩效按条数降序），
 * 先编号的话表里的序号就是乱的——实测第一条印出来是 9 号。
 * 而这个序号要和材料目录、ZIP 里的文件名一一对应，必须是最终表格顺序。
 */
function renumber(groups: PackageGroup[]): PackageGroup[] {
  let index = 0;
  return groups.map((group) => ({
    ...group,
    rows: group.rows.map((row) => ({ ...row, index: ++index })),
  }));
}

function rowOf(item: ExportableAchievement, index: number, score: number | null): PackageRow {
  return {
    index,
    sourceKind: item.sourceKind,
    sourceId: item.sourceId,
    title: item.title,
    year: item.year,
    level: item.level,
    // 排名在申报表上是要写的：「第 2 作者」和「第 1 作者」分值差很多
    ownerRole:
      item.authorPosition != null
        ? `${item.ownerRole ?? "参与"}（第 ${item.authorPosition}）`
        : (item.ownerRole ?? ""),
    score,
    attachmentCount: item.attachmentCount,
  };
}

/**
 * 职称包。**只收挂了二级指标的**——`promotionCategoryId` 为 null 就意味着
 * 这条评职称用不上，那是客观事实不是筛选偏好（CLAUDE.md 第 11 条）。
 *
 * 分组按指标编号排（5.2 在 5.10 前），因为申报表就是按编号印的。
 */
export function buildPromotionPackage(
  items: ExportableAchievement[],
  year: number,
  compareCode: (a: string, b: string) => number,
): DeclarationPackage {
  const groups = new Map<string, PackageGroup>();
  let index = 0;
  let missingMaterialCount = 0;

  for (const item of items) {
    if (!item.promotionCategory) continue;
    index += 1;
    if (item.attachmentCount === 0) missingMaterialCount += 1;

    const { code, majorIndicator, minorIndicator } = item.promotionCategory;
    const group = groups.get(code) ?? {
      key: code,
      label: `${code} ${minorIndicator}`,
      parent: majorIndicator,
      rows: [],
      subtotal: 0,
    };
    group.rows.push(rowOf(item, index, item.promotionScore));
    group.subtotal += item.promotionScore ?? 0;
    groups.set(code, group);
  }

  const sorted = renumber([...groups.values()].sort((a, b) => compareCode(a.key, b.key)));
  return {
    kind: "promotion",
    year,
    groups: sorted,
    total: sorted.reduce((sum, group) => sum + group.subtotal, 0),
    missingMaterialCount,
  };
}

/**
 * 给职称包套上量化表的封顶（`applyPromotionCaps`）。职称包的分组键就是二级指标编号，
 * 小计直接喂进去。**明细照旧逐条写原始分**——申报表上每条填的就是原始分，
 * 截断只发生在合计上。规则为空（没导入过职称表）时原样返回，不截
 */
export function withPromotionCaps(
  pkg: DeclarationPackage,
  rules: ReadonlyArray<PromotionCapRule>,
): DeclarationPackage {
  if (pkg.kind !== "promotion" || rules.length === 0) return pkg;
  return {
    ...pkg,
    caps: applyPromotionCaps(
      pkg.groups.map((group) => ({
        code: group.key,
        majorIndicator: group.parent,
        score: group.subtotal,
      })),
      rules,
    ),
  };
}

/**
 * 绩效包。收挂了绩效小类的，按「大类 / 小类」分组。
 *
 * 分组按条数降序——学校 82 个小类里本人只用到二十来个，
 * 按表格原顺序排会让空小类占着位置（同成果库分面的口径）。
 */
export function buildPerformancePackage(
  items: ExportableAchievement[],
  year: number,
): DeclarationPackage {
  const groups = new Map<string, PackageGroup>();
  let index = 0;
  let missingMaterialCount = 0;

  for (const item of items) {
    if (!item.perfCategory) continue;
    index += 1;
    if (item.attachmentCount === 0) missingMaterialCount += 1;

    const { majorCategory, minorCategory } = item.perfCategory;
    const key = `${majorCategory}/${minorCategory}`;
    const group = groups.get(key) ?? {
      key,
      label: minorCategory,
      parent: majorCategory,
      rows: [],
      subtotal: 0,
    };
    group.rows.push(rowOf(item, index, item.declaredScore));
    group.subtotal += item.declaredScore ?? 0;
    groups.set(key, group);
  }

  const sorted = renumber(
    [...groups.values()].sort(
      (a, b) =>
        b.rows.length - a.rows.length ||
        a.parent.localeCompare(b.parent, "zh") ||
        a.label.localeCompare(b.label, "zh"),
    ),
  );
  return {
    kind: "performance",
    year,
    groups: sorted,
    total: sorted.reduce((sum, group) => sum + group.subtotal, 0),
    missingMaterialCount,
  };
}

export type DeclarationFilterOptions = {
  includeUnverified?: boolean;
  includeMissingYear?: boolean;
};

export const DEPARTMENT_PERFORMANCE_START_YEAR = 2026;

/**
 * 一条**填了年度**的记录落不落在这份表的取数范围里。两张表的 `year` 不是一回事：
 *
 * - **绩效表**：`year` 是成果年度，精确匹配——二级学院按年分钱
 * - **职称表**：`year` 是**申报年度**，取「任现职以来 → 申报年度上一年 12-31」
 *   （附件2 说明第 2 条）。和成果页职称口径是同一个 `promotionWindow`，
 *   两处各写一套的话，页面上看到的和导出来的就不是同一批东西
 *
 * 2026-09-25 以前职称表也按年度精确匹配：导出「2026 年度职称包」只有 2026 年的
 * 那几条，而按时间窗这几条恰好一条都不该算，此前那几年的又全被漏掉。
 * 没填年度的不归这里管，缺年度有自己的覆盖开关。
 */
export function inDeclarationPeriod(
  itemYear: number,
  year: number,
  kind: DeclarationPackage["kind"],
  titleSince: Date | null,
): boolean {
  return kind === "promotion"
    ? inPromotionWindow({ year: itemYear }, promotionWindow(titleSince, year))
    : itemYear === year;
}

export type DeclarationFilterCandidate = {
  year: number | null;
  isVerified: boolean;
  schoolRewarded: boolean;
};

/**
 * 申报导出的安全集合。
 *
 * 默认只接受落在取数范围里（见 `inDeclarationPeriod`）且已核实的成果；
 * 缺年度、未核实都必须由用户显式覆盖。对应口径的分类仍由
 * buildPromotionPackage / buildPerformancePackage 过滤，因为两套包看的分类字段不同。
 *
 * `titleSince` 是档案里的任现职日期，只有职称表用得上；null = 档案没填，只卡上限。
 * **故意是必填参数**：漏传时职称表会悄悄收进任现职之前的成果，而且不报任何错
 */
export function filterForDeclaration<T extends DeclarationFilterCandidate>(
  items: T[],
  year: number,
  kind: DeclarationPackage["kind"],
  titleSince: Date | null,
  options: DeclarationFilterOptions = {},
): T[] {
  return items.filter(
    (item) =>
      !(
        kind === "performance" &&
        year >= DEPARTMENT_PERFORMANCE_START_YEAR &&
        item.schoolRewarded
      ) &&
      (item.year == null
        ? options.includeMissingYear === true
        : inDeclarationPeriod(item.year, year, kind, titleSince)) &&
      (item.isVerified || options.includeUnverified === true),
  );
}
