import type { Metadata } from "next";
import { MenteeTabs } from "@/components/mentee-tabs";
import { ModuleDisabledNotice } from "@/components/module-disabled";
import { formatDateOnly, todayAsDateOnly } from "@/lib/date";
import { isModuleEnabled } from "@/lib/module-settings";
import {
  getMenteeBatches,
  getMenteeRoster,
  resolveMenteeBatch,
} from "@/lib/queries/mentees";
import { BatchControls, BatchEmptyState } from "./batch-empty";
import { MenteeRosterPanel, type MenteeRow } from "./roster-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "我的学生" };

/**
 * 学业导师模块首页：我名下的学生名单。
 *
 * 定位（规格 2026-09-21-mentor-module-design §1）：学校的毕设管理系统与
 * 导师双选系统是判定/审批系统，选题审核、成绩、查重、名额录取都归它们；
 * 这里只存它们不存的工作痕迹——我带了谁、什么时候谈了什么。
 *
 * **和班主任模块是两回事**：那边是一个班的日常事务（/students，advisor），
 * 这边是双选分来的一批学生（/mentees，mentor）。
 */
export default async function MenteesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await isModuleEnabled("mentor"))) {
    return <ModuleDisabledNotice moduleKey="mentor" />;
  }

  const params = await searchParams;
  const batch = await resolveMenteeBatch(
    typeof params.batch === "string" ? params.batch : undefined,
  );

  if (!batch) {
    return (
      <div className="space-y-6">
        <MenteeTabs />
        <header className="space-y-2 pt-2">
          <h1 className="page-title">我的学生</h1>
        </header>
        <BatchEmptyState defaultYear={todayAsDateOnly().getUTCFullYear()} />
      </div>
    );
  }

  const [batches, roster] = await Promise.all([
    getMenteeBatches(),
    getMenteeRoster(batch.id),
  ]);

  const mentees: MenteeRow[] = roster.map((mentee) => {
    const last = mentee.recordMembers[0]?.record;
    return {
      id: mentee.id,
      name: mentee.name,
      studentNo: mentee.studentNo,
      className: mentee.className,
      phone: mentee.phone,
      note: mentee.note,
      active: mentee.active,
      linkedStudent: mentee.studentId != null,
      recordCount: mentee._count.recordMembers,
      lastRecordText: last
        ? `${formatDateOnly(last.date)} · ${last.type.name}`
        : null,
    };
  });

  const activeCount = mentees.filter((mentee) => mentee.active).length;

  return (
    <div className="space-y-6">
      <MenteeTabs batchId={batch.id} />

      <header className="flex flex-wrap items-end justify-between gap-4 pt-2">
        <div className="space-y-2">
          <h1 className="page-title">我的学生</h1>
          <p className="measure text-muted-foreground">
            {batch.name} · 在带 {activeCount} 人
            {batch.archivedAt ? " · 这一批已归档" : ""}。
            双选分来的名单粘进来就行，学籍和成绩归学校系统管。
          </p>
        </div>
        <BatchControls
          options={batches.map((row) => ({
            id: row.id,
            name: row.name,
            archived: row.archivedAt != null,
            menteeCount: row._count.mentees,
          }))}
          currentId={batch.id}
          defaultYear={todayAsDateOnly().getUTCFullYear()}
        />
      </header>

      <MenteeRosterPanel batchId={batch.id} mentees={mentees} />
    </div>
  );
}
