import { groupByMajorIndicator, promotionOptionLabel, type PromotionOption } from "@/lib/promotion";

/**
 * 职称量化指标下拉（人事处职称量化考核表的二级指标）。
 *
 * 原生 `<select>`，不用 shadcn 的 Select——后者的值不进 FormData，
 * 而 Server Action 靠 FormData 取值（代码约定）。
 *
 * **空值是有意义的一档，不是"还没选"。** 挂不上任何指标就意味着这条
 * 评职称用不上，成果库的职称口径据此把它过滤掉。所以第一项的文案是
 * 「不计入职称」而不是「请选择」。
 *
 * **已挂的指标不在候选里时要补一项「保持不动」**：候选只有当前在用的那一版表，
 * 导入了新一年的表、或者课题表单只列「课题可挂」的几项之后，老记录挂的那一格就不在里面了。
 * 不补的话下拉落到「不计入职称」，一保存就把原来的挂接悄悄清掉（2026-09-27）。
 */
export function PromotionSelect({
  name,
  options,
  defaultValue,
  currentLabel,
  className,
  ariaLabel = "职称量化指标",
}: {
  name: string;
  options: PromotionOption[];
  defaultValue?: string | null;
  /** 已挂那一格的名字（「5.2 纵向课题（2025 版）」）。给了就照写，没给写「原来挂的指标」 */
  currentLabel?: string | null;
  className?: string;
  ariaLabel?: string;
}) {
  const groups = groupByMajorIndicator(options);
  const keepsCurrent = Boolean(defaultValue) && !options.some((option) => option.id === defaultValue);

  return (
    <select
      name={name}
      defaultValue={defaultValue ?? ""}
      className={className}
      aria-label={ariaLabel}
    >
      <option value="">不计入职称</option>
      {keepsCurrent ? (
        <option value={defaultValue!}>{currentLabel ?? "原来挂的指标"}（不在当前的表里，保持不动）</option>
      ) : null}
      {groups.map((group) => (
        <optgroup key={group.majorIndicator} label={group.majorIndicator}>
          {group.items.map((item) => (
            <option key={item.id} value={item.id}>
              {promotionOptionLabel(item)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
