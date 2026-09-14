import type { Metadata } from "next";
import { ModuleDisabledNotice } from "@/components/module-disabled";
import { StudentTabs } from "@/components/student-tabs";
import { formatDateOnly, todayAsDateOnly } from "@/lib/date";
import { isModuleEnabled } from "@/lib/module-settings";
import { prisma } from "@/lib/db";
import {
  getClassGroups,
  getRecords,
  getRecordTypes,
  resolveClassGroup,
} from "@/lib/queries/students";
import { ClassEmptyState } from "../class-empty";
import { ClassPicker } from "../class-picker";
import { RecordsPanel, type RecordRow, type RecordTypeRow } from "./records-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "学生记录" };

/**
 * 记录流水：谈话、班会、突发事件、家访电话。
 * 学期末班主任手册、考核表要回忆的东西，全靠平时这里一句一句攒。
 */
export default async function RecordsPage({
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
          <h1 className="page-title">记录</h1>
        </header>
        <ClassEmptyState />
      </div>
    );
  }

  const [classes, types, records, students] = await Promise.all([
    getClassGroups(),
    getRecordTypes(),
    getRecords(classGroup.id),
    prisma.student.findMany({
      where: { classGroupId: classGroup.id, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const typeRows: RecordTypeRow[] = types.map((type) => ({
    id: type.id,
    name: type.name,
    recordCount: type._count.records,
  }));

  const recordRows: RecordRow[] = records.map((record) => ({
    id: record.id,
    dateText: formatDateOnly(record.date),
    typeName: record.type.name,
    memberNames: record.members.map((member) => member.student.name),
    content: record.content,
  }));

  return (
    <div className="space-y-6">
      <StudentTabs />

      <header className="flex flex-wrap items-end justify-between gap-4 pt-2">
        <div className="space-y-2">
          <h1 className="page-title">记录</h1>
          <p className="measure text-muted-foreground">
            {classGroup.name} · 谈话、班会、事件，一句一句攒。期末填手册时全在这。
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

      <RecordsPanel
        classGroupId={classGroup.id}
        types={typeRows}
        students={students}
        records={recordRows}
        todayText={formatDateOnly(todayAsDateOnly())}
      />
    </div>
  );
}
