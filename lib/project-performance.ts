import type {
  FundingType,
  Level,
  ProjectPerformanceEventKind,
  ProjectRole,
  ProjectStatus,
} from "@/lib/generated/prisma/enums";

export const PROJECT_PERFORMANCE_EVENT_LABELS: Record<
  ProjectPerformanceEventKind,
  string
> = {
  APPLY: "申报",
  APPROVED: "立项",
  FUNDING: "到账",
  CLOSEOUT: "结题",
  OTHER: "其他",
};

// 课题绩效分类的候选：原来是这里写死的四个小类名，2026-09-27 改成分类表上的「课题可挂」标记
// （PerfCategory.projectEligible，迁移照这四个名字勾好了），口径在 lib/project-eligibility.ts。

export type ProjectPerformanceSource = {
  title: string;
  shortTitle: string | null;
  level: Level;
  role: ProjectRole;
  fundingType: FundingType;
  status: ProjectStatus;
  applyDeadline: Date | null;
  startDate: Date | null;
  endDate: Date | null;
  closingDeadline: Date | null;
  fundingReceived: string | number | null;
  dateText: string | null;
};

export type ProjectPerformanceInput = {
  kind: ProjectPerformanceEventKind;
  year: number;
  perfCategoryId: string;
  declaredScore: number | null;
};

function validUtcYear(value: Date | null): number | null {
  if (value == null || Number.isNaN(value.getTime())) return null;
  return value.getUTCFullYear();
}

export function defaultEventYear(
  project: ProjectPerformanceSource,
  kind: ProjectPerformanceEventKind,
  fallback: number,
): number {
  const date =
    kind === "APPLY"
      ? project.applyDeadline
      : kind === "APPROVED"
        ? project.startDate
        : kind === "CLOSEOUT"
          ? project.endDate
          : null;
  return validUtcYear(date) ?? fallback;
}

function toAmount(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

export function toWan(value: string | number | null | undefined): number {
  return toAmount(value) / 10_000;
}

export function suggestProjectPerformanceEvent(
  project: ProjectPerformanceSource,
): ProjectPerformanceEventKind {
  if (project.status === "REJECTED") return "APPLY";
  if (toAmount(project.fundingReceived) > 0) return "FUNDING";
  if (project.status === "DRAFT" || project.status === "APPLYING") return "APPLY";
  if (project.status === "CLOSED") return "CLOSEOUT";
  return "APPROVED";
}

export type RuleColumn =
  | "base"
  | "national"
  | "provincial"
  | "city"
  | "school"
  | "college";

export function ruleColumnForLevel(level: Level): RuleColumn | null {
  switch (level) {
    case "NATIONAL":
      return "national";
    case "PROVINCIAL":
      return "provincial";
    case "MUNICIPAL":
    case "DISTRICT":
    case "BUREAU":
      return "city";
    case "SCHOOL":
      return "school";
    case "COLLEGE":
      return "college";
    default:
      return null;
  }
}

export function ruleColumnsForEvent(
  project: ProjectPerformanceSource,
  kind: ProjectPerformanceEventKind,
): RuleColumn[] {
  if (kind === "APPLY" || kind === "FUNDING" || kind === "OTHER") return ["base"];
  const levelColumn = ruleColumnForLevel(project.level);
  return levelColumn ? ["base", levelColumn] : ["base"];
}

export function projectPerformanceDraft(
  _project: ProjectPerformanceSource,
  input: ProjectPerformanceInput,
) {
  return {
    kind: input.kind,
    year: input.year,
    perfCategoryId: input.perfCategoryId,
    declaredScore: input.declaredScore,
    isVerified: false,
    note: `课题绩效事项：${PROJECT_PERFORMANCE_EVENT_LABELS[input.kind]}`,
  };
}
