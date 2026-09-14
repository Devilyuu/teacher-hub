import { createHash } from "node:crypto";
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
};

/**
 * 把用户在页面上确认过的最终导出输入钉住。
 *
 * 页面和 POST 必须传同一种完整形状。这里显式列出预检、组表、工作簿和
 * ExportRun.snapshot 的全部成果输入，以及工作簿抬头使用的 profile。
 */
export function declarationExportInputFingerprint(
  items: DeclarationExportInputItem[],
  year: number,
  kind: DeclarationKind,
  profile: DeclarationExportProfile,
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
        profile: { name: profile.name, unit: profile.unit },
        items: stableItems,
      }),
    )
    .digest("hex");
}
