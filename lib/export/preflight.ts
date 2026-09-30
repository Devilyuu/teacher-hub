/**
 * 导出前的质量预检（二期规格 §7.3）。
 *
 * 存在的理由很具体：导出页现在只显示「这一年有多少条能进表」和一个下载按钮，
 * 用户很容易把「能生成 Excel」理解成「可以提交」。而库里 73 条成果有 70 条未核实、
 * 68 条状态还是「选题」——这些会一声不响地进到交出去的表里。
 *
 * 纳入判定必须和 `filterForDeclaration` 逐条对齐：默认落在取数范围里
 * （绩效按成果年度、职称按任现职时间窗，`inDeclarationPeriod`）且已核实，
 * 缺年度、未核实只有显式覆盖后才进入。对不齐的话，预检说的和导出的就是两回事。
 *
 * 纯函数，不碰数据库。
 */

import { promotionWindow } from "@/lib/promotion";
import {
  DEPARTMENT_PERFORMANCE_START_YEAR,
  inDeclarationPeriod,
  type DeclarationSourceKind,
} from "./declaration";

/** 预检用得到的最小成果形状。**故意不复用 ExportableAchievement**——
 *  那个类型是给组表用的，加字段会牵动导出逻辑，而这一版要求零行为变更 */
export type PreflightAchievement = {
  /** 兼容业务对象主键；预检样例身份一律使用 sourceKind + sourceId。 */
  id: string;
  sourceKind: DeclarationSourceKind;
  sourceId: string;
  href: string;
  schoolRewarded: boolean;
  title: string;
  year: number | null;
  isVerified: boolean;
  /** AchievementStatus 的字符串值 */
  status: string;
  attachmentCount: number;
  perfCategoryId: string | null;
  promotionCategoryId: string | null;
  declaredScore: number | null;
  promotionScore: number | null;
};

export type PreflightIssueCode =
  | "unverified"
  | "missingYear"
  | "missingScore"
  | "missingMaterial"
  | "suspiciousStatus"
  | "scoreWithoutCategory"
  | "schoolRewarded"
  | "afterPromotionWindow";

export type PreflightIssue = {
  code: PreflightIssueCode;
  /** 界面上的标题 */
  label: string;
  /** 为什么这是个问题、该怎么办 */
  hint: string;
  /**
   * 这条问题说的是**已纳入**的记录还是**被漏掉**的记录。
   * 两者的处理方式完全不同：前者是「交出去的表里有脏数据」，
   * 后者是「你以为报上去了，其实根本没进表」。
   */
  scope: "included" | "excluded";
  count: number;
  /** 前几条的标题，界面上直接列出来，省得再点进去找 */
  samples: Array<{
    sourceKind: DeclarationSourceKind;
    sourceId: string;
    href: string;
    title: string;
  }>;
};

export type PreflightReport = {
  kind: DeclarationKind;
  /** 绩效表是成果年度，职称表是申报年度 */
  year: number;
  /** 会进到 Excel 里的条数。应与导出页显示的候选数一致 */
  includedCount: number;
  /** 其中有至少一个问题的条数（按成果去重，不是问题条数相加） */
  flaggedCount: number;
  issues: PreflightIssue[];
  /** 四种安全覆盖组合各自最终会进入工作簿的精确条数 */
  includedCounts: OverrideCounts;
  /**
   * 同样四种组合下，申报包 ZIP 里会有几份支撑材料（各行「材料份数」相加）。
   * 课题的两条绩效事项各带一份课题材料，这里也各算一次——和包里的文件数一致
   */
  materialCounts: OverrideCounts;
};

export type OverrideCounts = {
  safe: number;
  includeUnverified: number;
  includeMissingYear: number;
  includeBoth: number;
};

export type DeclarationKind = "promotion" | "performance";

/**
 * 拿去申报明显不对的状态。
 *
 * **只列最没有争议的三个。** 「写作中」「已投稿」「外审中」这些看着也没完成，
 * 但过程性申报（declareNature = PROCESS）报的就是在途工作，一刀切会把正常记录
 * 全标成问题，预检就没人看了。
 */
const SUSPICIOUS_STATUS: Record<string, string> = {
  PLANNED: "选题",
  SHELVED: "暂缓",
  REJECTED: "退稿",
};

function inExactYear(item: PreflightAchievement, year: number): boolean {
  return item.year === year;
}

export type VerifyProgress = {
  year: number;
  /** 目标年度的申报候选总数（两个口径合起来去重） */
  total: number;
  verified: number;
  remaining: number;
  /** 0–100 的整数，给进度条用 */
  percent: number;
};

/**
 * 目标年度的核实进度（成果页「待核实」视图顶上那条）。
 *
 * 清存量时**必须有这个数字**：待核实视图是「筛掉已核实的」，清完一条那条就
 * 从列表里消失，于是屏幕上永远只剩「还没做的」——看不出做了多少、还剩多少，
 * 也分不清哪些属于今年（该清）哪些是历史账（不用清）。
 *
 * 口径三条，都是为了和导出页说同一件事：
 *
 * 1. **按成果年度数，候选判定沿用导出预检那一套**：年度精确匹配、挂了该口径的分类、
 *    2026 年起学校已奖励的不进绩效口径。「还剩 N 条」因此是导出页这一年绩效表
 *    「未核实」提示里的那几条，加上职称表「未核实」里**年度是这一年**的那几条。
 *    职称表按任现职时间窗取、一张表跨好几年（`inDeclarationPeriod`），
 *    这里只数落在这一年的那部分——进度是按年清的，不按申报批次。
 *    没填年度的导出页也算进「未核实」提示，但它们不属于任何年度，另有「缺年度」提示管
 * 2. **两个口径合起来去重**——一条成果可能同时挂绩效小类和职称指标，只算一条
 * 3. **课题本身不算**。它没有核实这一步（导出时恒为已核实，见 sources.ts 的
 *    adaptProject），算进来的话一条没核就已经显示六七成，进度就失去意义了。
 *    要核实的只有成果和课题的绩效事项
 *
 * 2026-09-25 从成果页合并（课题进联合视图）时掉线后接回，同时从「只数成果」
 * 改成上面这套跨来源口径。
 */
export function verifyProgress(
  items: PreflightAchievement[],
  year: number,
): VerifyProgress {
  const isCandidateFor = (item: PreflightAchievement, kind: DeclarationKind) =>
    !excludedBySchoolReward(item, year, kind) &&
    inExactYear(item, year) &&
    categoryIdOf(item, kind) != null;

  const candidates = new Map<string, PreflightAchievement>();
  for (const item of items) {
    if (item.sourceKind === "PROJECT") continue;
    if (isCandidateFor(item, "promotion") || isCandidateFor(item, "performance")) {
      candidates.set(`${item.sourceKind}:${item.sourceId}`, item);
    }
  }

  const total = candidates.size;
  const verified = [...candidates.values()].filter((item) => item.isVerified).length;

  return {
    year,
    total,
    verified,
    remaining: total - verified,
    // 没有候选时算 100%——「无事可做」不该显示成 0% 让人以为一点没干
    percent: total === 0 ? 100 : Math.round((verified / total) * 100),
  };
}

function categoryIdOf(item: PreflightAchievement, kind: DeclarationKind): string | null {
  return kind === "promotion" ? item.promotionCategoryId : item.perfCategoryId;
}

function scoreOf(item: PreflightAchievement, kind: DeclarationKind): number | null {
  return kind === "promotion" ? item.promotionScore : item.declaredScore;
}

const SAMPLE_LIMIT = 5;

function issueOf(
  code: PreflightIssueCode,
  label: string,
  hint: string,
  scope: PreflightIssue["scope"],
  matched: PreflightAchievement[],
): PreflightIssue {
  return {
    code,
    label,
    hint,
    scope,
    count: matched.length,
    samples: matched.slice(0, SAMPLE_LIMIT).map((item) => ({
      sourceKind: item.sourceKind,
      sourceId: item.sourceId,
      href: item.href,
      title: item.title,
    })),
  };
}

function excludedBySchoolReward(
  item: PreflightAchievement,
  year: number,
  kind: DeclarationKind,
): boolean {
  return (
    kind === "performance" &&
    year >= DEPARTMENT_PERFORMANCE_START_YEAR &&
    item.schoolRewarded
  );
}

/**
 * 算出一份预检报告。**只返回有问题的项**，没问题的不占版面。
 *
 * 排序按严重程度：先说漏掉的（你以为报了其实没报），再说脏的，
 * 最后说缺材料这类补起来最容易的。
 *
 * `year` 在绩效表是成果年度、在职称表是申报年度；`titleSince` 是档案里的
 * 任现职日期，只有职称表用（null = 没填，只卡上限）。两个参数的口径和
 * `filterForDeclaration` 完全一样，**必须传同一个值**
 */
export function preflightDeclaration(
  items: PreflightAchievement[],
  year: number,
  kind: DeclarationKind,
  titleSince: Date | null,
  options: { includeUnverified?: boolean; includeMissingYear?: boolean } = {},
): PreflightReport {
  /** 年度已填且落在取数范围里；没填年度的另算 */
  const inPeriod = (item: PreflightAchievement) =>
    item.year != null && inDeclarationPeriod(item.year, year, kind, titleSince);
  /** 落在范围里或者没填年度——「这条可能属于这张表」 */
  const inPeriodOrMissing = (item: PreflightAchievement) =>
    item.year == null || inPeriod(item);

  const selectIncluded = (selected: {
    includeUnverified?: boolean;
    includeMissingYear?: boolean;
  }) =>
    items.filter(
      (item) =>
        !excludedBySchoolReward(item, year, kind) &&
        (inPeriod(item) ||
          (selected.includeMissingYear === true && item.year == null)) &&
        (item.isVerified || selected.includeUnverified === true) &&
        categoryIdOf(item, kind) != null,
    );

  const included = selectIncluded(options);
  const countsBy = (measure: (rows: PreflightAchievement[]) => number): OverrideCounts => ({
    safe: measure(selectIncluded({})),
    includeUnverified: measure(selectIncluded({ includeUnverified: true })),
    includeMissingYear: measure(selectIncluded({ includeMissingYear: true })),
    includeBoth: measure(selectIncluded({ includeUnverified: true, includeMissingYear: true })),
  });
  const includedCounts = countsBy((rows) => rows.length);
  const materialCounts = countsBy((rows) =>
    rows.reduce((sum, item) => sum + item.attachmentCount, 0),
  );

  /**
   * 填了分却没挂分类，**这条根本进不了表**。
   *
   * 用户以为「设了分数就算数了」，而口径过滤看的是分类挂没挂上，
   * 完全不看分值——界面却一声不吭。这是最该排在最前面的一条：
   * 其他问题是表里的数据脏，这一条是东西压根没在表里。
   */
  const orphanScored = items.filter(
    (item) =>
      inPeriodOrMissing(item) &&
      categoryIdOf(item, kind) == null &&
      scoreOf(item, kind) != null,
  );
  const schoolRewarded =
    kind === "performance" && year >= DEPARTMENT_PERFORMANCE_START_YEAR
      ? items.filter(
          (item) =>
            inPeriodOrMissing(item) &&
            categoryIdOf(item, kind) != null &&
            item.schoolRewarded,
        )
      : [];

  /**
   * 挂了职称指标、年度却晚于时间窗终点的——多半是今年刚出的成果。
   *
   * 「申报年度当年的成果不算」是附件2 的规定，但它反直觉：刚建好、挂好指标的东西
   * 在「2026 年申报」的表里找不到，用户第一反应是没存上（CLAUDE.md 成果页那条
   * 「只讲规则不报数」的同一个坑）。所以要报出来。**任现职之前的不报**：
   * 那是一大批老成果，每次都列一遍就成了噪音，而且不会有人以为它们该在表里
   */
  const toYear = promotionWindow(titleSince, year).toYear;
  const afterWindow =
    kind === "promotion"
      ? items.filter(
          (item) =>
            item.year != null &&
            item.year > toYear &&
            categoryIdOf(item, kind) != null,
        )
      : [];

  const unverified = options.includeUnverified
    ? included.filter((item) => !item.isVerified)
    : items.filter(
        (item) =>
          !excludedBySchoolReward(item, year, kind) &&
          inPeriodOrMissing(item) &&
          categoryIdOf(item, kind) != null &&
          !item.isVerified,
      );
  const missingYear = options.includeMissingYear
    ? included.filter((item) => item.year == null)
    : items.filter(
        (item) =>
          !excludedBySchoolReward(item, year, kind) &&
          item.year == null &&
          categoryIdOf(item, kind) != null,
      );
  const missingScore = included.filter((item) => scoreOf(item, kind) == null);
  const missingMaterial = included.filter((item) => item.attachmentCount === 0);
  const suspicious = included.filter((item) => item.status in SUSPICIOUS_STATUS);

  const kindLabel = kind === "promotion" ? "职称" : "绩效";
  // 数字两边留空格、汉字紧挨着，和别处的文案排法一致
  const tableLabel = kind === "promotion" ? "这张职称表" : ` ${year} 年表`;

  const candidates: PreflightIssue[] = [
    issueOf(
      "schoolRewarded",
      "学校已奖励，不参加二级学院绩效分配",
      "学校正式审定通过后，该成果永久不再参加 2026 年及以后任何年度的二级学院绩效分配；此排除不能通过“带问题导出”覆盖。",
      "excluded",
      schoolRewarded,
    ),
    issueOf(
      "scoreWithoutCategory",
      `填了${kindLabel}分但没挂${kindLabel}分类`,
      `这些条目**不会出现在表里**。口径过滤只看分类挂没挂上，不看分值。去成果台账把${kindLabel}分类补上。`,
      "excluded",
      orphanScored,
    ),
    issueOf(
      "afterPromotionWindow",
      `${toYear + 1} 年及以后的成果`,
      `按 ${year} 年申报，职称量化只算到 ${toYear}-12-31（附件2 说明第 2 条），这些留到下一次申报。不是没存上。`,
      "excluded",
      afterWindow,
    ),
    issueOf(
      "unverified",
      "未核实",
      options.includeUnverified
        ? "本次已显式包含这些未人工核对的成果。"
        : "默认不进表。逐条确认后在成果台账勾「已核实」，或显式选择带问题导出。",
      options.includeUnverified ? "included" : "excluded",
      unverified,
    ),
    issueOf(
      "missingYear",
      "没填申报年度",
      options.includeMissingYear
        ? `本次已显式把这些未分配年度的成果纳入${tableLabel}。`
        : `默认不进${tableLabel}${kind === "promotion" ? "——没有年度就判断不了在不在任现职时间窗里" : ""}。补上年度，或显式选择带问题导出。`,
      options.includeMissingYear ? "included" : "excluded",
      missingYear,
    ),
    issueOf(
      "suspiciousStatus",
      "状态存疑",
      `状态还是${Object.values(SUSPICIOUS_STATUS).join("／")}，拿去申报对不上。多数是存量导入时留下的默认值。`,
      "included",
      suspicious,
    ),
    issueOf(
      "missingScore",
      `没填${kindLabel}分`,
      "分值一律人工填，系统只显示规则不替你算。没填的在表里是空格。",
      "included",
      missingScore,
    ),
    issueOf(
      "missingMaterial",
      "没有支撑材料",
      "表里有这一行，但没有能附上去的材料原件。上传附件后材料目录才对得上号。",
      "included",
      missingMaterial,
    ),
  ];

  // 按成果去重：一条成果同时未核实又缺材料，只算一条「有问题的」
  const flagged = new Set<string>();
  for (const item of [
    ...included.filter((item) => !item.isVerified || item.year == null),
    ...missingScore,
    ...missingMaterial,
    ...suspicious,
  ]) {
    flagged.add(`${item.sourceKind}:${item.sourceId}`);
  }

  return {
    kind,
    year,
    includedCount: included.length,
    flaggedCount: flagged.size,
    issues: candidates.filter((issue) => issue.count > 0),
    includedCounts,
    materialCounts,
  };
}
