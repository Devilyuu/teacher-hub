/**
 * 年度申报包的支撑材料（prd-ledger 4.2：「支撑材料（ZIP，文件按材料编号命名）」）。
 *
 * 纯函数：决定「哪些附件进包、在包里叫什么」。读盘和打包在
 * `app/api/export/declaration/route.ts` 和 `lib/zip.ts`。
 *
 * 三条口径：
 *
 * - **编号跟明细表的序号走**：第 3 行的材料叫 `03-1_获奖证书_….pdf`、`03-2_…`。
 *   `Attachment.code` 那个 `1-1` 是从老绩效库导进来的旧编号，和这张表的序号对不上，这里不用它
 * - **每行只收它自己的材料**：成果行收成果的附件，课题行收课题的材料；课题绩效事项
 *   （立项、到账、结题……）没有自己的附件，收它所属课题的材料——同一课题同一年两条事项时，
 *   两行各带一份，和明细表「材料份数」一格一格对得上
 * - **研究参考不进包**（`isDeclarationMaterial`）。明细表的「材料份数」和预检的「缺材料」
 *   按同一条规则数（`sources.ts`），表上写 2 份，包里就是 2 份
 */

import type { AttachmentKind } from "@/lib/generated/prisma/enums";
import { ATTACHMENT_KIND_LABELS } from "@/lib/labels";
import type { DeclarationPackage, DeclarationSourceKind } from "./declaration";
import { materialEntryName } from "./materials-zip";

/**
 * 不进申报包的附件类型。研究参考是「看过的文献、政策文件、同行方案，不是本课题的产出」
 * （schema 里 `AttachmentKind.REFERENCE` 的注释），拿去申报等于交别人的东西
 */
const NON_DECLARATION_KINDS: ReadonlySet<AttachmentKind> = new Set<AttachmentKind>(["REFERENCE"]);

export function isDeclarationMaterial(kind: AttachmentKind): boolean {
  return !NON_DECLARATION_KINDS.has(kind);
}

export type DeclarationMaterial = {
  id: string;
  kind: AttachmentKind;
  filename: string;
  storagePath: string;
  size: number;
  uploadedAt: Date;
};

/** 申报候选的身份键，和预检、组表、ExportRun 快照用的是同一种写法 */
export function declarationSourceKey(sourceKind: DeclarationSourceKind, sourceId: string): string {
  return `${sourceKind}:${sourceId}`;
}

/** 包里材料放在这个目录下，根目录只留那张申报表 */
export const DECLARATION_MATERIALS_DIR = "支撑材料";

export type DeclarationMaterialEntry = {
  /** 明细表序号 */
  rowIndex: number;
  /** 包内编号，如 `03-1` */
  no: string;
  attachmentId: string;
  /** 包内路径，含目录 */
  name: string;
  storagePath: string;
  kind: AttachmentKind;
  filename: string;
  size: number;
  uploadedAt: Date;
};

export type DeclarationMaterialPlan = {
  entries: DeclarationMaterialEntry[];
  totalBytes: number;
};

/** 附件类型按生命周期排（申报书 → 立项 → … → 其他），和上传下拉的顺序一致 */
const KIND_ORDER = new Map(
  (Object.keys(ATTACHMENT_KIND_LABELS) as AttachmentKind[]).map((kind, index) => [kind, index]),
);

function compareMaterials(a: DeclarationMaterial, b: DeclarationMaterial): number {
  return (
    (KIND_ORDER.get(a.kind) ?? 0) - (KIND_ORDER.get(b.kind) ?? 0) ||
    a.uploadedAt.getTime() - b.uploadedAt.getTime() ||
    a.id.localeCompare(b.id)
  );
}

/**
 * 按申报包（已编好序号的最终表格顺序）规划支撑材料。
 *
 * 序号补零到统一宽度（至少两位），资源管理器按名字排出来就是表格的顺序；
 * 同一行里按类型、上传时间排，结果稳定——同一份数据导两次，编号一模一样。
 */
export function buildDeclarationMaterialPlan(
  pkg: DeclarationPackage,
  materialsBySource: ReadonlyMap<string, readonly DeclarationMaterial[]>,
): DeclarationMaterialPlan {
  const rows = pkg.groups.flatMap((group) => group.rows);
  const width = Math.max(2, String(rows.reduce((max, row) => Math.max(max, row.index), 0)).length);

  const entries: DeclarationMaterialEntry[] = [];
  let totalBytes = 0;
  for (const row of rows) {
    const materials = [
      ...(materialsBySource.get(declarationSourceKey(row.sourceKind, row.sourceId)) ?? []),
    ].sort(compareMaterials);
    materials.forEach((material, i) => {
      const no = `${String(row.index).padStart(width, "0")}-${i + 1}`;
      entries.push({
        rowIndex: row.index,
        no,
        attachmentId: material.id,
        name: `${DECLARATION_MATERIALS_DIR}/${materialEntryName(no, material.kind, material.filename)}`,
        storagePath: material.storagePath,
        kind: material.kind,
        filename: material.filename,
        size: material.size,
        uploadedAt: material.uploadedAt,
      });
      totalBytes += material.size;
    });
  }
  return { entries, totalBytes };
}
