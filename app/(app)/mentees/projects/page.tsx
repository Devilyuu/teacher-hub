import type { Metadata } from "next";
import { Download } from "lucide-react";
import { MenteeTabs } from "@/components/mentee-tabs";
import { ModuleDisabledNotice } from "@/components/module-disabled";
import { Button } from "@/components/ui/button";
import { formatDateOnly, todayAsDateOnly } from "@/lib/date";
import { isModuleEnabled } from "@/lib/module-settings";
import {
  countAllMenteeProjects,
  getActiveMentees,
  getMenteeBatches,
  getMenteeProjectKinds,
  getMenteeProjects,
  resolveMenteeBatch,
} from "@/lib/queries/mentees";
import { BatchEmptyState } from "../batch-empty";
import { BatchPicker } from "../batch-picker";
import {
  MenteeProjectsPanel,
  type ProjectKindRow,
  type ProjectRow,
} from "./projects-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "学生项目" };

/**
 * 学生项目：毕业设计、大创、课程作品。
 *
 * **不叫「毕设」而叫「项目」**：仓库里那张一直没填起来的
 * `索引样式/学生项目案例索引.md` 已经把范围写好了——竞赛、毕业设计、
 * APP 设计、AI 短片、创新创业。只做毕设的话那张索引还是填不满。
 *
 * 学校的毕设管理系统管选题审核、成绩、查重，**这里一概不做、不存影子数据**。
 */
export default async function MenteeProjectsPage({
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
          <h1 className="page-title">项目</h1>
        </header>
        <BatchEmptyState defaultYear={todayAsDateOnly().getUTCFullYear()} />
      </div>
    );
  }

  const [batches, kinds, projects, mentees, allProjectCount] = await Promise.all([
    getMenteeBatches(),
    getMenteeProjectKinds(),
    getMenteeProjects(batch.id),
    getActiveMentees(batch.id),
    countAllMenteeProjects(),
  ]);

  const kindRows: ProjectKindRow[] = kinds.map((kind) => ({
    id: kind.id,
    name: kind.name,
    projectCount: kind._count.projects,
  }));

  const today = todayAsDateOnly();
  const projectRows: ProjectRow[] = projects.map((project) => {
    // 「下一个节点」= 今天及以后最早的那个；全都过去了就报最后一个。
    // 只报事实，不算「还剩几天」——那是判定（第 1 条铁律）
    const dated = project.milestones.filter((m) => m.date != null);
    const upcoming = dated.find((m) => m.date! >= today) ?? dated.at(-1);
    return {
      id: project.id,
      title: project.title,
      kindName: project.kind.name,
      schoolYear: project.schoolYear,
      outcomeText: project.outcomeText,
      memberNames: project.members.map((member) => member.mentee.name),
      nextMilestoneText: upcoming
        ? `${upcoming.label} ${formatDateOnly(upcoming.date!)}`
        : null,
      milestoneCount: project.milestones.length,
      attachmentCount: project._count.attachments,
      recordCount: project._count.records,
      adopted: project.achievementId != null,
    };
  });

  return (
    <div className="space-y-6">
      <MenteeTabs batchId={batch.id} />

      <header className="flex flex-wrap items-end justify-between gap-4 pt-2">
        <div className="space-y-2">
          <h1 className="page-title">项目</h1>
          <p className="measure text-muted-foreground">
            {batch.name} · {projectRows.length} 个。毕设、大创、课程作品都在这儿——
            题目、节点日期、材料各归各位。成绩和查重归学校毕设系统管。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* 导的是全部批次，按钮上写明——列表只显示当前这一届，
              不写的话会像「界面上 5 条、导出来 30 条」那样对不上 */}
          <form action="/api/export/mentee-case-index" method="post">
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              disabled={allProjectCount === 0}
            >
              <Download className="size-3.5" aria-hidden />
              案例索引 · 全部批次
            </Button>
          </form>
          <BatchPicker
            options={batches.map((row) => ({
              id: row.id,
              name: row.name,
              archived: row.archivedAt != null,
              menteeCount: row._count.mentees,
            }))}
            currentId={batch.id}
          />
        </div>
      </header>

      <MenteeProjectsPanel
        batchId={batch.id}
        kinds={kindRows}
        mentees={mentees}
        projects={projectRows}
      />
    </div>
  );
}
