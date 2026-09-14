import Link from "next/link";
import { Paperclip } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TableCell } from "@/components/ui/table";
import {
  ACHIEVEMENT_TYPE_LABELS,
  ACHIEVEMENT_USAGE_LABELS,
  LEVEL_LABELS,
  PROJECT_STATUS_LABELS,
} from "@/lib/labels";
import {
  type LedgerScope,
  type OutcomeFilters,
  sumNumericScore,
} from "@/lib/outcomes/filters";
import type { UnifiedOutcomeRow } from "@/lib/outcomes/types";
import {
  displayOutcomeYears,
  outcomeRowViewModel,
  outcomeTimeText,
} from "@/lib/outcomes/view-model";
import type { PerfOption } from "@/lib/queries/perf-categories";
import type { PromotionOption } from "@/lib/promotion";
import { cn } from "@/lib/utils";
import { OutcomeTitleButton, SelectableRow } from "./outcome-inspector";
import { QuickEditRow } from "./quick-edit-row";

type OutcomeRowProps = {
  row: UnifiedOutcomeRow;
  scope: LedgerScope;
  currentOutcomePath: string;
  filters: Pick<OutcomeFilters, "year" | "major" | "minor" | "unverifiedOnly">;
  promotionOptions: PromotionOption[];
  perfOptions: PerfOption[];
};

/**
 * 材料数。**0 也走同一个形状**，不再单独描一个「缺材料」的框。
 *
 * 台账里九成的行都没挂材料，满屏都是框的时候它就不是警告而是墙纸了，
 * 还平白多出一列参差的边。统一成「回形针 + 数字」之后，
 * 0 自己就说明了缺，而且各行的数字能竖着比。
 */
function AttachmentCount({ count }: { count: number }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs tabular-nums",
        count === 0 ? "text-muted-foreground/50" : "text-muted-foreground",
      )}
      title={count === 0 ? "还没有材料" : `${count} 份材料`}
    >
      <Paperclip className="size-3" aria-hidden />
      {count}
    </span>
  );
}

export function OutcomeRow({
  row,
  scope,
  currentOutcomePath,
  filters,
  promotionOptions,
  perfOptions,
}: OutcomeRowProps) {
  const view = outcomeRowViewModel(row, {
    scope,
    currentOutcomePath,
    filters,
  });
  const promotion = scope === "promotion";
  // 和右侧面板共用同一套算法：面板里的年度/日期必须和它旁边这一行对得上
  const { yearText, dateSubline } = outcomeTimeText(
    row,
    view.performanceEntries,
    promotion,
  );
  const score = promotion
    ? row.promotionScore
    : view.performanceEntries.some((entry) => entry.declaredScore != null)
      ? sumNumericScore(
          view.performanceEntries.map((entry) => entry.declaredScore),
        )
      : null;

  if (row.kind === "PROJECT") {
    return (
      <SelectableRow rowKey={row.key}>
        {/* 课题行压成一行：状态跟在标题后面当小字。
            **「N 个绩效事项」只在「绩效分类」列里出现一次**——
            原来这里和那一列各印一遍，同一个数字在一行里出现两次 */}
        <TableCell className="align-top">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <OutcomeTitleButton
              rowKey={row.key}
              title={row.title}
              className="max-w-[40rem] font-medium group-data-[open=true]/insp:max-w-[20rem]"
            />
            <Badge variant="secondary">课题</Badge>
            {view.schoolRewarded ? (
              <Badge variant="outline">学校已奖励</Badge>
            ) : null}
            <span className="text-xs text-muted-foreground">
              {PROJECT_STATUS_LABELS[row.projectStatus]}
            </span>
          </div>
        </TableCell>
        <TableCell className="align-top tabular-nums whitespace-nowrap">
          {promotion
            ? (row.promotionYear ?? (
                <span className="text-muted-foreground">—</span>
              ))
            : displayOutcomeYears(
                view.performanceEntries.map((entry) => entry.year),
              )}
        </TableCell>
        {/* `whitespace-normal` 不能省：shadcn 的 TableCell 默认带
            `whitespace-nowrap`，`line-clamp-2` 就永远换不了行——
            绩效小类原文四十多个字，会被直接切掉而且连省略号都没有。
            列够宽时看不出来，面板一开列变窄就暴露了 */}
        <TableCell className="w-[15rem] max-w-[15rem] align-top text-xs whitespace-normal">
          {promotion ? (
            row.promotionCategory ? (
              <>
                <div className="truncate">
                  {row.promotionCategory.code}{" "}
                  {row.promotionCategory.minorIndicator}
                </div>
                <div className="truncate text-muted-foreground">
                  {row.promotionCategory.majorIndicator}
                </div>
              </>
            ) : (
              <span className="text-muted-foreground">—</span>
            )
          ) : (
            <>
              <div className="text-muted-foreground">
                {view.performanceCount} 个绩效事项
              </div>
              <div className="line-clamp-2" title={view.performanceSummary}>
                {view.performanceSummary}
              </div>
            </>
          )}
        </TableCell>
        <TableCell className="align-top text-xs whitespace-nowrap group-data-[open=true]/insp:hidden">
          <div>课题</div>
          <div className="text-muted-foreground">{LEVEL_LABELS[row.level]}</div>
        </TableCell>
        <TableCell className="align-top text-right tabular-nums group-data-[open=true]/insp:hidden">
          {score == null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            String(score)
          )}
        </TableCell>
        <TableCell className="align-top group-data-[open=true]/insp:hidden">
          <AttachmentCount count={row.attachmentCount} />
        </TableCell>
      </SelectableRow>
    );
  }

  return (
    <SelectableRow rowKey={row.key}>
      {/* 三行压成两行：日期挪进「年度」列（同一件事归一列），
          「订正」从第三行提到标题右侧的图标按钮。
          原来第三行只为了放一个日期和一个 100 行都长一样的「订正」，
          却让每行都高出 30px——100 行就是 3000px 的滚动 */}
      <TableCell className="align-top">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <OutcomeTitleButton
            rowKey={row.key}
            title={row.title}
            className="max-w-[40rem] font-medium group-data-[open=true]/insp:max-w-[20rem]"
          />
          {view.schoolRewarded ? (
            <Badge variant="outline">学校已奖励</Badge>
          ) : null}
          {view.quickEdit ? (
            <QuickEditRow
              defaults={view.quickEdit}
              promotionOptions={promotionOptions}
              perfOptions={perfOptions}
            />
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs empty:mt-0">
          {row.needsLink ? (
            <span
              className="rounded bg-[var(--h-amber-bg)] px-1.5 py-0.5 text-[var(--h-amber-fg)]"
              title="用途里勾了「结题挂接」，但还没挂到任何一条结题要求上"
            >
              该挂未挂
            </span>
          ) : null}
          {!row.isVerified ? (
            <span className="rounded border px-1.5 py-0.5 text-muted-foreground">
              待确认
            </span>
          ) : null}
          {row.promotionScore != null && row.promotionCategory == null ? (
            <span
              className="rounded bg-[var(--h-amber-bg)] px-1.5 py-0.5 text-[var(--h-amber-fg)]"
              title="填了职称分，但职称指标是「不计入职称」"
            >
              填了分未挂指标
            </span>
          ) : null}
          {row.usableFor.map((usage) => (
            <span
              key={usage}
              className="rounded border px-1.5 py-0.5 text-muted-foreground"
            >
              {ACHIEVEMENT_USAGE_LABELS[usage]}
            </span>
          ))}
          {row.tags.map((tag) => (
            <span key={tag} className="text-muted-foreground/70">
              #{tag}
            </span>
          ))}
          {view.linkedProjects.map((project) => (
            <Link
              key={project.id}
              href={project.href}
              className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              挂：{project.name}
            </Link>
          ))}
        </div>
      </TableCell>
      {/* 年度与日期同列。**两者不是一回事**——年度是绩效申报年度，
          日期是发表/完成的原文（按 datePrecision 渲染，第 8 条铁律）——
          但它俩回答的都是「什么时候」，分在两处看只会让人以为其中一个印错了 */}
      <TableCell className="align-top tabular-nums whitespace-nowrap">
        <div>
          {promotion
            ? (row.promotionYear ?? (
                <span className="text-muted-foreground">—</span>
              ))
            : yearText}
        </div>
        {/* 日期只在比年度多说了点什么的时候才出现（outcomeDateSubline） */}
        {dateSubline ? (
          <div className="text-xs text-muted-foreground">{dateSubline}</div>
        ) : null}
      </TableCell>
      {/* 同上：`whitespace-normal` 让 line-clamp 能换行，宽度与课题分支一致 */}
      <TableCell className="w-[15rem] max-w-[15rem] align-top text-xs whitespace-normal">
        {promotion ? (
          row.promotionCategory ? (
            <>
              <div className="truncate">
                {row.promotionCategory.code}{" "}
                {row.promotionCategory.minorIndicator}
              </div>
              <div className="truncate text-muted-foreground">
                {row.promotionCategory.majorIndicator}
              </div>
            </>
          ) : (
            <span className="text-muted-foreground">—</span>
          )
        ) : (
          <div
            className="line-clamp-2 text-muted-foreground"
            title={view.performanceSummary}
          >
            {view.performanceSummary}
          </div>
        )}
      </TableCell>
      <TableCell className="align-top text-xs whitespace-nowrap group-data-[open=true]/insp:hidden">
        <div>{ACHIEVEMENT_TYPE_LABELS[row.achievementType]}</div>
        <div className="text-muted-foreground">{LEVEL_LABELS[row.level]}</div>
      </TableCell>
      <TableCell className="align-top text-right tabular-nums group-data-[open=true]/insp:hidden">
        {score == null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          String(score)
        )}
      </TableCell>
      <TableCell className="align-top group-data-[open=true]/insp:hidden">
        <AttachmentCount count={row.attachmentCount} />
      </TableCell>
    </SelectableRow>
  );
}
