/**
 * 成果列表的分组标题（分组口径见 lib/outcomes/grouping.ts）。
 *
 * **标题是表格里的一行，不是每组一张卡片。** 每组各画一张表的话，列宽按各组
 * 自己的内容算，上下两组的「年度」「申报分」对不齐；吸顶表头和右侧面板
 * （outcome-inspector.tsx）也都是按「整页一张表」写的。一张表 + 组标题行，
 * 三样都不用动。
 *
 * **组之间靠留白 + 字号分开，不靠加重底色，也不吸顶。** `--well`（#edf2f1）和白卡
 * 只差一档明度，单凭底色，组标题看上去就是「又一行数据」。所以：**非首组上方
 * 留一道真空白**，band 上下各一条实线收口，标题比正文大一档并加粗——
 * 留白负责「这里断开了」，实线负责「断在哪一行」，字号负责「这行是标题不是数据」。
 *
 * **试过吸顶，放弃了**：深色下 `--well` 是半透明白（globals.css 文件头第 2 条），
 * 粘住之后下面的行会透上来；要修得新加一个不透明令牌，而那要同步改
 * `docs/design-contract/tokens.css`，备课系统得跟着动。留白和字号不碰主题层，
 * 两套配色下都成立。再往下就只剩上颜色，而分类是正交维度不是状态，不许上色。
 *
 * **条数和小计都贴着标题放在左边。** 右对齐能和「分数」列对齐，好看，
 * 但组标题横跨 6 列，表格一横滚小计就滑出视野——而 1440 屏展开侧栏时
 * 这张表正好会横滚（CLAUDE.md 那条可用宽度的算法）。
 */

/** 0.1 + 0.2 这类浮点尾巴不该印到界面上 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

type GroupHeaderProps = {
  label: string;
  count: number;
  score: number;
  /** 「申报分」或「职称分」，跟表头那一列同名 */
  scoreLabel: string;
  /** 首组上方不留白：紧贴表头才不会多出一道空带 */
  first?: boolean;
};

function GroupHeaderContent({
  label,
  count,
  score,
  scoreLabel,
}: Omit<GroupHeaderProps, "first">) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
      <span className="text-base leading-tight font-bold text-foreground">
        {label}
      </span>
      <span className="text-xs tabular-nums text-muted-foreground">
        {count} 条
      </span>
      <span className="text-xs text-muted-foreground">
        {scoreLabel}小计{" "}
        <span className="font-medium tabular-nums text-foreground">
          {round2(score)}
        </span>
      </span>
    </div>
  );
}

/**
 * 桌面表格里的组标题行。
 *
 * 留白用一个**独立的空行**而不是给 band 加 padding：加 padding 的话那段空间
 * 会被 well 底色填满，看到的是「更厚的一条带子」而不是「断开了」。
 * 空行 `aria-hidden`，读屏不会念出一个空单元格。
 */
export function OutcomeGroupHeaderRow({ first, ...props }: GroupHeaderProps) {
  return (
    <>
      {first ? null : (
        <tr aria-hidden="true">
          <td colSpan={6} className="h-8 border-0 p-0" />
        </tr>
      )}
      <tr className="border-y bg-well">
        <th
          colSpan={6}
          scope="colgroup"
          className="px-3 py-3 text-left font-normal whitespace-normal"
        >
          <GroupHeaderContent {...props} />
        </th>
      </tr>
    </>
  );
}

/** 手机摘要列表里的组标题。`divide-y` 已经画了分隔线，这里只补留白 */
export function OutcomeGroupHeaderItem({ first, ...props }: GroupHeaderProps) {
  return (
    <li className={`bg-well px-4 ${first ? "py-2.5" : "pt-5 pb-2.5"}`}>
      <GroupHeaderContent {...props} />
    </li>
  );
}
