import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ModuleDisabledNotice } from "@/components/module-disabled";
import { StudentTabs } from "@/components/student-tabs";
import { formatDateOnly } from "@/lib/date";
import { prisma } from "@/lib/db";
import { isModuleEnabled } from "@/lib/module-settings";
import { getChecklistDetail } from "@/lib/queries/students";
import { CheckGrid } from "./check-grid";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "勾名单" };

export default async function ChecklistDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await isModuleEnabled("advisor"))) {
    return <ModuleDisabledNotice moduleKey="advisor" />;
  }

  const checklist = await getChecklistDetail((await params).id);
  if (!checklist) notFound();

  // 名单只列在班的：离班学生不该出现在「谁没交」里。
  // 他交没交过的历史勾保留在库里，重新在班就又能看到
  const students = await prisma.student.findMany({
    where: { classGroupId: checklist.classGroupId, active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const checkedIds = new Set(checklist.checkmarks.map((mark) => mark.studentId));

  return (
    <div className="space-y-6">
      <StudentTabs />

      <header className="space-y-2 pt-2">
        <h1 className="page-title">{checklist.title}</h1>
        <p className="measure text-muted-foreground">
          {checklist.classGroup.name}
          {checklist.dueDate ? ` · 截止 ${formatDateOnly(checklist.dueDate)}` : ""}
          {checklist.note ? ` · ${checklist.note}` : ""}
        </p>
      </header>

      <CheckGrid
        checklistId={checklist.id}
        title={checklist.title}
        students={students}
        initialCheckedIds={students
          .filter((student) => checkedIds.has(student.id))
          .map((student) => student.id)}
        closed={checklist.closedAt != null}
      />
    </div>
  );
}
