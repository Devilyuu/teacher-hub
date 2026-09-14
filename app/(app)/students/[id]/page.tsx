import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ModuleDisabledNotice } from "@/components/module-disabled";
import { StudentTabs } from "@/components/student-tabs";
import { formatDateOnly } from "@/lib/date";
import { formatDateByPrecision } from "@/lib/format";
import { LEVEL_LABELS } from "@/lib/labels";
import { isModuleEnabled } from "@/lib/module-settings";
import { getStudentDetail } from "@/lib/queries/students";
import { StudentRowActions } from "./student-actions";
import { StudentForm } from "./student-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "学生卡片" };

/** 学生卡片：通讯录字段可改，名下的记录、荣誉、矛盾在下面汇总 */
export default async function StudentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await isModuleEnabled("advisor"))) {
    return <ModuleDisabledNotice moduleKey="advisor" />;
  }

  const student = await getStudentDetail((await params).id);
  if (!student) notFound();

  const relations = [
    ...student.relationsA.map((relation) => ({
      id: relation.id,
      other: relation.studentB,
      note: relation.note,
      resolved: relation.resolvedAt != null,
    })),
    ...student.relationsB.map((relation) => ({
      id: relation.id,
      other: relation.studentA,
      note: relation.note,
      resolved: relation.resolvedAt != null,
    })),
  ];

  return (
    <div className="space-y-6">
      <StudentTabs />

      <header className="flex flex-wrap items-end justify-between gap-4 pt-2">
        <div className="space-y-2">
          <h1 className="page-title">
            {student.name}
            {student.active ? "" : (
              <span className="ml-3 align-middle text-base font-normal text-muted-foreground">
                已离班
              </span>
            )}
          </h1>
          <p className="measure text-muted-foreground">
            {student.classGroup.name}
            {student.studentNo ? ` · ${student.studentNo}` : ""}
            {student.dormRoom ? ` · 宿舍 ${student.dormRoom}` : ""}
          </p>
        </div>
        <StudentRowActions
          studentId={student.id}
          name={student.name}
          active={student.active}
        />
      </header>

      <StudentForm
        studentId={student.id}
        dataVersion={student.updatedAt.toISOString()}
        defaults={{
          name: student.name,
          studentNo: student.studentNo,
          phone: student.phone,
          parentName: student.parentName,
          parentPhone: student.parentPhone,
          dormRoom: student.dormRoom,
          internshipUnit: student.internshipUnit,
          internshipContact: student.internshipContact,
          note: student.note,
        }}
      />

      {relations.length > 0 ? (
        <section className="space-y-3">
          <h2 className="px-1 text-sm font-medium">矛盾关系</h2>
          <ul className="surface divide-y divide-border/50 overflow-hidden py-1">
            {relations.map((relation) => (
              <li key={relation.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <span className={relation.resolved ? "text-sm text-muted-foreground line-through" : "text-sm"}>
                  与 {relation.other.name}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={relation.note}>
                  {relation.note}
                </span>
                {relation.resolved ? (
                  <span className="text-xs text-muted-foreground">已化解</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="px-1 text-sm font-medium">荣誉</h2>
        {student.honorMembers.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">还没有记录。荣誉在「荣誉」tab 里添加。</p>
        ) : (
          <ul className="surface divide-y divide-border/50 overflow-hidden py-1">
            {student.honorMembers.map(({ honor }) => (
              <li key={honor.id}>
                <Link
                  href={`/students/honors/${honor.id}`}
                  className="flex flex-wrap items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50"
                >
                  <span className="min-w-0 flex-1 text-sm">{honor.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {LEVEL_LABELS[honor.level]}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatDateByPrecision(honor.awardedAt, honor.datePrecision, honor.dateText)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="px-1 text-sm font-medium">记录</h2>
        {student.recordMembers.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">
            还没有记录。随手记走顶栏速记，归类时选「归到学生」。
          </p>
        ) : (
          <ul className="surface divide-y divide-border/50 overflow-hidden py-1">
            {student.recordMembers.map(({ record }) => (
              <li key={record.id} className="space-y-1 px-4 py-3">
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="rounded border px-1.5 py-0.5">{record.type.name}</span>
                  <span className="tabular-nums">{formatDateOnly(record.date)}</span>
                </p>
                <p className="measure text-sm leading-relaxed whitespace-pre-wrap">
                  {record.content}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
