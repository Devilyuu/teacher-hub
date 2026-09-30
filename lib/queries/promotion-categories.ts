import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { PromotionCapRule, PromotionOption } from "@/lib/promotion";

/**
 * 当前在用的职称量化表年度。
 *
 * 取库里最大的那个年度——人事处改表时导入脚本会写一个新年度进来，
 * 旧年度原样保留（历史成果仍按当年的表解释），但**录入界面只用最新的一版**。
 */
// 选项树和一级指标顺序各问一次「当前年度」，同一请求只查一次
export const currentPromotionYear = cache(currentPromotionYearUncached);

async function currentPromotionYearUncached(): Promise<number | null> {
  const latest = await prisma.promotionRuleset.findFirst({
    orderBy: { year: "desc" },
    select: { year: true },
  });
  return latest?.year ?? null;
}

/**
 * 当前那版表（最大年度）的封顶规则，喂给 `applyPromotionCaps`。没导入过职称表时返回空数组，
 * 那样合计就不截。
 *
 * 接受事务客户端：导出在 Serializable 事务里读成果，封顶规则得在同一个快照里读，
 * 否则两者之间有人重新导入了表，表上的合计和预检时看到的就不是一回事。
 * 这里不走 `currentPromotionYear`——那个缓存绑在默认连接上，进不了事务
 */
export async function loadPromotionCapRules(
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<PromotionCapRule[]> {
  const latest = await db.promotionRuleset.findFirst({
    orderBy: { year: "desc" },
    select: { year: true },
  });
  if (latest == null) return [];

  const rows = await db.promotionCategory.findMany({
    where: { year: latest.year },
    orderBy: { sortOrder: "asc" },
    select: {
      code: true,
      majorIndicator: true,
      minorIndicator: true,
      majorCap: true,
      cap: true,
      capGroup: true,
    },
  });
  return rows.map((row) => ({
    code: row.code,
    majorIndicator: row.majorIndicator,
    minorIndicator: row.minorIndicator,
    // Decimal 过不了 Server Component 边界，也没法直接参与 Math.min。
    // 一级上限可空（别的学校的表不一定有）：Number(null) 是 0，会把整组截成 0 分
    majorCap: row.majorCap == null ? null : Number(row.majorCap),
    cap: row.cap == null ? null : Number(row.cap),
    capGroup: row.capGroup,
  }));
}

/** 成果页用的那一份，同一请求只查一次 */
export const getPromotionCapRules = cache(() => loadPromotionCapRules());

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
      scoringRule: true,
      projectEligible: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    majorIndicator: row.majorIndicator,
    minorIndicator: row.minorIndicator,
    // Prisma 的 Decimal 不能直接过 Server Component 边界，转成 number
    cap: row.cap == null ? null : Number(row.cap),
    scoringRule: row.scoringRule,
    projectEligible: row.projectEligible,
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
