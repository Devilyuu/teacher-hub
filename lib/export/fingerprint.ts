import { createHash } from "node:crypto";
import { formatDateOnly } from "@/lib/date";
import type { PromotionCapRule } from "@/lib/promotion";
import type { ExportableAchievement } from "./declaration";
import type { DeclarationKind, PreflightAchievement } from "./preflight";

export type DeclarationExportInputItem = ExportableAchievement &
  Pick<
    PreflightAchievement,
    "status" | "perfCategoryId" | "promotionCategoryId"
  >;

export type DeclarationExportProfile = {
  name: string;
  unit: string;
  /** 档案里的任现职日期（纯日期）。职称表的时间窗起点，null = 没填 */
  currentTitleSince: Date | null;
};

/**
 * 把用户在页面上确认过的最终导出输入钉住。
 *
 * 页面和 POST 必须传同一种完整形状。这里显式列出预检、组表、工作簿和
 * ExportRun.snapshot 的全部成果输入，以及工作簿抬头使用的 profile。
 * 职称表还要钉住任现职日期：预检之后改了它，进表的就是另一批成果
 */
export function declarationExportInputFingerprint(
  items: DeclarationExportInputItem[],
  year: number,
  kind: DeclarationKind,
  profile: DeclarationExportProfile,
  /**
   * 职称表的封顶规则。它决定汇总表上的「封顶后合计」，预检之后重新导入了量化表，
   * 交出去的合计就和页面上看到的不一样。页面和接口必须都传——只传一边的话
   * 两个指纹永远对不上，导出每次都报漂移，漏传是当场就能发现的
   */
  capRules: ReadonlyArray<PromotionCapRule> = [],
): string {
  const stableItems = [...items]
    .sort(
      (a, b) =>
        a.sourceKind.localeCompare(b.sourceKind) ||
        a.sourceId.localeCompare(b.sourceId),
    )
    .map((item) => ({
      sourceKind: item.sourceKind,
      sourceId: item.sourceId,
      href: item.href,
      schoolRewarded: item.schoolRewarded,
      title: item.title,
      year: item.year,
      isVerified: item.isVerified,
      status: item.status,
      level: item.level,
      type: item.type,
      ownerRole: item.ownerRole,
      authorPosition: item.authorPosition,
      dateText: item.dateText,
      attachmentCount: item.attachmentCount,
      perfCategoryId: item.perfCategoryId,
      promotionCategoryId: item.promotionCategoryId,
      perfCategory:
        item.perfCategory == null
          ? null
          : {
              majorCategory: item.perfCategory.majorCategory,
              minorCategory: item.perfCategory.minorCategory,
            },
      promotionCategory:
        item.promotionCategory == null
          ? null
          : {
              code: item.promotionCategory.code,
              majorIndicator: item.promotionCategory.majorIndicator,
              minorIndicator: item.promotionCategory.minorIndicator,
            },
      declaredScore: item.declaredScore,
      promotionScore: item.promotionScore,
    }));

  return createHash("sha256")
    .update(
      JSON.stringify({
        year,
        kind,
        profile: {
          name: profile.name,
          unit: profile.unit,
          // 只有职称表的取数范围跟它走，绩效表不因为改了任现职日期而判成漂移
          ...(kind === "promotion"
            ? {
                currentTitleSince:
                  profile.currentTitleSince == null
                    ? null
                    : formatDateOnly(profile.currentTitleSince),
              }
            : {}),
        },
        ...(kind === "promotion"
          ? {
              capRules: [...capRules]
                .sort((a, b) => a.code.localeCompare(b.code))
                .map((rule) => ({
                  code: rule.code,
                  majorIndicator: rule.majorIndicator,
                  majorCap: rule.majorCap,
                  cap: rule.cap,
                  capGroup: rule.capGroup,
                })),
            }
          : {}),
        items: stableItems,
      }),
    )
    .digest("hex");
}
