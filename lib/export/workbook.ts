import "server-only";
import ExcelJS from "exceljs";
import { formatDateOnly } from "@/lib/date";
import { promotionWindow } from "@/lib/promotion";
import type { DeclarationPackage } from "./declaration";
import type { DeclarationExportProfile } from "./fingerprint";

/**
 * 职称表抬头那一行「取数范围」。交上去的表要能自证：哪天起算、算到哪天，
 * 不然评审一看 2027 年申报的表里全是 2020–2026 年的东西，会以为导错了
 */
export function promotionPeriodLine(year: number, titleSince: Date | null): string {
  const window = promotionWindow(titleSince, year);
  return window.from
    ? `取数范围：任现职以来，${formatDateOnly(window.from)} 至 ${window.toYear}-12-31`
    : `取数范围：算到 ${window.toYear}-12-31（档案未填任现职日期，没有起点）`;
}

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
  meta: DeclarationExportProfile,
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
  // 职称表的年份是申报年度，不是成果年度，标题里别写「2027 年度」
  const titleOf = (suffix: string) =>
    isPromotion ? `按 ${pkg.year} 年申报 · 职称量化${suffix}` : `${pkg.year} 年度绩效${suffix}`;

  // ── 汇总表 ──
  const summary = book.addWorksheet("汇总");
  summary.addRow([titleOf("申报汇总")]);
  summary.addRow([`${meta.name}　${meta.unit}`]);
  if (isPromotion) summary.addRow([promotionPeriodLine(pkg.year, meta.currentTitleSince)]);
  summary.addRow([]);
  const headerRow = summary.addRow([parentLabel, groupLabel, "条数", scoreLabel]);

  for (const group of pkg.groups) {
    summary.addRow([group.parent, group.label, group.rows.length, group.subtotal]);
  }
  summary.addRow([]);
  const totalRow = summary.addRow([
    "合计",
    "",
    pkg.groups.reduce((n, g) => n + g.rows.length, 0),
    pkg.total,
  ]);
  totalRow.font = { bold: true };

  // 职称包：原始分合计之外，另起一行写按量化表封顶截完的合计，再逐条列被截掉的栏。
  // 两个数都写——人事处核的是封顶后的数，而明细里每条的原始分要和它对得上账
  if (pkg.caps) {
    const cappedRow = summary.addRow(["封顶后合计", "", "", pkg.caps.cappedTotal]);
    cappedRow.font = { bold: true };
    if (pkg.caps.overCap.length > 0) {
      summary.addRow([]);
      summary.addRow(["超出上限的部分不计入："]);
      for (const over of pkg.caps.overCap) {
        summary.addRow([over.label, `原始 ${over.raw} 分，上限 ${over.cap} 分`, "", over.cap]);
      }
    }
  }

  summary.getRow(1).font = { bold: true, size: 14 };
  headerRow.font = { bold: true };
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
    notes.addRow([titleOf("表 · 带问题导出质量说明")]);
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
