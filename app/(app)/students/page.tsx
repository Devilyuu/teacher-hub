import type { Metadata } from "next";
import { ModuleDisabledNotice } from "@/components/module-disabled";
import { StudentTabs } from "@/components/student-tabs";
import { isModuleEnabled } from "@/lib/module-settings";
import {
  getClassGroups,
  getRoster,
  resolveClassGroup,
} from "@/lib/queries/students";
import { ClassEmptyState } from "./class-empty";
import { ClassPicker } from "./class-picker";
import { RelationsPanel } from "./relations-panel";
import { RosterPanel, type RelationRow, type StudentRow } from "./roster-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "名册" };

/**
 * 班主任模块首页：名册（名单/宿舍两种视图）+ 矛盾关系。
 *
 * 定位（CLAUDE.md 待补 / 本模块 PRD）：学校的一站式学生服务平台是
 * 判定与审批系统，资助、奖惩、心理、宿舍管理都归它；这里只存它不存的
 * 日常工作痕迹。名册是通讯录 + 备注，不是学籍表。
 */
export default async function StudentsPage({
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
          <h1 className="page-title">名册</h1>
        </header>
        <ClassEmptyState />
      </div>
    );
  }

  const [classes, roster] = await Promise.all([
    getClassGroups(),
    getRoster(classGroup.id),
  ]);

  const students: StudentRow[] = roster.map((student) => ({
    id: student.id,
    name: student.name,
    studentNo: student.studentNo,
    phone: student.phone,
    parentName: student.parentName,
    parentPhone: student.parentPhone,
    dormRoom: student.dormRoom,
    internshipUnit: student.internshipUnit,
    note: student.note,
    active: student.active,
  }));

  // 每条关系恰好出现在某个学生的 relationsA 里一次（A 是有序对的小端），
  // 从 A 侧收一遍就是全量，不去重也不会重
  const relations: RelationRow[] = roster.flatMap((student) =>
    student.relationsA.map((relation) => ({
      id: relation.id,
      studentAId: student.id,
      studentAName: student.name,
      studentBId: relation.studentB.id,
      studentBName: relation.studentB.name,
      note: relation.note,
      resolved: relation.resolvedAt != null,
    })),
  );

  const activeCount = students.filter((student) => student.active).length;

  return (
    <div className="space-y-6">
      <StudentTabs />

      <header className="flex flex-wrap items-end justify-between gap-4 pt-2">
        <div className="space-y-2">
          <h1 className="page-title">名册</h1>
          <p className="measure text-muted-foreground">
            {classGroup.name} · 在班 {activeCount} 人。三秒查到一个电话、想起一个背景，就够了——学籍归学校系统管。
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

      <RosterPanel
        classGroupId={classGroup.id}
        students={students}
        relations={relations}
      />

      <RelationsPanel
        students={students
          .filter((student) => student.active)
          .map((student) => ({ id: student.id, name: student.name }))}
        relations={relations}
      />
    </div>
  );
}
