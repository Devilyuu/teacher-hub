import "dotenv/config";
import { prisma } from "../lib/db";
import { buildExportRunData } from "../lib/export/run";
import { loadDeclarationExportSources } from "../lib/export/sources";

/**
 * 数据库集成验证：在真实回滚事务中装载跨来源候选并读回 ExportRun。
 *
 * 这不是 Vitest 默认套件的一部分，因为常规单测不要求本机有 PostgreSQL；
 * 改导出模型或迁移后显式运行 `npm run verify:export-run`。
 */
async function main() {
  const before = {
    exportRuns: await prisma.exportRun.count(),
    achievements: await prisma.achievement.count(),
    rewards: await prisma.schoolRewardDecision.count(),
  };
  const rollback = new Error("VERIFY_EXPORT_RUN_ROLLBACK");
  let verified:
    | {
        kind: string;
        includedCount: number;
        options: unknown;
        snapshot: unknown;
        loadedSource: {
          sourceKind: string;
          sourceId: string;
          schoolRewarded: boolean;
        };
      }
    | undefined;

  try {
    await prisma.$transaction(async (tx) => {
      const achievement = await tx.achievement.create({
        data: {
          type: "OTHER",
          title: `导出来源集成验证 ${crypto.randomUUID()}`,
          year: 2026,
          isVerified: true,
          tags: [],
          usableFor: [],
        },
        select: { id: true },
      });
      await tx.schoolRewardDecision.create({
        data: {
          achievementId: achievement.id,
          approvedAt: new Date("2026-07-30T00:00:00.000Z"),
          domain: "RESEARCH",
          awardItem: "集成验证",
        },
      });

      const loaded = await loadDeclarationExportSources(tx);
      const loadedSource = loaded.items.find(
        (item) =>
          item.sourceKind === "ACHIEVEMENT" &&
          item.sourceId === achievement.id,
      );
      if (!loadedSource || !loadedSource.schoolRewarded) {
        throw new Error("统一导出 loader 未读到事务内的学校奖励成果");
      }

      const created = await tx.exportRun.create({
        data: buildExportRunData({
          requestKey: `integration-${crypto.randomUUID()}`,
          kind: "performance",
          year: 2026,
          options: { includeUnverified: true, includeMissingYear: false },
          issues: [{ code: "unverified", count: 1 }],
          groups: [
            {
              key: "科研/集成验证",
              label: "集成验证",
              parent: "科研",
              subtotal: 0,
              rows: [
                {
                  index: 1,
                  sourceKind: loadedSource.sourceKind,
                  sourceId: loadedSource.sourceId,
                  title: loadedSource.title,
                  year: loadedSource.year,
                  level: loadedSource.level,
                  ownerRole: loadedSource.ownerRole ?? "",
                  score: loadedSource.declaredScore,
                  attachmentCount: loadedSource.attachmentCount,
                },
              ],
            },
          ],
        }),
      });
      const readBack = await tx.exportRun.findUniqueOrThrow({
        where: { id: created.id },
      });
      verified = {
        kind: readBack.kind,
        includedCount: readBack.includedCount,
        options: readBack.options,
        snapshot: readBack.snapshot,
        loadedSource: {
          sourceKind: loadedSource.sourceKind,
          sourceId: loadedSource.sourceId,
          schoolRewarded: loadedSource.schoolRewarded,
        },
      };
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }

  if (!verified) throw new Error("ExportRun 集成验证没有完成");

  const after = {
    exportRuns: await prisma.exportRun.count(),
    achievements: await prisma.achievement.count(),
    rewards: await prisma.schoolRewardDecision.count(),
  };
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    throw new Error(
      `ExportRun 集成验证留下了测试数据：before=${JSON.stringify(before)}, after=${JSON.stringify(after)}`,
    );
  }

  console.log(
    JSON.stringify({
      ...verified,
      rowsLeftBehind: {
        exportRuns: after.exportRuns - before.exportRuns,
        achievements: after.achievements - before.achievements,
        rewards: after.rewards - before.rewards,
      },
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
