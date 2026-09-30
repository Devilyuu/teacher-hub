/**
 * 把导入计划写进库。命令行脚本（scripts/import-*-rules.ts）和设置页的粘贴导入、
 * 规则包导入共用这一份——两份写库代码早晚一个会漏字段。
 *
 * 三条规矩：
 * - **按业务键 upsert**：职称 (year, code)、绩效 (year, majorCategory, minorCategory)
 * - **只增改、不删**：库里有、这次没有的行原样保留。成果可能还挂在上面，
 *   要删去分类表里删，那里会写清楚连带后果
 * - **文件里没写的开关不动**：projectEligible、isActive 这些 undefined 就保留库里的值。
 *   粘贴来的表不知道哪项「课题可挂」，不能因为重导一次就把人勾好的全冲掉
 *
 * 不引 server-only：命令行脚本用 tsx 直接跑、不带 react-server 条件，引了就起不来。
 * 它不自己连库（客户端由调用方传进来），也不碰磁盘。
 */
import type { Prisma } from "@/lib/generated/prisma/client";
import type { PerfCategoryDraft } from "@/lib/import/perf-rules";
import type { PromotionCategoryDraft, RulesetHeadDraft } from "@/lib/import/promotion-rules";

type RulesWriter = Pick<
  Prisma.TransactionClient,
  "promotionRuleset" | "promotionCategory" | "perfCategory"
>;

export type ApplyResult = { created: number; updated: number };

/** undefined 的键去掉——Prisma 的 update 里 undefined 本来就是「不动」，这里只是让意图写在明处 */
function definedOnly<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Partial<T>;
}

export async function applyPromotionPlan(
  db: RulesWriter,
  plan: { head: RulesetHeadDraft; drafts: PromotionCategoryDraft[] },
): Promise<ApplyResult> {
  const { year, ...head } = plan.head;
  await db.promotionRuleset.upsert({
    where: { year },
    create: plan.head,
    update: head,
  });

  const existing = new Set(
    (await db.promotionCategory.findMany({ where: { year }, select: { code: true } })).map((row) => row.code),
  );

  let created = 0;
  let updated = 0;
  for (const draft of plan.drafts) {
    const { year: draftYear, code, projectEligible, ...fields } = draft;
    await db.promotionCategory.upsert({
      where: { year_code: { year: draftYear, code } },
      create: { ...draft, projectEligible: projectEligible ?? false },
      update: { ...fields, ...definedOnly({ projectEligible }) },
    });
    if (existing.has(code)) updated += 1;
    else created += 1;
  }
  return { created, updated };
}

export async function applyPerfPlan(
  db: RulesWriter,
  drafts: PerfCategoryDraft[],
): Promise<ApplyResult> {
  const years = [...new Set(drafts.map((draft) => draft.year))];
  const existing = new Set(
    (
      await db.perfCategory.findMany({
        where: { year: { in: years } },
        select: { year: true, majorCategory: true, minorCategory: true },
      })
    ).map((row) => JSON.stringify([row.year, row.majorCategory, row.minorCategory])),
  );

  let created = 0;
  let updated = 0;
  for (const draft of drafts) {
    const {
      year,
      majorCategory,
      minorCategory,
      isTeam,
      isDepartmentAssigned,
      isActive,
      projectEligible,
      ...fields
    } = draft;
    const flags = definedOnly({ isTeam, isDepartmentAssigned, isActive, projectEligible });
    await db.perfCategory.upsert({
      where: { year_majorCategory_minorCategory: { year, majorCategory, minorCategory } },
      create: { year, majorCategory, minorCategory, ...fields, ...flags },
      update: { ...fields, ...flags },
    });
    if (existing.has(JSON.stringify([year, majorCategory, minorCategory]))) updated += 1;
    else created += 1;
  }
  return { created, updated };
}
