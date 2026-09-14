import type {
  AchievementStatus,
  AchievementType,
  AchievementUsage,
  DatePrecision,
  Level,
  ProjectStatus,
} from "@/lib/generated/prisma/enums";

export type PromotionCoordinate = {
  code: string;
  majorIndicator: string;
  minorIndicator: string;
};

export type PerformanceEntry = {
  id: string;
  year: number | null;
  isVerified: boolean;
  declaredScore: number | null;
  perfCategory: {
    majorCategory: string;
    minorCategory: string;
  } | null;
};

export type OutcomeBase = {
  id: string;
  title: string;
  level: Level;
  promotionYear: number | null;
  promotionCategory: PromotionCoordinate | null;
  promotionScore: number | null;
  performanceEntries: PerformanceEntry[];
  schoolRewarded: boolean;
  attachmentCount: number;
};

export type ProjectOutcomeRow = OutcomeBase & {
  kind: "PROJECT";
  key: `PROJECT:${string}`;
  href: `/projects/${string}`;
  projectStatus: ProjectStatus;
};

export type AchievementOutcomeRow = OutcomeBase & {
  kind: "ACHIEVEMENT";
  key: `ACHIEVEMENT:${string}`;
  href: `/achievements/${string}`;
  achievementType: AchievementType;
  achievementStatus: AchievementStatus;
  isVerified: boolean;
  usableFor: AchievementUsage[];
  needsLink: boolean;
  linkedProjects: Array<{ id: string; name: string }>;
  tags: string[];
  year: number | null;
  perfCategoryId: string | null;
  promotionCategoryId: string | null;
  declaredScore: number | null;
  publishedAt: Date | null;
  completedAt: Date | null;
  datePrecision: DatePrecision;
  dateText: string | null;
};

export type UnifiedOutcomeRow = ProjectOutcomeRow | AchievementOutcomeRow;
