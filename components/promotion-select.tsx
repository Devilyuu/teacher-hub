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
 */
export function PromotionSelect({
  name,
  options,
  defaultValue,
  className,
  ariaLabel = "职称量化指标",
}: {
  name: string;
  options: PromotionOption[];
  defaultValue?: string | null;
  className?: string;
  ariaLabel?: string;
}) {
  const groups = groupByMajorIndicator(options);

  return (
    <select
      name={name}
      defaultValue={defaultValue ?? ""}
      className={className}
      aria-label={ariaLabel}
    >
      <option value="">不计入职称</option>
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
