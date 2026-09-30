import { Fragment } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDown, Plus, X } from "lucide-react";
import { AchievementTabs } from "@/components/achievement-tabs";
import { FilterChip } from "@/components/filter-chip";
import { VerifyProgressBar } from "@/components/verify-progress-bar";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateOnly, todayAsDateOnly } from "@/lib/date";
import { verifyProgress } from "@/lib/export/preflight";
import { loadDeclarationExportSources } from "@/lib/export/sources";
import {
  ACHIEVEMENT_USAGE_LABELS,
  OUTCOME_TYPE_LABELS,
  PROJECT_STATUS_LABELS,
} from "@/lib/labels";
import {
  missingYearCount,
  outcomeScopeCounts,
  performanceMajorFacets,
  performanceMinorFacets,
  promotionMajorFacets,
  promotionMinorFacets,
  projectsWithoutPerformanceEntries,
  promotionCapsOf,
  promotionScoreComposition,
  scoreWithoutPromotionCategoryCount,
  typeFacets,
  usageFacets,
  yearFacets,
} from "@/lib/outcomes/facets";
import {
  filterOutcomes,
  LEDGER_SCOPE_LABELS,
  LEDGER_SCOPES,
  outcomeTotals,
} from "@/lib/outcomes/filters";
import {
  groupOutcomes,
  outcomeGroupDimension,
  outcomeGroupOrderFrom,
} from "@/lib/outcomes/grouping";
import { outcomeProjectHref } from "@/lib/outcomes/links";
import {
  outcomeHrefWith,
  parseOutcomeQuery,
  shouldRenderMissingYearFacet,
  type OutcomeQueryPatch,
  type OutcomeSearchParams,
} from "@/lib/outcomes/query";
import { promotionWindow } from "@/lib/promotion";
import { getPerfOptions } from "@/lib/queries/perf-categories";
import {
  getCurrentTitleSince,
  getPromotionCapRules,
  getPromotionMajorOrder,
  getPromotionOptions,
} from "@/lib/queries/promotion-categories";
import { getUnifiedOutcomeList } from "@/lib/queries/outcomes";
import { outcomePanelData } from "@/lib/outcomes/view-model";
import {
  OutcomeGroupHeaderItem,
  OutcomeGroupHeaderRow,
} from "./outcome-group-header";
import { OutcomeInspector } from "./outcome-inspector";
import { OutcomeRow } from "./outcome-row";
import { OutcomeSummaryItem } from "./outcome-summary-item";
import { PromotionScoreBar } from "./score-bar";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "成果" };

function Count({ n }: { n: number }) {
  return <span className="tabular-nums">{n}</span>;
}

function SubFacetRow({
  label,
  allHref,
  allActive,
  facets,
}: {
  label: string;
  allHref: string;
  allActive: boolean;
  facets: Array<{
    key: string;
    text: string;
    count: number;
    active: boolean;
    href: string;
  }>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 pl-3">
      <span className="pr-1 text-xs text-muted-foreground">{label}</span>
      <FilterChip active={allActive} href={allHref}>
        全部
      </FilterChip>
      {facets.map((facet) => (
        <FilterChip key={facet.key} active={facet.active} href={facet.href}>
          <span className="max-w-[13rem] truncate" title={facet.text}>
            {facet.text}
          </span>
          <Count n={facet.count} />
        </FilterChip>
      ))}
    </div>
  );
}

export default async function AchievementsPage({
  searchParams,
}: {
  searchParams: Promise<OutcomeSearchParams>;
}) {
  const queryState = parseOutcomeQuery(await searchParams);
  const [
    all,
    promotionOptions,
    perfOptions,
    titleSince,
    promotionMajorOrder,
    declarationSources,
    capRules,
  ] = await Promise.all([
    getUnifiedOutcomeList(),
    getPromotionOptions(),
    getPerfOptions(),
    getCurrentTitleSince(),
    getPromotionMajorOrder(),
    // 核实进度只在「待核实」视图画，那份数据（导出页同一份）也只在那时取
    queryState.filters.unverifiedOnly ? loadDeclarationExportSources() : null,
    // 封顶后合计只在职称口径下写
    queryState.filters.scope === "promotion" ? getPromotionCapRules() : [],
  ]);

  const declareYear = queryState.declareYear;
  const window = promotionWindow(titleSince, declareYear);
  const scope = queryState.filters.scope;
  const yearParam = queryState.yearParam;
  const filters = {
    ...queryState.filters,
    window,
  };
  const hrefWith = (patch: OutcomeQueryPatch) =>
    outcomeHrefWith(queryState, patch);

  const filtered = filterOutcomes(all, filters);

  // 核实进度：口径和导出预检是同一套（verifyProgress）。筛了年度就看那一年——
  // 年初核上一年的绩效时正好用得上；没筛就看今年
  const progressYear =
    typeof filters.year === "number" ? filters.year : todayAsDateOnly().getUTCFullYear();
  const progress = declarationSources
    ? verifyProgress(declarationSources.items, progressYear)
    : null;
  const scopeCounts = outcomeScopeCounts(all, window);
  const inScopeCount = scopeCounts[scope];
  // 年度要进分面上下文：选了 2026 之后，绩效大类/职称指标/用途都只数 2026 的。
  // 年度分面自己不套（facets.ts 里摘掉），否则切不回别的年份
  const facetContext = { scope, window, year: filters.year };
  const types = typeFacets(all, facetContext, filters.type);
  const years = yearFacets(all, facetContext);
  const noYear = missingYearCount(all, facetContext);
  const majors = performanceMajorFacets(all, facetContext, filters.major);
  const minors = performanceMinorFacets(
    all,
    facetContext,
    filters.major,
    filters.minor,
  );
  const promotionMajors = promotionMajorFacets(
    all,
    facetContext,
    promotionMajorOrder,
    filters.promotionMajor,
  );
  const promotionMinors = promotionMinorFacets(
    all,
    facetContext,
    filters.promotionMajor,
    filters.promotionMinor,
  );
  const usages = usageFacets(all, facetContext);
  const totals = outcomeTotals(all, filters);
  const scoreOnly = scoreWithoutPromotionCategoryCount(all);
  const unregisteredProjects = projectsWithoutPerformanceEntries(all);
  // 和上面口径 chip 的 patch 保持一致：切口径时坐标筛选一起清，
  // 否则带着职称一级指标切到「全部」，列表会莫名其妙是空的
  const outOfScopeHref = hrefWith({
    scope: "all",
    year: null,
    major: null,
    minor: null,
    pmajor: null,
    pminor: null,
  });
  const outcomePath = queryState.canonicalPath;
  const isPromotion = scope === "promotion";
  const showPerformanceFacets = scope !== "promotion";
  const showPromotionFacets = scope === "promotion";
  const anyFilter = queryState.anyFilter;
  const showFilterControls =
    all.length > 0 || shouldRenderMissingYearFacet(queryState, noYear);
  const clearFilterHref = hrefWith({
    type: null,
    year: null,
    pmajor: null,
    pminor: null,
    major: null,
    minor: null,
    usage: null,
    needslink: null,
    unverified: null,
    dyear: null,
  });

  // ── 收进「更多筛选」的那些条件，选中后在首层以可关闭标签露出 ──────────
  // 首层只放口径和年度：它们是**每次来都要先定的坐标**；类型、分类、用途、
  // 异常项是按需钻取的。原来八行四十多个胶囊平铺，用户得先读懂数据模型
  // 才找得到想要的那条（2026-09-13 按 Codex 评审收起）。
  //
  // 标签只列收起的条件，不列口径和年度——那两个在首层本来就看得见选中态，
  // 再印一遍标签就是同一件事说两次。
  const hiddenActive: Array<{ key: string; text: string; clear: OutcomeQueryPatch }> = [];
  if (filters.type) {
    hiddenActive.push({ key: "type", text: `类型：${OUTCOME_TYPE_LABELS[filters.type]}`, clear: { type: null } });
  }
  if (filters.major) {
    hiddenActive.push({ key: "major", text: `绩效大类：${filters.major}`, clear: { major: null, minor: null } });
  }
  if (filters.minor) {
    hiddenActive.push({ key: "minor", text: `绩效小类：${filters.minor}`, clear: { minor: null } });
  }
  if (filters.promotionMajor) {
    hiddenActive.push({
      key: "pmajor",
      text: `职称一级：${filters.promotionMajor}`,
      clear: { pmajor: null, pminor: null },
    });
  }
  if (filters.promotionMinor) {
    const label = promotionMinors.find((facet) => facet.value === filters.promotionMinor)?.label;
    hiddenActive.push({
      key: "pminor",
      text: `职称二级：${filters.promotionMinor}${label ? ` ${label}` : ""}`,
      clear: { pminor: null },
    });
  }
  if (filters.usage) {
    hiddenActive.push({ key: "usage", text: `用途：${ACHIEVEMENT_USAGE_LABELS[filters.usage]}`, clear: { usage: null } });
  }
  if (filters.needsLinkOnly) {
    hiddenActive.push({ key: "needslink", text: "该挂未挂", clear: { needslink: null } });
  }
  if (filters.unverifiedOnly) {
    hiddenActive.push({ key: "unverified", text: "只看待确认", clear: { unverified: null } });
  }

  // 选了大类还没选小类时自动展开「更多筛选」——不然点完大类页面一刷新，
  // 小类那一行就藏回去了，钻取走到一半断掉
  const drilling = Boolean(
    (filters.major && !filters.minor && minors.length > 0) ||
      (filters.promotionMajor && !filters.promotionMinor && promotionMinors.length > 0),
  );

  // ── 常用视图 ────────────────────────────────────────────────────────
  // **只是一组 URL 参数的快捷方式，不是新字段**——不许为了「预设」往数据里
  // 加一个把口径和年度揉在一起的东西（CLAUDE.md 第 11 条：正交维度不合并）。
  // 「待核实」不做预设：上面二级 tab 里已经有了，且那条链接必须带 scope=all。
  // 「任现职以来」也不是新筛选，就是职称口径的默认时间窗，这里只是把隐性规则说出名字。
  // 「该挂未挂」也不做预设：用途和该挂未挂**只作用于成果、课题行照样保留**
  // （filters.test.ts 锁着），做成预设点进去会连带出全部课题，名不副实。
  // 它留在「更多筛选 → 异常」里，跟别的条件叠着用。
  // 今年和去年各一个：绩效通常是年初填上一年的，只给「本年度」正好错开一年。
  const clearAll: OutcomeQueryPatch = {
    type: null,
    year: null,
    pmajor: null,
    pminor: null,
    major: null,
    minor: null,
    usage: null,
    needslink: null,
    unverified: null,
  };
  const thisYear = String(queryState.currentYear);
  const lastYear = String(queryState.currentYear - 1);
  const presets = [
    {
      key: "promotion",
      label: "职称 · 任现职以来",
      title: `按 ${declareYear} 年申报：任现职以来、挂了职称指标的课题和成果`,
      href: hrefWith({ ...clearAll, scope: null }),
      active: scope === "promotion" && !anyFilter,
    },
    {
      key: "performance-year",
      label: `${thisYear} 年度绩效`,
      title: `绩效口径下 ${thisYear} 年的课题和成果`,
      href: hrefWith({ ...clearAll, scope: "performance", year: thisYear }),
      active: scope === "performance" && yearParam === thisYear && hiddenActive.length === 0,
    },
    {
      key: "performance-last-year",
      label: `${lastYear} 年度绩效`,
      title: `绩效口径下 ${lastYear} 年的课题和成果`,
      href: hrefWith({ ...clearAll, scope: "performance", year: lastYear }),
      active: scope === "performance" && yearParam === lastYear && hiddenActive.length === 0,
    },
    {
      key: "all",
      label: "全部记录",
      title: "不分口径、不加筛选",
      href: hrefWith({ ...clearAll, scope: "all" }),
      active: scope === "all" && !anyFilter,
    },
  ];

  // 面板数据在服务端一次算好。**不额外查库**——用的就是列表这份 `filtered`，
  // 面板只是把同一条记录换个排布（见 outcome-inspector.tsx 文件头）
  const rowFilters = {
    year: filters.year,
    major: filters.major,
    minor: filters.minor,
    unverifiedOnly: filters.unverifiedOnly,
  };
  const rowViewOptions = {
    scope,
    currentOutcomePath: outcomePath,
    filters: rowFilters,
  };
  // 面板按 row.key 编址，**不传 entryGroup**：分组只是列表的排布，
  // 面板看的是整条记录（一个跨两类的课题，面板里两条事项都该在）
  const panels = Object.fromEntries(
    filtered.map((row) => [row.key, outcomePanelData(row, rowViewOptions)]),
  );

  // ── 分组 ────────────────────────────────────────────────────────────
  // 「全部 + 2026」一选就是几十行平铺，得一行行读「绩效分类」那列才知道哪几条是一类。
  // 分组**不筛掉任何一行、不改任何数**，各组小计加起来等于上面那条合计（grouping.test.ts 锁着）。
  // 顺序取自学校那两张表的行序，不按条数排——条数排序会让同一个组每换个年度就跳位。
  const groupOrder = outcomeGroupOrderFrom(perfOptions, promotionMajorOrder);
  const groups = queryState.grouped
    ? groupOutcomes(filtered, filters, groupOrder)
    : null;
  // 不分组时走同一套渲染，省得两份 JSX 各写一遍早晚长歪
  const flatGroup = {
    key: "__flat__",
    label: "",
    rows: filtered,
    score: 0,
    entryGroup: null,
  };
  const scoreLabel = isPromotion ? "职称分" : "申报分";
  // 小类已经选定时 groupOutcomes 返回 null（只会分出一个组，白占一行）
  const canGroup = outcomeGroupDimension(filters) != null;

  // 堆叠条吃的是 filtered——必须和合计、表格说同一份数（facets.ts 注释）。
  // 只在职称口径下画：它按一级指标拆分，别的口径里这个维度不是主角
  const scoreComposition = isPromotion
    ? promotionScoreComposition(filtered, promotionMajorOrder)
    : null;
  // 按量化表封顶截一遍（和导出职称表同一个函数）。没截掉任何分时不写，免得多一个一样的数
  const promotionCaps =
    isPromotion && capRules.length > 0 ? promotionCapsOf(filtered, capRules) : null;
  const capped =
    promotionCaps && promotionCaps.overCap.length > 0 ? promotionCaps : null;

  const totalsLine = (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span>
          共{" "}
          <span className="font-medium tabular-nums text-foreground">
            {totals.count}
          </span>{" "}
          条{anyFilter ? `（本口径 ${inScopeCount} 条）` : ""}
        </span>
        <span>
          职称量化分合计{" "}
          <span className="font-medium tabular-nums text-foreground">
            {totals.sumPromotionScore}
          </span>
        </span>
        {capped ? (
          <span>
            封顶后{" "}
            <span className="font-medium tabular-nums text-foreground">
              {capped.cappedTotal}
            </span>
          </span>
        ) : null}
        <span>
          申报分合计{" "}
          <span className="font-medium tabular-nums text-foreground">
            {totals.sumPerformanceScore}
          </span>
        </span>
        {anyFilter ? (
          <Link
            href={clearFilterHref}
            className="underline-offset-4 hover:underline"
          >
            清除筛选
          </Link>
        ) : null}
        {/* 排布开关。**不是筛选**——所以它挨着合计而不是混进上面那片筛选胶囊里，
            也不被「清除筛选」带走（query.ts 的 grouped） */}
        {canGroup ? (
          <Link
            href={hrefWith({ group: queryState.grouped ? "none" : null })}
            className="ml-auto underline-offset-4 hover:underline"
          >
            {queryState.grouped ? "不分组" : "按分类分组"}
          </Link>
        ) : null}
      </div>
      {scoreComposition ? (
        <PromotionScoreBar
          slices={scoreComposition.slices}
          deducted={scoreComposition.deducted}
        />
      ) : null}
      {/* 写成字不放 title：手机上点不出悬停提示（月历那条的同一个理由） */}
      {capped ? (
        <p className="measure text-xs leading-relaxed text-muted-foreground">
          超出量化表上限的部分不计入：
          {capped.overCap
            .map((over) => `${over.label} 合计 ${over.raw} 分、上限 ${over.cap} 分`)
            .join("；")}
          。
        </p>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-4">
      <AchievementTabs />

      {progress ? (
        <VerifyProgressBar
          progress={progress}
          focusYearHref={
            filters.year === progressYear ? null : hrefWith({ year: String(progressYear) })
          }
        />
      ) : null}

      <header className="flex flex-wrap items-end justify-between gap-4 pt-2">
        <div className="space-y-2">
          <h1 className="page-title">成果</h1>
          <p className="measure text-muted-foreground">
            课题与实际成果共用一份台账；课题信息仍在科研详情里编辑。
          </p>
        </div>
        <Button render={<Link href="/achievements/new" />} nativeButton={false}>
          <Plus className="size-4" aria-hidden />
          新建成果
        </Button>
      </header>

      {/* 筛选区分三层：常用视图 → 口径与年度 → 收起的「更多筛选」。
          原来八行四十多个胶囊平铺，用户得先读懂「绩效大类 / 职称一级指标 / 用途」
          这套数据模型才找得到想要的那条。现在首次打开只看到二十来个选项，
          钻取条件选中后以可关闭标签露在首层，不用展开也知道当前筛了什么 */}
      {showFilterControls ? (
        <div className="surface space-y-2.5 px-4 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="pr-1 text-xs text-muted-foreground">常用</span>
            {presets.map((preset) => (
              <FilterChip key={preset.key} active={preset.active} href={preset.href}>
                <span title={preset.title}>{preset.label}</span>
              </FilterChip>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="pr-1 text-xs text-muted-foreground">口径</span>
            {LEDGER_SCOPES.map((value) => (
              <FilterChip
                key={value}
                active={scope === value}
                href={hrefWith({
                  scope: value === "promotion" ? null : value,
                  year: null,
                  major: null,
                  minor: null,
                  pmajor: null,
                  pminor: null,
                })}
              >
                {LEDGER_SCOPE_LABELS[value]} <Count n={scopeCounts[value]} />
              </FilterChip>
            ))}

            {isPromotion ? (
              <>
                <span className="w-3" />
                <span className="pr-1 text-xs text-muted-foreground">申报年度</span>
                {queryState.declareYearOptions.map((year) => (
                  <FilterChip
                    key={year}
                    active={declareYear === year}
                    href={hrefWith({ dyear: String(year), year: null })}
                  >
                    {year}{" "}
                    <Count n={outcomeScopeCounts(all, promotionWindow(titleSince, year)).promotion} />
                  </FilterChip>
                ))}
              </>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="pr-1 text-xs text-muted-foreground">年度</span>
            <FilterChip active={yearParam == null} href={hrefWith({ year: null })}>
              全部 <Count n={inScopeCount} />
            </FilterChip>
            {years.map((facet) => (
              <FilterChip
                key={facet.value}
                active={yearParam === String(facet.value)}
                href={hrefWith({ year: String(facet.value) })}
              >
                {facet.value} <Count n={facet.count} />
              </FilterChip>
            ))}
            {shouldRenderMissingYearFacet(queryState, noYear) ? (
              <FilterChip active={yearParam === "none"} href={hrefWith({ year: "none" })}>
                未填年度 <Count n={noYear} />
              </FilterChip>
            ) : null}
          </div>

          {hiddenActive.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="pr-1 text-xs text-muted-foreground">已选</span>
              {hiddenActive.map((item) => (
                <Link
                  key={item.key}
                  href={hrefWith(item.clear)}
                  aria-label={`去掉条件：${item.text}`}
                  className="inline-flex max-w-[20rem] items-center gap-1 rounded-full bg-accent py-1.5 pr-2 pl-3 text-xs text-accent-foreground transition-colors hover:bg-accent/70"
                >
                  <span className="truncate" title={item.text}>
                    {item.text}
                  </span>
                  <X className="size-3 shrink-0 opacity-70" aria-hidden />
                </Link>
              ))}
              <Link
                href={clearFilterHref}
                className="px-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                清除全部
              </Link>
            </div>
          ) : null}

          {/* `<details>` 而不是抽屉：纯服务端渲染、零 JS、键盘和读屏天然可用。
              用户手动展开后点里面的胶囊，页面软导航时 React 不会去动 open 属性
              （前后两次渲染的值都是 false），所以展开状态自然保留 */}
          <details className="group" open={drilling || undefined}>
            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full py-1 text-xs text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
              <ChevronDown
                className="size-3.5 transition-transform group-open:rotate-180"
                aria-hidden
              />
              <span className="group-open:hidden">更多筛选</span>
              <span className="hidden group-open:inline">收起筛选</span>
              <span className="text-muted-foreground">
                {showPerformanceFacets ? "类型 · 绩效分类 · 用途" : "类型 · 职称指标 · 用途"}
              </span>
              {hiddenActive.length > 0 ? (
                <span className="rounded-full bg-primary px-1.5 text-[10px] leading-4 font-medium text-primary-foreground tabular-nums">
                  {hiddenActive.length}
                </span>
              ) : null}
            </summary>

            <div className="mt-2 space-y-2 border-l-2 border-border/60 pl-3">
              {/* **类型和口径正交，所以不跟着口径显隐。** 只有一档时整行不出现 */}
              {types.length > 1 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="pr-1 text-xs text-muted-foreground">类型</span>
                  {/* 这个「全部」不带数字：选了年度之后 inScopeCount 是不分年份的总数，
                      印上去就和右边几个 chip 加起来对不上。绩效大类和用途同理 */}
                  <FilterChip active={!filters.type} href={hrefWith({ type: null })}>
                    全部
                  </FilterChip>
                  {types.map((facet) => (
                    <FilterChip
                      key={facet.value}
                      active={filters.type === facet.value}
                      href={hrefWith({ type: facet.value })}
                    >
                      {OUTCOME_TYPE_LABELS[facet.value]} <Count n={facet.count} />
                    </FilterChip>
                  ))}
                </div>
              ) : null}

              {showPerformanceFacets && majors.length > 0 ? (
                <>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="pr-1 text-xs text-muted-foreground">绩效大类</span>
                    <FilterChip active={!filters.major} href={hrefWith({ major: null, minor: null })}>
                      全部
                    </FilterChip>
                    {majors.map((facet) => (
                      <FilterChip
                        key={facet.value}
                        active={filters.major === facet.value}
                        href={hrefWith({ major: facet.value, minor: null })}
                      >
                        {facet.value} <Count n={facet.count} />
                      </FilterChip>
                    ))}
                  </div>
                  {minors.length > 0 ? (
                    <SubFacetRow
                      label="绩效小类"
                      allHref={hrefWith({ minor: null })}
                      allActive={!filters.minor}
                      facets={minors.map((facet) => ({
                        key: facet.value,
                        text: facet.value,
                        count: facet.count,
                        active: filters.minor === facet.value,
                        href: hrefWith({ minor: facet.value }),
                      }))}
                    />
                  ) : null}
                </>
              ) : null}

              {showPromotionFacets && promotionMajors.length > 0 ? (
                <>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="pr-1 text-xs text-muted-foreground">职称一级指标</span>
                    <FilterChip
                      active={!filters.promotionMajor}
                      href={hrefWith({ pmajor: null, pminor: null })}
                    >
                      全部
                    </FilterChip>
                    {promotionMajors.map((facet) => (
                      <FilterChip
                        key={facet.value}
                        active={filters.promotionMajor === facet.value}
                        href={hrefWith({ pmajor: facet.value, pminor: null })}
                      >
                        {facet.value} <Count n={facet.count} />
                      </FilterChip>
                    ))}
                  </div>
                  {promotionMinors.length > 0 ? (
                    <SubFacetRow
                      label="职称二级指标"
                      allHref={hrefWith({ pminor: null })}
                      allActive={!filters.promotionMinor}
                      facets={promotionMinors.map((facet) => ({
                        key: facet.value,
                        text: `${facet.value} ${facet.label}`,
                        count: facet.count,
                        active: filters.promotionMinor === facet.value,
                        href: hrefWith({ pminor: facet.value }),
                      }))}
                    />
                  ) : null}
                </>
              ) : null}

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="pr-1 text-xs text-muted-foreground">用途</span>
                <FilterChip active={!filters.usage} href={hrefWith({ usage: null })}>
                  全部
                </FilterChip>
                {usages.map((facet) => (
                  <FilterChip
                    key={facet.value}
                    active={filters.usage === facet.value}
                    href={hrefWith({ usage: facet.value })}
                  >
                    {ACHIEVEMENT_USAGE_LABELS[facet.value]} <Count n={facet.count} />
                  </FilterChip>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="pr-1 text-xs text-muted-foreground">异常</span>
                <FilterChip
                  active={filters.needsLinkOnly === true}
                  href={hrefWith({ needslink: filters.needsLinkOnly ? null : "1" })}
                >
                  <span title="标了「结题挂接」用途、却还没挂到任何课题要求上的成果（课题行不受影响）">
                    该挂未挂
                  </span>
                </FilterChip>
                <FilterChip
                  active={filters.unverifiedOnly === true}
                  href={hrefWith({ unverified: filters.unverifiedOnly ? null : "1" })}
                >
                  只看待确认
                </FilterChip>
              </div>
            </div>
          </details>

          {/* 合计跟着筛选走，贴在筛选条件下面用一道分隔线隔开 */}
          <div className="border-t border-border/60 pt-2">{totalsLine}</div>
        </div>
      ) : null}

      {showFilterControls ? null : <div className="px-1">{totalsLine}</div>}

      {isPromotion && inScopeCount < all.length ? (
        <p className="px-1 text-xs text-muted-foreground">
          职称口径只显示挂了职称指标、且位于任现职申报时间窗内的课题或成果。时间窗
          {window.from
            ? `自 ${formatDateOnly(window.from)} 起`
            : "（档案未填任现职日期，只卡上限）"}
          算到 {window.toYear}-12-31 为止（按 {declareYear} 年申报算）。
          {/* **这句必须带数字和链接。** 新建的课题和刚引用的成果都还没挂职称指标，
              在默认口径下一条也看不见——只说规则不说「还有多少条没显示」，
              用户会以为刚建的东西没存上 */}
          另有{" "}
          <span className="tabular-nums">{all.length - inScopeCount}</span>{" "}
          条不在本口径（多是还没挂职称指标的），
          <Link
            href={outOfScopeHref}
            className="text-foreground underline underline-offset-4"
          >
            切到「全部」
          </Link>
          查看。
          {scoreOnly > 0 ? (
            <>
              {" "}
              其中 <span className="tabular-nums">{scoreOnly}</span>{" "}
              条填了职称分却没挂指标，是该优先订正的。
            </>
          ) : null}
        </p>
      ) : null}

      {/* 绩效口径的同一个坑：课题只有登记了绩效事项才在这里出现，而「申报了没中
          也有基本分」这件事系统不替人登记（第 1 条铁律）。不报数的话，用户看到的是
          「我申报过的课题在成果页里找不到」，而不是「还差一步登记」。
          **不跟年度筛选走**——「哪一年该有哪一条」得靠日期猜，这里只报从没登记过的 */}
      {scope === "performance" && unregisteredProjects.length > 0 ? (
        <details className="group px-1 text-xs text-muted-foreground">
          <summary className="measure cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            绩效口径下，课题要在详情页登记了「课题绩效事项」才会出现——申报（没中也算）、
            立项、到账、结题各登记一条。另有{" "}
            <span className="tabular-nums">{unregisteredProjects.length}</span>{" "}
            个课题一条都没登记过，
            <span className="text-foreground underline underline-offset-4">
              <span className="group-open:hidden">展开名单</span>
              <span className="hidden group-open:inline">收起名单</span>
            </span>
            。
          </summary>
          <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {unregisteredProjects.map((row) => (
              <li key={row.key} className="flex min-w-0 items-baseline gap-2">
                {/* 带 returnTo：登记完点返回键要回到这份绩效口径的列表确认它出现了，
                    和本页其余课题链接同一个规矩（lib/outcomes/links.ts） */}
                <Link
                  href={`${outcomeProjectHref(row.id, outcomePath)}#performance`}
                  title={row.title}
                  className="min-w-0 truncate text-foreground underline-offset-4 hover:underline"
                >
                  {row.title}
                </Link>
                <span className="shrink-0">
                  {PROJECT_STATUS_LABELS[row.projectStatus]}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {filtered.length === 0 ? (
        <div className="surface p-14 text-center">
          <p className="text-muted-foreground">
            {all.length === 0
              ? "还没有课题或成果。"
              : "没有符合当前筛选的课题或成果。"}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            新建成果只会创建实际产出；课题请从科研页新建和维护。
          </p>
        </div>
      ) : (
        // **横滚容器只在 lg 以下才要。** 滚动容器会把 `thead` 的 sticky
        // 锚到自己身上，表头就永远粘不住。列都限了宽之后，lg 以上一定
        // 装得进内容区，不需要横滚——去掉 overflow 才换得到吸顶的表头。
        // 这一层和 Table 内部那层都要改，漏一个就白搭
        <>
          {/* 手机上换成摘要列表，表格隐藏（理由见 outcome-summary-item.tsx）。
              **两份都渲染、用 CSS 切**，不按 UA 判断：服务端组件拿不到视口宽度，
              猜错了用户就看到另一套；平板横竖屏一转也得跟着变 */}
          <ul className="surface divide-y divide-border/60 overflow-hidden md:hidden">
            {(groups ?? [flatGroup]).map((group, index) => (
              <Fragment key={group.key}>
                {groups ? (
                  <OutcomeGroupHeaderItem
                    label={group.label}
                    count={group.rows.length}
                    score={group.score}
                    scoreLabel={scoreLabel}
                    first={index === 0}
                  />
                ) : null}
                {group.rows.map((row) => (
                  <OutcomeSummaryItem
                    key={`${group.key}:${row.key}`}
                    row={row}
                    scope={scope}
                    currentOutcomePath={outcomePath}
                    filters={rowFilters}
                    entryGroup={group.entryGroup}
                  />
                ))}
              </Fragment>
            ))}
          </ul>
        <OutcomeInspector panels={panels}>
          <div className="surface p-1 max-md:hidden">
            <Table containerClassName="max-lg:overflow-x-auto">
              {/* 吸顶在顶栏（72px）正下方。**底色必须不透明**：
                浅色下 --card 就是纯白没问题，深色下它是 5.5% 的半透明白，
                滚动时下面的行会直接透上来。走 --popover，理由和浮层同一条
                （CLAUDE.md 视觉语言） */}
              {/* **top 必须按断点分开写。** lg 以下外层那个 max-lg:overflow-x-auto
                是滚动容器（overflow-x: auto 会把 overflow-y 一并算成 auto），
                thead 于是改锚在它身上；容器 scrollTop 恒为 0，top-[var(--topbar-h)] 的含义
                就变成「从静态位置往下推 72px」，正好压住头一两行。
                72px 是顶栏高度，那是相对**页面**滚动的口径，只在没有滚动容器时
                才成立——所以窄屏走 top-0（滚动容器里等同于不吸顶，横滚照旧），
                lg 以上没有滚动容器，才轮到 top-[var(--topbar-h)] 真正吸在顶栏下沿 */}
              <TableHeader className="sticky max-lg:top-0 lg:top-[var(--topbar-h)] z-10 bg-popover">
                <TableRow>
                  <TableHead className="min-w-[20rem]">题目</TableHead>
                  <TableHead className="whitespace-nowrap">年度</TableHead>
                  <TableHead className="w-[15rem]">
                    {isPromotion ? "职称指标" : "绩效分类"}
                  </TableHead>
                  {/* 这三列在面板打开时让位——面板里全都有，
                      理由见 outcome-inspector.tsx 里 `data-open` 那段 */}
                  <TableHead className="whitespace-nowrap group-data-[open=true]/insp:hidden">
                    类型 / 级别
                  </TableHead>
                  <TableHead className="whitespace-nowrap text-right group-data-[open=true]/insp:hidden">
                    {isPromotion ? "职称分" : "申报分"}
                  </TableHead>
                  <TableHead className="whitespace-nowrap group-data-[open=true]/insp:hidden">
                    材料
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(groups ?? [flatGroup]).map((group, index) => (
                  <Fragment key={group.key}>
                    {groups ? (
                      <OutcomeGroupHeaderRow
                        label={group.label}
                        count={group.rows.length}
                        score={group.score}
                        scoreLabel={scoreLabel}
                        first={index === 0}
                      />
                    ) : null}
                    {group.rows.map((row) => (
                      <OutcomeRow
                        key={`${group.key}:${row.key}`}
                        row={row}
                        scope={scope}
                        currentOutcomePath={outcomePath}
                        filters={rowFilters}
                        promotionOptions={promotionOptions}
                        perfOptions={perfOptions}
                        entryGroup={group.entryGroup}
                      />
                    ))}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        </OutcomeInspector>
        </>
      )}
    </div>
  );
}
