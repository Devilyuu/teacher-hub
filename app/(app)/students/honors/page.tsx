import type { Metadata } from "next";
import { ModuleDisabledNotice } from "@/components/module-disabled";
import { StudentTabs } from "@/components/student-tabs";
import { prisma } from "@/lib/db";
import { formatDateByPrecision } from "@/lib/format";
import { LEVEL_LABELS } from "@/lib/labels";
import { isModuleEnabled } from "@/lib/module-settings";
import {
  getClassGroups,
  getHonors,
  resolveClassGroup,
} from "@/lib/queries/students";
import { ClassEmptyState } from "../class-empty";
import { ClassPicker } from "../class-picker";
import { HonorExport } from "./honor-export";
import { HonorsPanel, type HonorRow } from "./honors-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "荣誉" };

/**
 * 班级荣誉库。评优申报时「整理班级荣誉」的实际动作是两件——
 * 列一张表、凑一沓奖状——这页的导出按钮各对应一件。
 *
 * **与本人成果台账划清界限**（schema 注释里那段）：这里是这个班的学生
 * 得过什么，不是本人的绩效；两边不合并、不同步。
 */
export default async function HonorsPage({
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
          <h1 className="page-title">荣誉</h1>
        </header>
        <ClassEmptyState />
      </div>
    );
  }

  const [classes, honors, students] = await Promise.all([
    getClassGroups(),
    getHonors(classGroup.id),
    prisma.student.findMany({
      where: { classGroupId: classGroup.id, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const rows: HonorRow[] = honors.map((honor) => ({
    id: honor.id,
    title: honor.title,
    levelLabel: LEVEL_LABELS[honor.level],
    issuer: honor.issuer,
    isCollective: honor.isCollective,
    memberNames: honor.members.map((member) => member.student.name),
    dateLabel: formatDateByPrecision(honor.awardedAt, honor.datePrecision, honor.dateText),
    attachmentCount: honor._count.attachments,
  }));

  const certificateCount = honors.reduce(
    (sum, honor) => sum + honor._count.attachments,
    0,
  );

  return (
    <div className="space-y-6">
      <StudentTabs />

      <header className="flex flex-wrap items-end justify-between gap-4 pt-2">
        <div className="space-y-2">
          <h1 className="page-title">荣誉</h1>
          <p className="measure text-muted-foreground">
            {classGroup.name} · {rows.length} 项。平时随手记，评优申报时导出汇总表和奖状包。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <HonorExport
            classGroupId={classGroup.id}
            honorCount={rows.length}
            certificateCount={certificateCount}
          />
          <ClassPicker
            options={classes.map((row) => ({
              id: row.id,
              name: row.name,
              archived: row.archivedAt != null,
              studentCount: row._count.students,
            }))}
            currentId={classGroup.id}
          />
        </div>
      </header>

      <HonorsPanel classGroupId={classGroup.id} students={students} rows={rows} />
    </div>
  );
}
