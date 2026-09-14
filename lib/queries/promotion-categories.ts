import "server-only";
import { prisma } from "@/lib/db";
import type { PromotionOption } from "@/lib/promotion";

/**
 * 当前在用的职称量化表年度。
 *
 * 取库里最大的那个年度——人事处改表时导入脚本会写一个新年度进来，
 * 旧年度原样保留（历史成果仍按当年的表解释），但**录入界面只用最新的一版**。
 */
export async function currentPromotionYear(): Promise<number | null> {
  const latest = await prisma.promotionRuleset.findFirst({
    orderBy: { year: "desc" },
    select: { year: true },
  });
  return latest?.year ?? null;
}

/** 下拉用的指标清单。没导入过职称表时返回空数组，界面据此隐藏这一栏 */
export async function getPromotionOptions(): Promise<PromotionOption[]> {
  const year = await currentPromotionYear();
  if (year == null) return [];

  const rows = await prisma.promotionCategory.findMany({
    where: { year },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      code: true,
      majorIndicator: true,
      minorIndicator: true,
      cap: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    majorIndicator: row.majorIndicator,
    minorIndicator: row.minorIndicator,
    // Prisma 的 Decimal 不能直接过 Server Component 边界，转成 number
    cap: row.cap == null ? null : Number(row.cap),
  }));
}

/**
 * 一级指标的正序（思想政治素质 → 综合管理）。
 * 分面要按它排，不按条数降序——打乱了就和纸质申报表对不上号。
 */
export async function getPromotionMajorOrder(): Promise<string[]> {
  const year = await currentPromotionYear();
  if (year == null) return [];

  const rows = await prisma.promotionCategory.findMany({
    where: { year },
    orderBy: { sortOrder: "asc" },
    select: { majorIndicator: true },
  });

  const seen: string[] = [];
  for (const row of rows) {
    if (!seen.includes(row.majorIndicator)) seen.push(row.majorIndicator);
  }
  return seen;
}

/** 整表说明与四个系列总分。填分时要照着看的那 10 条 */
export async function getPromotionRuleset() {
  const year = await currentPromotionYear();
  if (year == null) return null;
  return prisma.promotionRuleset.findUnique({ where: { year } });
}

/** 档案里的「任现职以来」起点。没填时返回 null，职称口径就只卡上限 */
export async function getCurrentTitleSince(): Promise<Date | null> {
  const profile = await prisma.profile.findFirst({
    select: { currentTitleSince: true },
  });
  return profile?.currentTitleSince ?? null;
}
