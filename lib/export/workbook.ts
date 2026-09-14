import "server-only";
import ExcelJS from "exceljs";
import type { DeclarationPackage } from "./declaration";

/**
 * 把申报包写成 Excel（BUILD_PLAN Phase 2 验收目标）。
 *
 * 两张 sheet：**汇总表**（每个分组一行，看总分）和**明细表**（每条成果一行，
 * 就是材料目录）。学校要的是能直接交的东西，所以序号、分组、小计、合计
 * 都按纸质表的样子排。
 *
 * 不做花哨排版——这份表交上去多半还要人再调，把数据摆对比样式重要。
 */
export async function buildDeclarationWorkbook(
  pkg: DeclarationPackage,
  meta: { name: string; unit: string },
  quality?: {
    issues: Array<{ code: string; label: string; count: number; detail: string }>;
  },
): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = "高校教师智能工作台";
  book.created = new Date();

  const isPromotion = pkg.kind === "promotion";
  const scoreLabel = isPromotion ? "职称量化分" : "申报分";
  const groupLabel = isPromotion ? "二级指标" : "小类";
  const parentLabel = isPromotion ? "一级指标" : "大类";

  // ── 汇总表 ──
  const summary = book.addWorksheet("汇总");
  summary.addRow([`${pkg.year} 年度${isPromotion ? "职称量化" : "绩效"}申报汇总`]);
  summary.addRow([`${meta.name}　${meta.unit}`]);
  summary.addRow([]);
  summary.addRow([parentLabel, groupLabel, "条数", scoreLabel]);

  for (const group of pkg.groups) {
    summary.addRow([group.parent, group.label, group.rows.length, group.subtotal]);
  }
  summary.addRow([]);
  summary.addRow(["合计", "", pkg.groups.reduce((n, g) => n + g.rows.length, 0), pkg.total]);

  summary.getRow(1).font = { bold: true, size: 14 };
  summary.getRow(4).font = { bold: true };
  summary.lastRow!.font = { bold: true };
  summary.columns = [{ width: 22 }, { width: 34 }, { width: 8 }, { width: 12 }];

  // ── 明细表（材料目录）──
  const detail = book.addWorksheet("明细");
  detail.addRow([
    "序号",
    parentLabel,
    groupLabel,
    "成果名称",
    "年度",
    "级别",
    "本人角色",
    scoreLabel,
    "材料份数",
  ]);

  for (const group of pkg.groups) {
    for (const row of group.rows) {
      detail.addRow([
        row.index,
        group.parent,
        group.label,
        row.title,
        row.year ?? "待补",
        row.level,
        row.ownerRole,
        row.score ?? "待填",
        // 0 份材料要显眼——申报前得补上
        row.attachmentCount === 0 ? "缺材料" : row.attachmentCount,
      ]);
    }
  }

  detail.getRow(1).font = { bold: true };
  detail.columns = [
    { width: 6 },
    { width: 20 },
    { width: 28 },
    { width: 52 },
    { width: 8 },
    { width: 10 },
    { width: 16 },
    { width: 12 },
    { width: 10 },
  ];
  // 成果名称长，让它折行而不是撑爆列宽
  detail.getColumn(4).alignment = { wrapText: true, vertical: "top" };

  if (quality) {
    const notes = book.addWorksheet("质量说明");
    notes.addRow([`${pkg.year} 年度带问题导出质量说明`]);
    notes.addRow(["这份工作簿覆盖了安全默认筛选，提交前请逐项核对。"]);
    notes.addRow(["问题", "条数", "说明", "代码"]);
    for (const issue of quality.issues) {
      notes.addRow([issue.label, issue.count, issue.detail, issue.code]);
    }
    notes.getRow(1).font = { bold: true, size: 14 };
    notes.getRow(3).font = { bold: true };
    notes.columns = [{ width: 24 }, { width: 8 }, { width: 56 }, { width: 24 }];
    notes.getColumn(3).alignment = { wrapText: true, vertical: "top" };
  }

  const buffer = await book.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
