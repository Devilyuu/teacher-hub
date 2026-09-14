"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type ClassOption = {
  id: string;
  name: string;
  archived: boolean;
  studentCount: number;
};

const selectClass =
  "h-9 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * 班级切换。只带一个班时不渲染——单班是常态，别让唯一的选项占一个控件位。
 * 换班走 URL（?class=），四个 tab 之间靠 StudentTabs 把参数带着走。
 */
export function ClassPicker({
  options,
  currentId,
}: {
  options: ClassOption[];
  currentId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (options.length <= 1) return null;

  return (
    <select
      aria-label="切换班级"
      className={selectClass}
      value={currentId}
      onChange={(event) => {
        const next = new URLSearchParams(searchParams.toString());
        next.set("class", event.target.value);
        router.push(`${pathname}?${next.toString()}`);
      }}
    >
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.name}
          {option.archived ? "（已归档）" : ""} · {option.studentCount} 人
        </option>
      ))}
    </select>
  );
}
