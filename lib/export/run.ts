import type {
  DeclarationFilterOptions,
  PackageGroup,
} from "./declaration";
import type { DeclarationMaterialEntry } from "./declaration-materials";
import type { DeclarationKind } from "./preflight";
import type { DeclarationExportFormat } from "./request";

type ExportRunInput = {
  requestKey: string;
  kind: DeclarationKind;
  year: number;
  options: Required<DeclarationFilterOptions>;
  issues: Array<{ code: string; count: number }>;
  groups: PackageGroup[];
  /** 只导了申报表，还是连同支撑材料打成了 ZIP */
  format: DeclarationExportFormat;
  /** ZIP 时每行附上的文件。只有 ZIP 才传——xlsx 里本来就没有文件 */
  materials?: ReadonlyArray<Pick<DeclarationMaterialEntry, "rowIndex" | "attachmentId" | "name" | "size">>;
};

/**
 * 生成可直接交给 Prisma 的导出审计数据。
 *
 * snapshot 故意保存当次表格行，而不是只存 source identity：底层成果、分值和分类
 * 之后都会变化，只有行快照能回答「上次实际报上去的是什么」。ZIP 时每行再记下
 * 附了哪几个文件（包内名字），附件之后删了换了也查得到当时交出去的是哪份。
 *
 * 导出格式写进 options，不给 ExportKind 加枚举值——枚举加了不可回滚（规格 §14）
 */
export function buildExportRunData(input: ExportRunInput) {
  const materialsByRow = new Map<number, Array<{ attachmentId: string; name: string; size: number }>>();
  for (const material of input.materials ?? []) {
    const rows = materialsByRow.get(material.rowIndex) ?? [];
    rows.push({ attachmentId: material.attachmentId, name: material.name, size: material.size });
    materialsByRow.set(material.rowIndex, rows);
  }

  const snapshot = input.groups.flatMap((group) =>
    group.rows.map((row) => ({
      ...row,
      group: {
        key: group.key,
        label: group.label,
        parent: group.parent,
      },
      ...(input.format === "zip" ? { materials: materialsByRow.get(row.index) ?? [] } : {}),
    })),
  );

  return {
    requestKey: input.requestKey,
    kind:
      input.kind === "promotion"
        ? ("PROMOTION_DECLARATION" as const)
        : ("PERF_DECLARATION" as const),
    year: input.year,
    options: { ...input.options, format: input.format },
    includedCount: snapshot.length,
    issueSummary: input.issues.map(({ code, count }) => ({ code, count })),
    snapshot,
  };
}
