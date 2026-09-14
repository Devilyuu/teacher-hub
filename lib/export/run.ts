import type {
  DeclarationFilterOptions,
  PackageGroup,
} from "./declaration";
import type { DeclarationKind } from "./preflight";

type ExportRunInput = {
  requestKey: string;
  kind: DeclarationKind;
  year: number;
  options: Required<DeclarationFilterOptions>;
  issues: Array<{ code: string; count: number }>;
  groups: PackageGroup[];
};

/**
 * 生成可直接交给 Prisma 的导出审计数据。
 *
 * snapshot 故意保存当次表格行，而不是只存 source identity：底层成果、分值和分类
 * 之后都会变化，只有行快照能回答「上次实际报上去的是什么」。
 */
export function buildExportRunData(input: ExportRunInput) {
  const snapshot = input.groups.flatMap((group) =>
    group.rows.map((row) => ({
      ...row,
      group: {
        key: group.key,
        label: group.label,
        parent: group.parent,
      },
    })),
  );

  return {
    requestKey: input.requestKey,
    kind:
      input.kind === "promotion"
        ? ("PROMOTION_DECLARATION" as const)
        : ("PERF_DECLARATION" as const),
    year: input.year,
    options: input.options,
    includedCount: snapshot.length,
    issueSummary: input.issues.map(({ code, count }) => ({ code, count })),
    snapshot,
  };
}
