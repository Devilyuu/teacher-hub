import type { Metadata } from "next";
import { formatDateOnly } from "@/lib/date";
import { prisma } from "@/lib/db";
import { getDutyRecords, getDutyTypes } from "@/lib/queries/routines";
import { DutyPanel } from "./duty-panel";

import { ModuleDisabledNotice } from "@/components/module-disabled";
import { RoutineTabs } from "@/components/routine-tabs";
import { getEnabledModules } from "@/lib/module-settings";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "轮派" };

export default async function DutiesPage() {
  const modules = await getEnabledModules();
  if (!modules.duties) {
    return (
      <div className="space-y-6">
        <RoutineTabs modules={modules} />
        <ModuleDisabledNotice moduleKey="duties" />
      </div>
    );
  }

  const [records, types, teachers] = await Promise.all([
    getDutyRecords(),
    getDutyTypes(),
    // 这里要连停用的一起列（名录要能重新启用），所以不用 getTeachers()
    prisma.teacher.findMany({
      select: {
        id: true,
        name: true,
        active: true,
        _count: { select: { dutyParticipations: true } },
      },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
  ]);

  return (
    <div className="space-y-6">
      <RoutineTabs modules={modules} />

      <header className="space-y-2 pt-2">
        <h1 className="page-title">轮派</h1>
        <p className="measure text-muted-foreground">
          派了谁、
          <span className="text-foreground">下次该轮到谁</span>
          。监考、校级会议、值班这类活，教学质量优秀这类名额，都记在这儿。
          类型和教师名录可以现场添加。
        </p>
      </header>

      <DutyPanel
        types={types.map((type) => ({
          id: type.id,
          name: type.name,
          note: type.note,
          recordCount: type._count.records,
        }))}
        teachers={teachers.map((teacher) => ({
          id: teacher.id,
          name: teacher.name,
          active: teacher.active,
          recordCount: teacher._count.dutyParticipations,
        }))}
        records={records.map((record) => ({
          id: record.id,
          title: record.title,
          note: record.note,
          // 纯日期（@db.Date）必须走 lib/date.ts，用本地时区会差一天
          dateText: formatDateOnly(record.date),
          typeName: record.dutyType.name,
          participants: record.participants.map((row) => row.teacher.name),
        }))}
      />
    </div>
  );
}
