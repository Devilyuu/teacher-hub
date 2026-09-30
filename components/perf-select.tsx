import type { PerfOption } from "@/lib/queries/perf-categories";

/**
 * 绩效分类下拉（学校绩效积分表的大类 + 小类）。
 *
 * 原生 `<select>`，理由同 PromotionSelect：shadcn 的 Select 不进 FormData。
 *
 * **空值是有意义的一档**：挂不上绩效小类就表示这条不进浮动绩效统计，
 * 所以第一项写「不计入绩效」而不是「请选择」——和职称那边保持同一套说法。
 *
 * 小类原文最长的一条有 40 多个字（党建思政类的小类常常一条就写满一句话），
 * 下拉里不截断：这是要照着原文挑的，截断了就挑不准。
 *
 * 已挂的小类不在候选里（旧年度的表、已停用）时补一项「保持不动」，理由同 PromotionSelect：
 * 不补的话一保存就把原来的挂接悄悄清掉。
 */
export function PerfSelect({
  name,
  options,
  defaultValue,
  currentLabel,
  className,
  ariaLabel = "绩效分类",
}: {
  name: string;
  options: PerfOption[];
  defaultValue?: string | null;
  /** 已挂那一项的名字。给了就照写，没给写「原来挂的小类」 */
  currentLabel?: string | null;
  className?: string;
  ariaLabel?: string;
}) {
  const groups = new Map<string, PerfOption[]>();
  for (const option of options) {
    groups.set(option.majorCategory, [...(groups.get(option.majorCategory) ?? []), option]);
  }
  const keepsCurrent = Boolean(defaultValue) && !options.some((option) => option.id === defaultValue);

  return (
    <select
      name={name}
      defaultValue={defaultValue ?? ""}
      className={className}
      aria-label={ariaLabel}
    >
      <option value="">不计入绩效</option>
      {keepsCurrent ? (
        <option value={defaultValue!}>{currentLabel ?? "原来挂的小类"}（不在当前的表里，保持不动）</option>
      ) : null}
      {[...groups.entries()].map(([major, items]) => (
        <optgroup key={major} label={major}>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.minorCategory}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
