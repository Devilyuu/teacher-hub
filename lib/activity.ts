import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";

type ActivityClient = {
  activityLog: Pick<typeof prisma.activityLog, "create">;
};

/**
 * 写操作日志（prd-projects 2.7）。详情页的时间轴由它渲染。
 *
 * 刻意不加外键：被记录的实体删掉之后，日志仍然应该留着——
 * "某年某月删掉了某条要求项"本身就是要留痕的事。
 */
export async function logActivity(
  entityType:
    | "Project"
    | "Requirement"
    | "Achievement"
    | "RequirementLink"
    // 要求项 ↔ 课题材料的关联（规格 6.4）。和 RequirementLink 分开记：
    // 一个连成果、一个连材料，混在一起看时间轴分不清删掉的是哪种
    | "RequirementAttachment"
    | "PersonalDocument"
    | "ProjectPerformanceEvent"
    | "SchoolRewardDecision"
    // 日常模块（Phase 3）
    | "Task"
    | "Meeting"
    | "DutyRecord"
    // 全库 JSON 备份（增量 3.8）。没有实体可指，entityId 固定 "full-json"；
    // 走 ActivityLog 而不是 ExportRun，是为了不给 ExportKind 加不可回滚的枚举值
    | "Backup"
    // 班主任模块。荣誉汇总/奖状包导出记在 ClassGroup 上，理由同 Backup：
    // 不给 ExportKind 加枚举值
    | "ClassGroup"
    | "StudentHonor"
    // 指导参赛模块
    | "CompetitionEntry"
    // 课表导入记在学期上：课表条目整表覆盖、没有稳定的实体可指
    | "Semester",
  entityId: string,
  action: string,
  detail?: Prisma.InputJsonValue,
  client: ActivityClient = prisma,
) {
  await client.activityLog.create({
    data: { entityType, entityId, action, detail },
  });
}
