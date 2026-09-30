"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { deleteStudent, setStudentActive } from "../actions";

/**
 * 卡片页右上角的两个次级动作。离班可逆走停用；
 * 硬删只留给手误建错的条目，会连着删掉名下记录和勾。
 */
export function StudentRowActions({
  studentId,
  classGroupId,
  name,
  active,
}: {
  studentId: string;
  classGroupId: string;
  name: string;
  active: boolean;
}) {
  const router = useRouter();
  // 删完回名册要带上班级：带两个班的老师不该被送回默认班
  const rosterHref = `/students?class=${encodeURIComponent(classGroupId)}`;

  return (
    <div className="flex items-center gap-2">
      <form action={setStudentActive.bind(null, studentId, !active)}>
        <Button type="submit" variant="ghost" size="sm" className="bg-well">
          {active ? "标记离班" : "恢复在班"}
        </Button>
      </form>
      <form
        action={async () => {
          await deleteStudent(studentId);
          router.push(rosterHref);
        }}
      >
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive"
          onClick={(event) => {
            if (
              !confirm(
                `删除 ${name}？名下的记录、荣誉关联、勾名单的勾会一并删除。\n退学/转专业请用「标记离班」，不要删。`,
              )
            )
              event.preventDefault();
          }}
        >
          删除
        </Button>
      </form>
    </div>
  );
}
