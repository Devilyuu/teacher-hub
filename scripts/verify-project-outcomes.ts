import "dotenv/config";
import { prisma } from "../lib/db";
import {
  buildPerformancePackage,
  buildPromotionPackage,
  filterForDeclaration,
  type PackageRow,
} from "../lib/export/declaration";
import { loadDeclarationExportSources } from "../lib/export/sources";
import { compareIndicatorCode } from "../lib/promotion";
import { getUnifiedOutcomeList } from "../lib/queries/outcomes";
import { assertExactFixtureSources } from "../lib/verification/project-outcomes";

const ROLLBACK = Symbol("VERIFY_PROJECT_OUTCOMES_ROLLBACK");
const CHECK_CONSTRAINT = "SchoolRewardDecision_exactly_one_target_check";
const SAVEPOINT = "verify_school_reward_dual_target";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function packageRows(groups: Array<{ rows: PackageRow[] }>): PackageRow[] {
  return groups.flatMap((group) => group.rows);
}

function errorDetails(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const record = error as Error & {
    code?: unknown;
    meta?: unknown;
    cause?: unknown;
  };
  let meta = "";
  try {
    meta = JSON.stringify(record.meta);
  } catch {
    // The message and stack remain useful if an adapter returns cyclic metadata.
  }
  return [
    record.name,
    record.message,
    record.stack,
    String(record.code ?? ""),
    meta,
    String(record.cause ?? ""),
  ].join("\n");
}

function assertExactlyOneTargetCheck(error: unknown): string {
  const details = errorDetails(error);
  assert(
    details.includes(CHECK_CONSTRAINT) ||
      (details.includes("23514") &&
        details.includes("SchoolRewardDecision")),
    `双目标写入失败，但不是预期的 ${CHECK_CONSTRAINT}：${details}`,
  );
  return details.includes(CHECK_CONSTRAINT) ? CHECK_CONSTRAINT : "23514";
}

async function main() {
  const suffix = crypto.randomUUID();
  const ids = {
    project: `verify-project-${suffix}`,
    achievement: `verify-achievement-${suffix}`,
    event: `verify-event-${suffix}`,
    projectReward: `verify-project-reward-${suffix}`,
    achievementReward: `verify-achievement-reward-${suffix}`,
    invalidReward: `verify-invalid-reward-${suffix}`,
  };
  let verification:
    | {
        projectOccurrences: number;
        projectEventOccurrences: number;
        performanceRows: number;
        promotionSources: string[];
        checkConstraint: string;
      }
    | undefined;

  try {
    await prisma.$transaction(
      async (tx) => {
        const perfCategory = await tx.perfCategory.findFirst({
          where: { isActive: true },
          orderBy: [{ year: "desc" }, { sortOrder: "asc" }, { id: "asc" }],
          select: { id: true },
        });
        const promotionCategory = await tx.promotionCategory.findFirst({
          where: { year: 2026 },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          select: { id: true },
        });
        assert(perfCategory, "缺少可用绩效分类，无法验证课题绩效适配");
        assert(promotionCategory, "缺少 2026 年职称分类，无法验证统一职称适配");

        await tx.project.create({
          data: {
            id: ids.project,
            title: `课题成果统一集成验证 ${suffix}`,
            status: "ONGOING",
            level: "MUNICIPAL",
            startDate: new Date("2026-01-15T00:00:00.000Z"),
            dateText: "2026年",
            promotionCategoryId: promotionCategory.id,
            promotionScore: 6,
          },
        });
        await tx.achievement.create({
          data: {
            id: ids.achievement,
            title: `课题实际产出集成验证 ${suffix}`,
            type: "REPORT",
            status: "PUBLISHED",
            level: "MUNICIPAL",
            year: 2026,
            isVerified: true,
            tags: [],
            usableFor: ["PERFORMANCE", "PROMOTION", "PROJECT_CLOSING"],
            perfCategoryId: perfCategory.id,
            declaredScore: 3,
            promotionCategoryId: promotionCategory.id,
            promotionScore: 4,
          },
        });
        await tx.projectPerformanceEvent.create({
          data: {
            id: ids.event,
            projectId: ids.project,
            kind: "APPROVED",
            year: 2026,
            dateText: "2026年立项",
            perfCategoryId: perfCategory.id,
            declaredScore: 2,
            isVerified: true,
          },
        });
        await tx.schoolRewardDecision.createMany({
          data: [
            {
              id: ids.projectReward,
              projectId: ids.project,
              approvedAt: new Date("2026-07-30T00:00:00.000Z"),
              domain: "RESEARCH",
              awardItem: "课题奖励集成验证",
            },
            {
              id: ids.achievementReward,
              achievementId: ids.achievement,
              approvedAt: new Date("2026-07-30T00:00:00.000Z"),
              domain: "RESEARCH",
              awardItem: "成果奖励集成验证",
            },
          ],
        });

        const outcomes = await getUnifiedOutcomeList(tx);
        const projects = outcomes.filter(
          (row) => row.kind === "PROJECT" && row.id === ids.project,
        );
        assert(
          projects.length === 1,
          `统一成果查询应只返回一次临时课题，实际 ${projects.length} 次`,
        );
        assert(
          projects[0].performanceEntries.filter((entry) => entry.id === ids.event)
            .length === 1,
          "统一成果查询没有把临时绩效事实挂回唯一课题",
        );

        const sources = await loadDeclarationExportSources(tx);
        const fixtureSources = sources.items.filter(
          (item) =>
            item.sourceId === ids.project ||
            item.sourceId === ids.achievement ||
            item.sourceId === ids.event,
        );
        assertExactFixtureSources(fixtureSources, ids);

        const performance = buildPerformancePackage(
          filterForDeclaration(fixtureSources, 2026, "performance", {
            includeMissingYear: true,
            includeUnverified: true,
          }),
          2026,
        );
        const performanceRows = packageRows(performance.groups);
        assert(
          !performanceRows.some(
            (row) =>
              row.sourceId === ids.achievement || row.sourceId === ids.event,
          ),
          "2026 绩效包仍纳入了学校已奖励的课题或成果",
        );

        const promotion = buildPromotionPackage(
          filterForDeclaration(fixtureSources, 2026, "promotion", {
            includeMissingYear: true,
            includeUnverified: true,
          }),
          2026,
          compareIndicatorCode,
        );
        const promotionRows = packageRows(promotion.groups);
        const promotionSources = promotionRows
          .filter(
            (row) =>
              row.sourceId === ids.project || row.sourceId === ids.achievement,
          )
          .map((row) => `${row.sourceKind}:${row.sourceId}`)
          .sort();
        assert(
          promotionSources.length === 2 &&
            promotionSources.includes(`PROJECT:${ids.project}`) &&
            promotionSources.includes(`ACHIEVEMENT:${ids.achievement}`),
          `学校奖励不应排除职称申报，实际来源：${promotionSources.join(", ")}`,
        );

        await tx.$executeRawUnsafe(`SAVEPOINT ${SAVEPOINT}`);
        let checkError: unknown;
        try {
          await tx.schoolRewardDecision.create({
            data: {
              id: ids.invalidReward,
              projectId: ids.project,
              achievementId: ids.achievement,
              approvedAt: new Date("2026-07-30T00:00:00.000Z"),
              domain: "RESEARCH",
              awardItem: "双目标约束集成验证",
            },
          });
        } catch (error) {
          checkError = error;
        }
        await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);
        await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${SAVEPOINT}`);
        assert(checkError, "双目标 SchoolRewardDecision 被数据库错误接受");
        const checkConstraint = assertExactlyOneTargetCheck(checkError);

        verification = {
          projectOccurrences: projects.length,
          projectEventOccurrences: projects[0].performanceEntries.filter(
            (entry) => entry.id === ids.event,
          ).length,
          performanceRows: performanceRows.length,
          promotionSources,
          checkConstraint,
        };
        throw ROLLBACK;
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }

  assert(verification, "课题/成果统一集成验证没有完成");

  const leftovers = {
    projects: await prisma.project.count({ where: { id: ids.project } }),
    achievements: await prisma.achievement.count({
      where: { id: ids.achievement },
    }),
    events: await prisma.projectPerformanceEvent.count({
      where: { id: ids.event },
    }),
    rewards: await prisma.schoolRewardDecision.count({
      where: {
        id: {
          in: [
            ids.projectReward,
            ids.achievementReward,
            ids.invalidReward,
          ],
        },
      },
    }),
  };
  assert(
    Object.values(leftovers).every((count) => count === 0),
    `课题/成果统一集成验证留下了临时数据：${JSON.stringify(leftovers)}`,
  );

  console.log(
    JSON.stringify({
      ...verification,
      rowsLeftBehind: leftovers,
    }),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
