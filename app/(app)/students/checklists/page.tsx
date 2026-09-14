import type { Metadata } from "next";
import { ModuleDisabledNotice } from "@/components/module-disabled";
import { StudentTabs } from "@/components/student-tabs";
import { formatDateOnly } from "@/lib/date";
import { prisma } from "@/lib/db";
import { isModuleEnabled } from "@/lib/module-settings";
import {
  getChecklists,
  getClassGroups,
  resolveClassGroup,
} from "@/lib/queries/students";
import { ClassEmptyState } from "../class-empty";
import { ClassPicker } from "../class-picker";
import { ChecklistPanel, type ChecklistRow } from "./checklist-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "勾名单" };

/**
 * 勾名单：收回执、收保险单这类「收齐没有」。
 * 微信接龙看的是谁交了，班主任要的是**谁没交**。
 */
export default async function ChecklistsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await isModuleEnabled("advisor"))) {
    return <ModuleDisabledNotice moduleKey="advisor" />;
  }

  const params = await searchParams;
  const classGroup = await resolveClassGroup(
    typeof params.class === "string" ? params.class : undefined,
  );

  if (!classGroup) {
    return (
      <div className="space-y-6">
        <StudentTabs />
        <header className="space-y-2 pt-2">
          <h1 className="page-title">勾名单</h1>
        </header>
        <ClassEmptyState />
      </div>
    );
  }

  const [classes, checklists, activeCount] = await Promise.all([
    getClassGroups(),
    getChecklists(classGroup.id),
    prisma.student.count({ where: { classGroupId: classGroup.id, active: true } }),
  ]);

  const rows: ChecklistRow[] = checklists.map((row) => ({
    id: row.id,
    title: row.title,
    dueDateText: row.dueDate ? formatDateOnly(row.dueDate) : null,
    note: row.note,
    closed: row.closedAt != null,
    checkedCount: row._count.checkmarks,
    activeCount,
  }));

  return (
    <div className="space-y-6">
      <StudentTabs />

      <header className="flex flex-wrap items-end justify-between gap-4 pt-2">
        <div className="space-y-2">
          <h1 className="page-title">勾名单</h1>
          <p className="measure text-muted-foreground">
            {classGroup.name} · 交一个勾一个，未交名单一键复制去群里催。
          </p>
        </div>
        <ClassPicker
          options={classes.map((row) => ({
            id: row.id,
            name: row.name,
            archived: row.archivedAt != null,
            studentCount: row._count.students,
          }))}
          currentId={classGroup.id}
        />
      </header>

      <ChecklistPanel classGroupId={classGroup.id} rows={rows} />
    </div>
  );
}
