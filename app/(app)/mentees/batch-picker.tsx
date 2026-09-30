"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type BatchOption = {
  id: string;
  name: string;
  archived: boolean;
  menteeCount: number;
};

const selectClass =
  "h-9 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * 批次切换。只带一批时不渲染——单批是常态，别让唯一的选项占一个控件位。
 * 换批走 URL（?batch=），两个 tab 之间靠 MenteeTabs 把参数带着走。
 */
export function BatchPicker({
  options,
  currentId,
}: {
  options: BatchOption[];
  currentId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (options.length <= 1) return null;

  return (
    <select
      aria-label="切换批次"
      className={selectClass}
      value={currentId}
      onChange={(event) => {
        const next = new URLSearchParams(searchParams.toString());
        next.set("batch", event.target.value);
        router.push(`${pathname}?${next.toString()}`);
      }}
    >
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.name}
          {option.archived ? "（已归档）" : ""} · {option.menteeCount} 人
        </option>
      ))}
    </select>
  );
}
