import Link from "next/link";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

const controlClass =
  "h-9 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

export type RecordFilterValues = {
  menteeId?: string;
  typeId?: string;
  from?: string;
  to?: string;
};

/**
 * 指导记录的筛选 + 导出。
 *
 * **筛选走 URL 上的 GET 表单**，不是客户端 state：能收藏、能后退，
 * 而且导出表单直接把同一组参数原样 POST 出去——
 * 两边各写一套筛选，早晚出现「界面上 12 条、导出来 30 条」。
 *
 * 导出是原生 form POST 不是 fetch：proxy.ts 对未登录的 /api/* 返回 307，
 * fetch 默认跟随重定向会把登录页 HTML 当成 xlsx 存下来。
 */
export function RecordsFilter({
  batchId,
  mentees,
  types,
  values,
  resultCount,
}: {
  batchId: string;
  mentees: Array<{ id: string; name: string }>;
  types: Array<{ id: string; name: string }>;
  values: RecordFilterValues;
  resultCount: number;
}) {
  const active = Boolean(values.menteeId || values.typeId || values.from || values.to);

  return (
    <div className="surface flex flex-wrap items-end gap-3 p-4">
      <form method="get" className="flex flex-wrap items-end gap-3">
        {/* 批次不在筛选里，但必须带着走，否则一筛就跳回最近一届 */}
        <input type="hidden" name="batch" value={batchId} />

        <label className="space-y-1.5 text-sm">
          <span className="block text-xs text-muted-foreground">学生</span>
          <select name="mentee" defaultValue={values.menteeId ?? ""} className={controlClass}>
            <option value="">全部</option>
            {mentees.map((mentee) => (
              <option key={mentee.id} value={mentee.id}>
                {mentee.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1.5 text-sm">
          <span className="block text-xs text-muted-foreground">类型</span>
          <select name="type" defaultValue={values.typeId ?? ""} className={controlClass}>
            <option value="">全部</option>
            {types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1.5 text-sm">
          <span className="block text-xs text-muted-foreground">从</span>
          <input
            type="date"
            name="from"
            defaultValue={values.from ?? ""}
            className={controlClass}
          />
        </label>

        <label className="space-y-1.5 text-sm">
          <span className="block text-xs text-muted-foreground">到</span>
          <input
            type="date"
            name="to"
            defaultValue={values.to ?? ""}
            className={controlClass}
          />
        </label>

        <Button type="submit" size="sm" variant="secondary">
          筛选
        </Button>
        {active ? (
          <Button
            render={
              <Link href={`/mentees/records?batch=${encodeURIComponent(batchId)}`} />
            }
            nativeButton={false}
            size="sm"
            variant="ghost"
            className="bg-well"
          >
            清空
          </Button>
        ) : null}
      </form>

      <div className="ml-auto flex items-center gap-3">
        <span className="text-xs text-muted-foreground tabular-nums">
          {resultCount} 条
        </span>
        <form action="/api/export/mentee-records" method="post">
          <input type="hidden" name="batchId" value={batchId} />
          {values.menteeId ? (
            <input type="hidden" name="menteeId" value={values.menteeId} />
          ) : null}
          {values.typeId ? (
            <input type="hidden" name="typeId" value={values.typeId} />
          ) : null}
          {values.from ? <input type="hidden" name="from" value={values.from} /> : null}
          {values.to ? <input type="hidden" name="to" value={values.to} /> : null}
          <Button type="submit" size="sm" variant="secondary" disabled={resultCount === 0}>
            <Download className="size-3.5" aria-hidden />
            导出汇总表
          </Button>
        </form>
      </div>
    </div>
  );
}
