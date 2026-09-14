/**
 * 结题清单的文档模型（规格 7.4 / 增量 3.2）。
 *
 * 纯函数：把课题、结题要求、**已确认达标**的成果和材料摊成一份能直接排版的结构。
 * 真正生成 .docx 在 closeout-docx.ts——分开是为了让「清单里该有什么」
 * 能脱离 Word 的 API 单测。
 *
 * 三条不许破的：
 * 1. **只列已人工确认达标的成果**（`isQualified`）。挂接了但没勾的算「在办」，
 *    单独列出来提醒，绝不混进达标清单（CLAUDE.md 第 1 条）。
 * 2. **缺口数字全部来自 `lib/gap.ts`**，这里一个都不重算（第 6 条）。
 * 3. **材料编号与材料 ZIP 完全一致**，共用 `buildMaterialZipPlan`。
 *    清单上写着「材料 1-2」，解开 ZIP 却找不到对应文件，这份清单就废了。
 */
import { formatDate, formatDateByPrecision, formatTimestampDate } from "@/lib/format";
import type { ProjectGap } from "@/lib/gap";
import {
  ACHIEVEMENT_TYPE_LABELS,
  ATTACHMENT_KIND_LABELS,
  formatRoleWithRank,
  FUNDING_TYPE_LABELS,
  LEVEL_LABELS,
  PROJECT_CATEGORY_LABELS,
  PROJECT_STATUS_LABELS,
} from "@/lib/labels";
import type { MaterialZipPlan } from "./materials-zip";
import type {
  AchievementType,
  DatePrecision,
  FundingType,
  Level,
  ProjectCategory,
  ProjectRole,
  ProjectStatus,
} from "@/lib/generated/prisma/enums";

export type CloseoutAchievement = {
  id: string;
  title: string;
  type: AchievementType;
  level: Level | null;
  publishedAt: Date | null;
  completedAt: Date | null;
  datePrecision: DatePrecision;
  dateText: string | null;
};

export type CloseoutRequirementInput = {
  id: string;
  rawText: string;
  requiredCount: number;
  dueDate: Date | null;
  links: Array<{
    isQualified: boolean;
    qualifyNote: string | null;
    achievement: CloseoutAchievement;
  }>;
  materials: Array<{ attachmentId: string; note: string | null }>;
};

export type CloseoutProjectInput = {
  title: string;
  shortTitle: string | null;
  code: string | null;
  level: Level;
  category: ProjectCategory;
  fundingType: FundingType;
  status: ProjectStatus;
  role: ProjectRole;
  ownerOrder: number | null;
  memberCount: number | null;
  hostUnit: string | null;
  sourceName: string | null;
  startDate: Date | null;
  endDate: Date | null;
  closingDeadline: Date | null;
  requirements: CloseoutRequirementInput[];
};

export type CloseoutInput = {
  project: CloseoutProjectInput;
  /** 由 lib/gap.ts 算好传进来，这里不重算 */
  gap: ProjectGap;
  /** 与材料 ZIP 共用的条目规划，编号由它统一 */
  materialPlan: MaterialZipPlan;
  profile: { name: string | null; unit: string | null } | null;
  generatedAt: Date;
};

export type CloseoutField = { label: string; value: string };

export type CloseoutMaterialRef = {
  /** 与 ZIP 内文件名同源的编号段，如 `1-1` 或 `03` */
  no: string;
  kind: string;
  filename: string;
  note: string | null;
};

export type CloseoutRequirementSection = {
  /** 从 1 开始，和课题详情里从上往下数的位置一致 */
  index: number;
  rawText: string;
  requiredCount: number;
  qualifiedCount: number;
  gap: number;
  dueDate: string | null;
  /** 已人工确认达标的成果 */
  qualified: Array<{ title: string; meta: string; note: string | null }>;
  /** 挂了但还没确认达标的，单独列 */
  pending: Array<{ title: string; meta: string }>;
  materials: CloseoutMaterialRef[];
};

export type CloseoutDocument = {
  heading: string;
  subtitle: string | null;
  fields: CloseoutField[];
  requirements: CloseoutRequirementSection[];
  /** 全部材料目录，编号与 ZIP 一致 */
  materialIndex: Array<CloseoutMaterialRef & { source: string }>;
  summary: {
    totalRequired: number;
    totalQualified: number;
    totalGap: number;
    completionRate: string;
  };
  footer: string;
};

const MATERIAL_SOURCE_LABELS = {
  PROJECT: "课题材料",
  ACHIEVEMENT: "成果证据",
} as const;

/** 「—」而不是空字符串：表格里留白会让人以为漏填了 */
function orDash(value: string | null | undefined): string {
  const text = value?.trim();
  return text ? text : "—";
}

function achievementMeta(achievement: CloseoutAchievement): string {
  const parts = [ACHIEVEMENT_TYPE_LABELS[achievement.type]];
  if (achievement.level) parts.push(LEVEL_LABELS[achievement.level]);
  // 日期按 datePrecision 渲染，绝不把模糊日期硬说成某一天（CLAUDE.md 第 8 条）
  const date = formatDateByPrecision(
    achievement.publishedAt ?? achievement.completedAt,
    achievement.datePrecision,
    achievement.dateText,
  );
  if (date && date !== "—") parts.push(date);
  return parts.join(" · ");
}

export function buildCloseoutDocument(input: CloseoutInput): CloseoutDocument {
  const { project, gap, materialPlan, profile, generatedAt } = input;

  // 编号、类型、原名全部取自 ZIP 规划，这里一个都不自己编
  const byAttachmentId = new Map(
    materialPlan.entries.map((entry) => [
      entry.attachmentId,
      {
        no: entry.no,
        kind: ATTACHMENT_KIND_LABELS[entry.kind],
        filename: entry.filename,
        source: MATERIAL_SOURCE_LABELS[entry.source],
      },
    ]),
  );

  const fields: CloseoutField[] = [
    { label: "课题编号", value: orDash(project.code) },
    { label: "课题名称", value: project.title },
    { label: "立项来源", value: orDash(project.sourceName) },
    { label: "级别", value: LEVEL_LABELS[project.level] },
    { label: "类别", value: PROJECT_CATEGORY_LABELS[project.category] },
    { label: "纵向 / 横向", value: FUNDING_TYPE_LABELS[project.fundingType] },
    { label: "承担单位", value: orDash(project.hostUnit) },
    {
      label: "本人角色",
      value: formatRoleWithRank(project.role, project.ownerOrder, project.memberCount),
    },
    { label: "当前状态", value: PROJECT_STATUS_LABELS[project.status] },
    { label: "立项日", value: orDash(formatDate(project.startDate)) },
    { label: "研究期终止日", value: orDash(formatDate(project.endDate)) },
    { label: "结题材料截止日", value: orDash(formatDate(project.closingDeadline)) },
  ];

  const gapByRequirement = new Map(
    gap.requirements.map((requirement) => [requirement.requirementId, requirement]),
  );

  const requirements = project.requirements.map((requirement, index) => {
    const measured = gapByRequirement.get(requirement.id);

    return {
      index: index + 1,
      // rawText 原样照抄，一个字都不改（CLAUDE.md 第 2 条）
      rawText: requirement.rawText,
      // 四个数字统一取自 gap，不在这里各取各的（CLAUDE.md 第 6 条）。
      // 没算到这条时才退回要求项自己的值——那说明 gap 的输入漏了它，
      // 显示成「0/N 全缺」比显示成「已齐备」安全
      requiredCount: measured?.requiredCount ?? requirement.requiredCount,
      qualifiedCount: measured?.qualifiedCount ?? 0,
      gap: measured?.gap ?? requirement.requiredCount,
      dueDate: requirement.dueDate ? formatDate(requirement.dueDate) : null,
      qualified: requirement.links
        .filter((link) => link.isQualified)
        .map((link) => ({
          title: link.achievement.title,
          meta: achievementMeta(link.achievement),
          note: link.qualifyNote,
        })),
      pending: requirement.links
        .filter((link) => !link.isQualified)
        .map((link) => ({
          title: link.achievement.title,
          meta: achievementMeta(link.achievement),
        })),
      materials: requirement.materials.flatMap((material) => {
        const entry = byAttachmentId.get(material.attachmentId);
        // 材料刚被删掉、或者不在本次打包范围内时跳过，
        // 不要凭空造一个编号出来——清单上的号必须能在包里找到
        return entry
          ? [{ no: entry.no, kind: entry.kind, filename: entry.filename, note: material.note }]
          : [];
      }),
    };
  });

  const materialIndex = materialPlan.entries.map((entry) => ({
    no: entry.no,
    kind: ATTACHMENT_KIND_LABELS[entry.kind],
    filename: entry.filename,
    note: null,
    source: MATERIAL_SOURCE_LABELS[entry.source],
  }));

  const owner = [profile?.name, profile?.unit].filter(Boolean).join("　");

  return {
    heading: `${project.shortTitle ?? project.title} 结题材料清单`,
    subtitle: project.shortTitle ? project.title : null,
    fields,
    requirements,
    materialIndex,
    summary: {
      totalRequired: gap.totalRequired,
      totalQualified: gap.totalQualified,
      totalGap: gap.totalGap,
      // 没有要求项时 completionRate 是 null，显示「—」而不是 0%
      // （CLAUDE.md 第 7 条：系统不假设这个课题没有要求）
      completionRate:
        gap.completionRate == null ? "—" : `${Math.round(gap.completionRate * 100)}%`,
    },
    footer: [
      owner,
      // generatedAt 是**时间戳**不是纯日期列，必须按本地时区取日期。
      // 用 formatDate（UTC 口径）的话，东八区 08:00 前生成的清单会写成前一天
      // （代码约定里那条 formatTimestampDate vs lib/date.ts 的分工）
      `由高校教师智能工作台生成于 ${formatTimestampDate(generatedAt)}`,
      "达标与否由本人逐条确认，系统只做汇总，不代为判定。",
    ]
      .filter(Boolean)
      .join("　·　"),
  };
}
