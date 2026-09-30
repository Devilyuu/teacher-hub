import { diffInDays } from "@/lib/date";
import type { AchievementUsage, AttachmentKind } from "@/lib/generated/prisma/enums";
import { ACHIEVEMENT_USAGE_LABELS, ATTACHMENT_KIND_LABELS } from "@/lib/labels";

/**
 * 学业导师模块的纯计算。**不碰数据库**，所以能在单测里跑。
 *
 * 口径只在这一处：首页倒计时和月历各取一份，两边各算一遍早晚对不上。
 */

export type MilestoneSource = {
  id: string;
  label: string;
  /** 纯日期。null = 只知道「五月底」，不进倒计时（第 8 条铁律） */
  date: Date | null;
  projectId: string;
  projectTitle: string;
  /** 主责学生姓名，没挂学生时为 null */
  ownerName: string | null;
};

export type MilestoneDeadline = {
  /** 合并后的标识，`${label}-${YYYY-MM-DD}` */
  key: string;
  label: string;
  daysLeft: number;
  /** 这个节点那天涉及几个项目 */
  count: number;
  /** count === 1 时跳到那个项目；多个时跳列表页 */
  href: string;
  /** count === 1 时是学生名或题目 */
  who: string | null;
};

/**
 * 首页倒计时要的节点。三条口径：
 *
 * 1. **只取今天及以后**。过去的答辩不是欠账，是已经发生的事——
 *    课题结题截止会显示「已逾期」是因为那件事还欠着，节点不欠。
 * 2. **同一天同一个节点合并成一条**。六个学生同一天答辩，不合并的话
 *    这张卡的四个名额全被「答辩」占满，真正要紧的结题截止被挤出去——
 *    而这张卡存在的理由本来就是课题。
 * 3. **只报天数，不判断要不要紧**（第 1 条铁律）。
 */
export function upcomingMilestoneDeadlines(
  milestones: MilestoneSource[],
  today: Date,
): MilestoneDeadline[] {
  const buckets = new Map<string, { label: string; daysLeft: number; items: MilestoneSource[] }>();

  for (const milestone of milestones) {
    if (!milestone.date) continue;
    const daysLeft = diffInDays(milestone.date, today);
    if (daysLeft < 0) continue;

    const key = `${milestone.label}-${milestone.date.toISOString().slice(0, 10)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.items.push(milestone);
    else buckets.set(key, { label: milestone.label, daysLeft, items: [milestone] });
  }

  return [...buckets.entries()]
    .map(([key, bucket]) => {
      const only = bucket.items.length === 1 ? bucket.items[0] : null;
      return {
        key,
        label: bucket.label,
        daysLeft: bucket.daysLeft,
        count: bucket.items.length,
        href: only ? `/mentees/projects/${only.projectId}` : "/mentees/projects",
        who: only ? (only.ownerName ?? only.projectTitle) : null,
      };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft || a.label.localeCompare(b.label, "zh-CN"));
}

/**
 * 学生项目成员的署名次序，返回写库用的 id 顺序（下标即 `orderIndex`，0 = 主责）。
 * 主责的名字会出现在月历、首页倒计时和材料包文件名里。
 *
 * 2026-09-23 验收查出来的坑：原来直接按表单里复选框的顺序写，而复选框按姓名排——
 * 主责永远是勾选者里汉字编码最小的那个，**编辑保存一次还会把原先定好的主责
 * 悄悄换掉**（实测：什么都没改点了保存，首页倒计时从「郑亦航」变成「何思齐」）。
 * 现在三条：
 *
 * 1. 主责以表单里的「主责」单选为准；没选、或选的人没勾，沿用原来还勾着的第一个人，
 *    再不行取第一个勾选的
 * 2. 其余人**保持原来的相对顺序**——编辑不改没动过的东西
 * 3. 新勾上的人按表单顺序排在最后
 */
export function orderProjectMembers(input: {
  checked: readonly string[];
  lead: string | null;
  /** 库里现有成员，按 orderIndex 升序；新建时为空 */
  existing: readonly string[];
}): string[] {
  const checked = [...new Set(input.checked)];
  const checkedSet = new Set(checked);
  const lead =
    input.lead && checkedSet.has(input.lead)
      ? input.lead
      : (input.existing.find((id) => checkedSet.has(id)) ?? checked[0]);
  if (!lead) return [];

  const kept = input.existing.filter((id) => checkedSet.has(id) && id !== lead);
  const added = checked.filter((id) => id !== lead && !input.existing.includes(id));
  return [lead, ...new Set([...kept, ...added])];
}

/** 倒计时卡上的一行文字：「答辩·林知远」或「答辩·6 人」 */
export function milestoneDeadlineLabel(deadline: MilestoneDeadline): string {
  if (deadline.count === 1 && deadline.who) return `${deadline.label}·${deadline.who}`;
  return `${deadline.label}·${deadline.count} 项`;
}

// ─── M3：引用为成果 + 案例索引 ──────────────────────────────────────

/**
 * 引用为成果时**跟着成果走**的材料：证书、获奖证书。
 *
 * 它们是绩效和职称的证据、申报包要用；任务书、开题报告、中期表、作品文件
 * 是指导过程档案，留在项目上（规格 §7.2，同参赛只搬获奖证书的先例）。
 * 界面上那句「哪些会跟着走」也读这一份，免得文案和动作说的不是一回事
 */
export const MENTEE_ADOPT_ATTACHMENT_KINDS = [
  "CERTIFICATE",
  "AWARD_CERTIFICATE",
] as const satisfies readonly AttachmentKind[];

/**
 * 引用为成果时那条成果的标题：「指导学生毕业设计《题目》：校级优秀毕业设计」。
 *
 * 结项情况照原样拼进去（同参赛拿奖状原文拼标题）。**用冒号隔开而不是接在后面**：
 * 它是自由文本，有人写「获评校级优秀」、有人只写「校级优秀毕业设计」，
 * 直接接上去后一种读不通，替人补个「获」字前一种又成了「获获评」。
 * 题目本身带了书名号（「AI 短片《数理华章》」）就不再套一层。
 *
 * 标题只在引用那一刻定下来，之后改结项情况**不回头同步**——
 * 台账那条可能已经按申报表的口径改过了，同步回去会把人改好的覆盖掉
 */
export function menteeAchievementTitle(project: {
  title: string;
  kindName: string;
  outcomeText: string;
}): string {
  const title = project.title.trim();
  const quoted = /[《》]/.test(title) ? title : `《${title}》`;
  return `指导学生${project.kindName.trim()}${quoted}：${project.outcomeText.trim()}`;
}

export type CaseIndexSource = {
  title: string;
  schoolYear: string | null;
  outcomeText: string | null;
  createdAt: Date;
  kind: { name: string; sortOrder: number };
  batch: { year: number };
  /** 按 orderIndex 升序，第一个是主责 */
  members: { mentee: { name: string } }[];
  attachments: { kind: AttachmentKind }[];
  /** 引用过才有。引用时证书已经转到成果上，所以支撑材料要两边一起数 */
  achievement: {
    usableFor: AchievementUsage[];
    attachments: { kind: AttachmentKind }[];
  } | null;
};

/** 列头照抄 `索引样式/学生项目案例索引.md`，那张表就是这份导出的形状 */
export const CASE_INDEX_COLUMNS = [
  { key: "time", header: "时间", width: 16 },
  { key: "title", header: "项目名称", width: 36 },
  { key: "kind", header: "项目类型", width: 12 },
  { key: "students", header: "学生姓名", width: 18 },
  { key: "role", header: "本人角色", width: 10 },
  { key: "outcome", header: "获奖或展示情况", width: 30 },
  { key: "evidence", header: "支撑材料", width: 30 },
  { key: "usableFor", header: "可用于", width: 16 },
] as const;

export type CaseIndexRow = Record<(typeof CASE_INDEX_COLUMNS)[number]["key"], string>;

const ATTACHMENT_KIND_ORDER = Object.keys(ATTACHMENT_KIND_LABELS) as AttachmentKind[];

/** 「过程证据 3 份、获奖证书」。按全局分组顺序排，和材料面板一个顺序 */
function evidenceSummary(kinds: AttachmentKind[]): string {
  const counts = new Map<AttachmentKind, number>();
  for (const kind of kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  return ATTACHMENT_KIND_ORDER.filter((kind) => counts.has(kind))
    .map((kind) => {
      const count = counts.get(kind)!;
      return count > 1
        ? `${ATTACHMENT_KIND_LABELS[kind]} ${count} 份`
        : ATTACHMENT_KIND_LABELS[kind];
    })
    .join("、");
}

/**
 * 学生项目案例索引的行。评优、绩效、职称时翻的就是它。
 *
 * - **按类型分组**（字典的 sortOrder），组内新的在前：先按届次、再按建立时间
 * - 学年、结项情况没填就**留空**，不写占位字——这张表是拿去往申报表里贴的，
 *   「未填」三个字会被原样贴进去
 * - 本人角色恒为「指导教师」：这个模块只装自己名下的学生（规格 §3）
 * - 「可用于」只在引用为成果之后才有东西：那是台账上的用途标记（`usableFor`），
 *   **不替人推断**「优秀毕设能不能算职称」——那是第 11 条铁律要挡的映射
 */
export function buildCaseIndexRows(projects: readonly CaseIndexSource[]): CaseIndexRow[] {
  return [...projects]
    .sort(
      (a, b) =>
        a.kind.sortOrder - b.kind.sortOrder ||
        a.kind.name.localeCompare(b.kind.name, "zh-CN") ||
        b.batch.year - a.batch.year ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    )
    .map((project) => {
      let usableFor = "";
      if (project.achievement) {
        usableFor =
          project.achievement.usableFor.length > 0
            ? project.achievement.usableFor
                .map((usage) => ACHIEVEMENT_USAGE_LABELS[usage])
                .join("、")
            : "已入台账，用途未标";
      }
      return {
        time: project.schoolYear ?? "",
        title: project.title,
        kind: project.kind.name,
        students: project.members.map((member) => member.mentee.name).join("、"),
        role: "指导教师",
        outcome: project.outcomeText ?? "",
        evidence: evidenceSummary([
          ...project.attachments.map((attachment) => attachment.kind),
          ...(project.achievement?.attachments ?? []).map((attachment) => attachment.kind),
        ]),
        usableFor,
      };
    });
}

/** 案例索引第二页：每个类型几个、几个已经进了台账。只数，不评 */
export function summarizeCaseIndex(
  projects: readonly CaseIndexSource[],
): { kind: string; total: number; adopted: number }[] {
  const byKind = new Map<string, { sortOrder: number; total: number; adopted: number }>();
  for (const project of projects) {
    const bucket = byKind.get(project.kind.name) ?? {
      sortOrder: project.kind.sortOrder,
      total: 0,
      adopted: 0,
    };
    bucket.total += 1;
    if (project.achievement) bucket.adopted += 1;
    byKind.set(project.kind.name, bucket);
  }
  return [...byKind.entries()]
    .sort(
      ([nameA, a], [nameB, b]) =>
        a.sortOrder - b.sortOrder || nameA.localeCompare(nameB, "zh-CN"),
    )
    .map(([kind, bucket]) => ({ kind, total: bucket.total, adopted: bucket.adopted }));
}
