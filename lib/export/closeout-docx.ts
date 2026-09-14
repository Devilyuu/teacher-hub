import "server-only";
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { CloseoutDocument, CloseoutMaterialRef } from "./closeout";

/**
 * 把结题清单模型写成 .docx（增量 3.2）。
 *
 * **只管排版，不做任何取舍**——列什么、算什么全在 closeout.ts 里定好了。
 * 和 xlsx 那边一个路子：这份东西交上去多半还要人再调，把内容摆对比样式重要。
 */

/** 正文字号 10.5pt。docx 的单位是半磅，所以是 21 */
const BODY_SIZE = 21;
const SMALL_SIZE = 18;

function text(value: string, options: { bold?: boolean; size?: number; grey?: boolean } = {}) {
  return new TextRun({
    text: value,
    bold: options.bold,
    size: options.size ?? BODY_SIZE,
    color: options.grey ? "595959" : undefined,
  });
}

function para(
  value: string,
  options: { bold?: boolean; size?: number; grey?: boolean; indent?: number; spacing?: number } = {},
) {
  return new Paragraph({
    children: [text(value, options)],
    indent: options.indent ? { left: options.indent } : undefined,
    spacing: { after: options.spacing ?? 80 },
  });
}

function cell(value: string, options: { bold?: boolean; width?: number } = {}) {
  return new TableCell({
    width: options.width ? { size: options.width, type: WidthType.PERCENTAGE } : undefined,
    children: [new Paragraph({ children: [text(value, { bold: options.bold })] })],
  });
}

function fullWidthTable(rows: TableRow[]): Table {
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });
}

/** 课题基本信息：两列一行摆成四格，比一行一项省一半篇幅 */
function fieldsTable(fields: CloseoutDocument["fields"]): Table {
  const rows: TableRow[] = [];
  for (let i = 0; i < fields.length; i += 2) {
    const left = fields[i];
    const right = fields[i + 1];
    rows.push(
      new TableRow({
        children: [
          cell(left.label, { bold: true, width: 18 }),
          cell(left.value, { width: 32 }),
          cell(right?.label ?? "", { bold: true, width: 18 }),
          cell(right?.value ?? "", { width: 32 }),
        ],
      }),
    );
  }
  return fullWidthTable(rows);
}

function materialsTable(
  materials: Array<CloseoutMaterialRef & { source?: string }>,
  withSource: boolean,
): Table {
  const header = new TableRow({
    children: [
      cell("材料编号", { bold: true, width: 14 }),
      cell("类型", { bold: true, width: 16 }),
      cell("文件名", { bold: true, width: withSource ? 52 : 70 }),
      ...(withSource ? [cell("来源", { bold: true, width: 18 })] : []),
    ],
  });

  const rows = materials.map((material) =>
    new TableRow({
      children: [
        cell(material.no),
        cell(material.kind),
        cell(material.note ? `${material.filename}（${material.note}）` : material.filename),
        ...(withSource ? [cell(material.source ?? "")] : []),
      ],
    }),
  );

  return fullWidthTable([header, ...rows]);
}

function requirementBlocks(doc: CloseoutDocument): Array<Paragraph | Table> {
  return doc.requirements.flatMap((requirement) => {
    const blocks: Array<Paragraph | Table> = [
      new Paragraph({
        children: [
          text(`要求 ${requirement.index}`, { bold: true }),
          text(
            `　已确认 ${requirement.qualifiedCount}/${requirement.requiredCount}` +
              (requirement.gap > 0 ? `　还差 ${requirement.gap} 项` : "　已齐备") +
              (requirement.dueDate ? `　${requirement.dueDate} 前` : ""),
            { grey: true, size: SMALL_SIZE },
          ),
        ],
        spacing: { before: 200, after: 60 },
      }),
      // 立项文件原文照抄（CLAUDE.md 第 2 条）
      para(requirement.rawText, { indent: 360 }),
    ];

    if (requirement.qualified.length > 0) {
      blocks.push(para("已确认达标的成果：", { bold: true, size: SMALL_SIZE, indent: 360 }));
      for (const item of requirement.qualified) {
        blocks.push(
          para(`· ${item.title}（${item.meta}）${item.note ? `　${item.note}` : ""}`, {
            indent: 600,
          }),
        );
      }
    } else {
      blocks.push(
        para("尚无已确认达标的成果。", { grey: true, size: SMALL_SIZE, indent: 360 }),
      );
    }

    // 挂了但没确认达标的单独列。**不并进上面那栏**——
    // 是否达标只由人工勾选决定，系统不替用户把「在办」算成「已达标」
    if (requirement.pending.length > 0) {
      blocks.push(
        para("已挂接、尚未确认达标：", { bold: true, size: SMALL_SIZE, indent: 360, grey: true }),
      );
      for (const item of requirement.pending) {
        blocks.push(
          para(`· ${item.title}（${item.meta}）`, { indent: 600, grey: true, size: SMALL_SIZE }),
        );
      }
    }

    if (requirement.materials.length > 0) {
      blocks.push(para("对应材料：", { bold: true, size: SMALL_SIZE, indent: 360 }));
      blocks.push(materialsTable(requirement.materials, false));
      blocks.push(new Paragraph({ children: [], spacing: { after: 80 } }));
    }

    return blocks;
  });
}

export async function buildCloseoutDocx(doc: CloseoutDocument): Promise<Buffer> {
  const children: Array<Paragraph | Table> = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      children: [text(doc.heading, { bold: true, size: 32 })],
      spacing: { after: 120 },
    }),
  ];

  if (doc.subtitle) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [text(doc.subtitle, { grey: true, size: SMALL_SIZE })],
        spacing: { after: 240 },
      }),
    );
  }

  children.push(para("一、课题基本情况", { bold: true, spacing: 120 }));
  children.push(fieldsTable(doc.fields));

  children.push(
    new Paragraph({
      children: [
        text("二、结题要求与对应成果", { bold: true }),
        text(
          `　合计已确认 ${doc.summary.totalQualified}/${doc.summary.totalRequired}` +
            `　完成度 ${doc.summary.completionRate}` +
            (doc.summary.totalGap > 0 ? `　缺口 ${doc.summary.totalGap} 项` : ""),
          { grey: true, size: SMALL_SIZE },
        ),
      ],
      spacing: { before: 320, after: 120 },
    }),
  );

  if (doc.requirements.length === 0) {
    children.push(
      para("尚未录入结题要求。没有要求项就算不出缺口，完成度显示「—」而不是 0%。", {
        grey: true,
      }),
    );
  } else {
    children.push(...requirementBlocks(doc));
  }

  children.push(para("三、材料总目录", { bold: true, spacing: 120 }));
  if (doc.materialIndex.length === 0) {
    children.push(para("尚未上传任何材料。", { grey: true }));
  } else {
    children.push(
      para("编号与「下载全部材料」导出的 ZIP 内文件名一致。", {
        grey: true,
        size: SMALL_SIZE,
      }),
    );
    children.push(materialsTable(doc.materialIndex, true));
  }

  children.push(
    new Paragraph({
      children: [text(doc.footer, { grey: true, size: SMALL_SIZE })],
      spacing: { before: 400 },
    }),
  );

  const document = new Document({
    creator: "高校教师智能工作台",
    title: doc.heading,
    sections: [{ children }],
  });

  return Packer.toBuffer(document);
}
