"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, Paperclip, X } from "lucide-react";
import { TableRow } from "@/components/ui/table";
import type { OutcomePanelData } from "@/lib/outcomes/view-model";
import { cn } from "@/lib/utils";

/**
 * 成果台账的右侧详情面板。
 *
 * **为什么要它**：核实和订正是批量活——扫一行、看清佐证、改分类、下一行。
 * 原来点一条成果是整页跳走，回来靠「回到刚才的列表」，筛选还在但滚动位置没了，
 * 一百条过一遍要跳一百个来回。面板让「列表」和「看清一条」同屏。
 *
 * **不额外查库、不开 API Route**：列表页已经把整份 `UnifiedOutcomeRow` 取回来了，
 * 面板要的每一项都在里面，这里只是把同一份数据换个排布。所以选中是纯客户端状态，
 * 点一行是零延迟——换成 URL 参数就得让 100 行的服务端组件整棵重渲染。
 *
 * 代价是选中态不进 URL、分享不了。对「就地核实」这个用法不重要，
 * 真要看全貌，面板底部有「打开完整详情」。
 */

type SelectionContext = {
  selectedKey: string | null;
  select: (key: string) => void;
};

const Ctx = createContext<SelectionContext | null>(null);

function useSelection(): SelectionContext {
  const ctx = useContext(Ctx);
  // 面板之外也会用到这几个组件（比如空态），拿不到 context 时静默降级成「不可选」，
  // 而不是把整页炸掉
  return ctx ?? { selectedKey: null, select: () => {} };
}

/**
 * 表格行。**服务端渲染的行是作为 children 传进来的**，
 * 所以它们内部的 `SelectableRow` 仍在本 provider 之下，context 照常流通。
 */
export function OutcomeInspector({
  panels,
  children,
}: {
  panels: Record<string, OutcomePanelData>;
  children: ReactNode;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = selectedKey ? panels[selectedKey] : null;

  return (
    <Ctx.Provider value={{ selectedKey, select: setSelectedKey }}>
      {/* `data-open` 给表格用：面板一开，表格宽度被砍掉 352px，六列的最小宽度
          （题目 20rem + 分类 15rem + 四列 nowrap）压不进去。
          解法**不是让它横滚**——那样右边三列滚出视野还没有任何提示，
          而且滚动容器会把 `thead` 的 sticky 锚到自己身上，表头会被顶到
          第一行下面去（实测过，比不吸顶更糟）。
          解法是**隐藏那三列**：类型/级别、分值、材料在面板里全都有，
          列表没必要再印一遍。剩下三列约 700px，装进 912px 还有余量，
          吸顶也保住了 */}
      <div
        className="group/insp flex items-start gap-4"
        data-open={selected ? "true" : undefined}
      >
        <div className="min-w-0 flex-1">{children}</div>

        {/* 面板只在 xl 以上出现。再窄就没有它和表格并排的余地了，
            那时点标题回到老路子：直接跳详情页 */}
        {selected ? (
          <aside
            aria-label="成果详情"
            className="surface sticky top-[calc(var(--topbar-h)+1rem)] hidden max-h-[calc(100vh-6rem)] w-[22rem] shrink-0 overflow-y-auto p-5 xl:block"
          >
            <OutcomePanel
              data={selected}
              onClose={() => setSelectedKey(null)}
            />
          </aside>
        ) : null}
      </div>
    </Ctx.Provider>
  );
}

/** 可选中的表格行。选中态用中性的 `bg-accent`——语义色是健康度的，装饰不许碰 */
export function SelectableRow({
  rowKey,
  className,
  children,
}: {
  rowKey: string;
  className?: string;
  children: ReactNode;
}) {
  const { selectedKey } = useSelection();
  return (
    <TableRow
      data-selected={selectedKey === rowKey ? "true" : undefined}
      className={cn(
        "data-[selected=true]:bg-accent",
        // 左沿一道实心条，扫的时候比整行底色更容易定位到「我看的是哪条」
        "data-[selected=true]:shadow-[inset_3px_0_0_0_var(--primary)]",
        className,
      )}
    >
      {children}
    </TableRow>
  );
}

/**
 * 标题即面板开关。
 *
 * 原来它是个跳转链接。改成按钮之后**丢掉了中键新开标签页**，换来的是
 * 台账最常见的动作从「跳走再回来」变成「就地看一眼」——详情页仍然一键可达，
 * 在面板底部。
 */
export function OutcomeTitleButton({
  rowKey,
  title,
  className,
}: {
  rowKey: string;
  title: string;
  className?: string;
}) {
  const { selectedKey, select } = useSelection();
  return (
    <button
      type="button"
      onClick={() => select(rowKey)}
      title={title}
      aria-expanded={selectedKey === rowKey}
      className={cn(
        "truncate text-left underline-offset-4 hover:underline",
        className,
      )}
    >
      {title}
    </button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
      {children}
    </span>
  );
}

function OutcomePanel({
  data,
  onClose,
}: {
  data: OutcomePanelData;
  onClose: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip>{data.entityLabel}</Chip>
          {/* 核实状态只有成果有。**「待确认」这个词只归它**，
              级别叫「未定级」、日期叫「日期未填」（CLAUDE.md 术语那节） */}
          {data.isVerified === true ? (
            <span className="rounded-full bg-[var(--h-green-bg)] px-2.5 py-1 text-xs font-medium text-[var(--h-green-fg)]">
              已核实
            </span>
          ) : data.isVerified === false ? (
            <span className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground">
              待确认
            </span>
          ) : null}
          {data.schoolRewarded ? <Chip>学校已奖励</Chip> : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭详情"
          title="关闭"
          className="-mr-1 -mt-1 shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <h2 className="text-base leading-snug font-medium">{data.title}</h2>

      <div className="flex flex-wrap items-center gap-1.5">
        <Chip>{data.typeLabel}</Chip>
        <Chip>{data.levelLabel}</Chip>
        <Chip>{data.statusLabel}</Chip>
      </div>

      {/* 软提示只说不拦（第 3 条铁律）。列表行里也有同样几条，
          面板里给足空间把话说完整 */}
      {data.warnings.length > 0 ? (
        <ul className="space-y-1.5">
          {data.warnings.map((text) => (
            <li
              key={text}
              className="rounded-lg bg-[var(--h-amber-bg)] px-3 py-2 text-xs leading-relaxed text-[var(--h-amber-fg)]"
            >
              {text}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="space-y-4 border-t pt-4">
        <Field label="时间">
          <span className="tabular-nums">{data.yearText}</span>
          {data.dateText ? (
            <span className="ml-2 text-muted-foreground tabular-nums">
              {data.dateText}
            </span>
          ) : null}
        </Field>

        {/* 两套坐标系各占一块，**中间隔开**——它们不是一件事的两种叫法 */}
        <Field label="绩效口径">
          {data.performance.length === 0 ? (
            <span className="text-muted-foreground">未挂绩效分类</span>
          ) : (
            <ul className="space-y-2">
              {data.performance.map((entry) => (
                <li key={entry.id} className="rounded-lg bg-muted/60 px-3 py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {entry.yearText}
                    </span>
                    <span className="text-xs tabular-nums">
                      申报分 {entry.scoreText}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed">
                    {entry.category}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Field>

        <Field label="职称口径">
          {data.promotion ? (
            <div className="rounded-lg bg-muted/60 px-3 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {data.promotion.code}
                </span>
                <span className="text-xs tabular-nums">
                  职称分 {data.promotionScoreText}
                </span>
              </div>
              <p className="mt-0.5 text-xs leading-relaxed">
                {data.promotion.minor}
              </p>
              <p className="text-xs text-muted-foreground">
                {data.promotion.major}
              </p>
            </div>
          ) : (
            <span className="text-muted-foreground">不计入职称</span>
          )}
        </Field>

        {data.usageLabels.length > 0 ? (
          <Field label="用途">
            <div className="flex flex-wrap gap-1.5">
              {data.usageLabels.map((label) => (
                <Chip key={label}>{label}</Chip>
              ))}
            </div>
          </Field>
        ) : null}

        {data.linkedProjects.length > 0 ? (
          <Field label="挂接课题">
            <ul className="space-y-1">
              {data.linkedProjects.map((project) => (
                <li key={project.id}>
                  <Link
                    href={project.href}
                    className="text-sm underline-offset-4 hover:underline"
                  >
                    {project.name}
                  </Link>
                </li>
              ))}
            </ul>
          </Field>
        ) : null}

        {data.tags.length > 0 ? (
          <Field label="主题标签">
            <p className="text-xs text-muted-foreground">
              {data.tags.map((tag) => `#${tag}`).join("  ")}
            </p>
          </Field>
        ) : null}

        <Field label="材料">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-sm tabular-nums",
              data.attachmentCount === 0 && "text-muted-foreground",
            )}
          >
            <Paperclip className="size-3.5" aria-hidden />
            {data.attachmentCount} 份
          </span>
        </Field>
      </div>

      <Link
        href={data.href}
        className="flex items-center justify-center gap-1.5 rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        打开完整详情
        <ArrowUpRight className="size-4" aria-hidden />
      </Link>
    </div>
  );
}
