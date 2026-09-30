import type { Metadata } from "next";
import { MenteeTabs } from "@/components/mentee-tabs";
import { ModuleDisabledNotice } from "@/components/module-disabled";
import { formatDateOnly, todayAsDateOnly } from "@/lib/date";
import { isModuleEnabled } from "@/lib/module-settings";
import {
  getActiveMentees,
  getMenteeBatches,
  getMenteeProjectOptions,
  getMenteeRecordTypes,
  getMenteeRecords,
  resolveMenteeBatch,
} from "@/lib/queries/mentees";
import { BatchEmptyState } from "../batch-empty";
import { BatchPicker } from "../batch-picker";
import { RecordsFilter } from "./records-filter";
import {
  MenteeRecordsPanel,
  type MenteeRecordRow,
  type MenteeRecordTypeRow,
} from "./records-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "指导记录" };

/** `?from=` / `?to=` 是 YYYY-MM-DD。纯日期列按 UTC 解释，别用本地时区构造 */
function parseDateParam(raw: string | undefined) {
  if (!raw) return undefined;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * 指导记录流水：见面、学业指导、毕设指导、生涯规划。
 *
 * 学期末那张「学业导师工作记录表」要回忆的东西，全靠平时这里一句一句攒；
 * 筛一下日期区间就能导出成 xlsx。
 *
 * 最顺手的入口其实不是这一页，是**顶栏速记**——随手记一句，
 * 回头在首页收件箱里选「归到导师学生」。
 */
export default async function MenteeRecordsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await isModuleEnabled("mentor"))) {
    return <ModuleDisabledNotice moduleKey="mentor" />;
  }

  const params = await searchParams;
  const one = (key: string) =>
    typeof params[key] === "string" && params[key] !== "" ? params[key] : undefined;

  const batch = await resolveMenteeBatch(one("batch"));

  if (!batch) {
    return (
      <div className="space-y-6">
        <MenteeTabs />
        <header className="space-y-2 pt-2">
          <h1 className="page-title">指导记录</h1>
        </header>
        <BatchEmptyState defaultYear={todayAsDateOnly().getUTCFullYear()} />
      </div>
    );
  }

  const menteeId = one("mentee");
  const typeId = one("type");
  const from = one("from");
  const to = one("to");

  const [batches, types, records, mentees, projects] = await Promise.all([
    getMenteeBatches(),
    getMenteeRecordTypes(),
    getMenteeRecords(batch.id, {
      menteeId,
      typeId,
      from: parseDateParam(from),
      to: parseDateParam(to),
    }),
    getActiveMentees(batch.id),
    getMenteeProjectOptions(batch.id),
  ]);

  const typeRows: MenteeRecordTypeRow[] = types.map((type) => ({
    id: type.id,
    name: type.name,
    recordCount: type._count.records,
  }));

  const recordRows: MenteeRecordRow[] = records.map((record) => ({
    id: record.id,
    dateText: formatDateOnly(record.date),
    typeName: record.type.name,
    memberNames: record.members.map((member) => member.mentee.name),
    content: record.content,
    projectId: record.projectId,
  }));

  return (
    <div className="space-y-6">
      <MenteeTabs batchId={batch.id} />

      <header className="flex flex-wrap items-end justify-between gap-4 pt-2">
        <div className="space-y-2">
          <h1 className="page-title">指导记录</h1>
          <p className="measure text-muted-foreground">
            {batch.name} · 见面、学业指导、毕设指导，一句一句攒。
            学期末填导师工作记录表时筛个日期区间导出来就行。
          </p>
        </div>
        <BatchPicker
          options={batches.map((row) => ({
            id: row.id,
            name: row.name,
            archived: row.archivedAt != null,
            menteeCount: row._count.mentees,
          }))}
          currentId={batch.id}
        />
      </header>

      <RecordsFilter
        batchId={batch.id}
        mentees={mentees}
        types={types.map((type) => ({ id: type.id, name: type.name }))}
        values={{ menteeId, typeId, from, to }}
        resultCount={recordRows.length}
      />

      <MenteeRecordsPanel
        batchId={batch.id}
        types={typeRows}
        mentees={mentees}
        projects={projects}
        records={recordRows}
        todayText={formatDateOnly(todayAsDateOnly())}
        filtered={Boolean(menteeId || typeId || from || to)}
      />
    </div>
  );
}
