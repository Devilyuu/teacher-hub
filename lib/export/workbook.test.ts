import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { DeclarationPackage } from "./declaration";
import { buildDeclarationWorkbook, promotionPeriodLine } from "./workbook";

const pkg: DeclarationPackage = {
  kind: "performance",
  year: 2026,
  groups: [
    {
      key: "科研/论文",
      label: "论文",
      parent: "科研",
      subtotal: 3,
      rows: [
        {
          index: 1,
          sourceKind: "ACHIEVEMENT",
          sourceId: "a1",
          title: "某篇论文",
          year: 2026,
          level: "省级",
          ownerRole: "第一作者",
          score: 3,
          attachmentCount: 1,
        },
      ],
    },
  ],
  total: 3,
  missingMaterialCount: 0,
};

describe("buildDeclarationWorkbook", () => {
  it("安全默认导出只有汇总和明细", async () => {
    const buffer = await buildDeclarationWorkbook(pkg, { name: "张三", unit: "设计学院", currentTitleSince: null });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer as unknown as Parameters<typeof book.xlsx.load>[0]);
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(["汇总", "明细"]);
  });

  it("带问题导出增加质量说明并列出被覆盖的问题", async () => {
    const buffer = await buildDeclarationWorkbook(
      pkg,
      { name: "张三", unit: "设计学院", currentTitleSince: null },
      {
        issues: [
          {
            code: "unverified",
            label: "未核实",
            count: 2,
            detail: "显式包含 2 条未核实成果",
          },
        ],
      },
    );
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer as unknown as Parameters<typeof book.xlsx.load>[0]);

    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(["汇总", "明细", "质量说明"]);
    expect(book.getWorksheet("质量说明")?.getCell("A4").value).toBe("未核实");
    expect(book.getWorksheet("质量说明")?.getCell("B4").value).toBe(2);
  });

  /**
   * 职称表的年份是申报年度，里面是之前好几年的成果。抬头不写清取数范围，
   * 评审看到「2027」表里全是 2020–2026 的东西会以为导错了
   */
  it("职称表抬头写申报年度和任现职时间窗，表头行照常加粗", async () => {
    const promotion: DeclarationPackage = { ...pkg, kind: "promotion", year: 2027 };
    const buffer = await buildDeclarationWorkbook(promotion, {
      name: "张三",
      unit: "设计学院",
      currentTitleSince: new Date(Date.UTC(2019, 8, 1)),
    });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer as unknown as Parameters<typeof book.xlsx.load>[0]);
    const summary = book.getWorksheet("汇总")!;

    expect(summary.getCell("A1").value).toBe("按 2027 年申报 · 职称量化申报汇总");
    expect(summary.getCell("A3").value).toBe("取数范围：任现职以来，2019-09-01 至 2026-12-31");
    expect(summary.getCell("A5").value).toBe("一级指标");
    expect(summary.getRow(5).font?.bold).toBe(true);
  });

  /** 人事处核的是封顶后的数；原始合计也留着，明细逐条的原始分要和它对得上账 */
  it("职称表有封顶核算时，合计下面写封顶后合计并逐条列截掉的栏", async () => {
    const promotion: DeclarationPackage = {
      ...pkg,
      kind: "promotion",
      year: 2027,
      total: 12,
      caps: {
        rawTotal: 12,
        cappedTotal: 9,
        groups: [],
        majors: [],
        overCap: [{ label: "4.5+4.6", raw: 12, cap: 9 }],
      },
    };
    const buffer = await buildDeclarationWorkbook(promotion, {
      name: "张三",
      unit: "设计学院",
      currentTitleSince: null,
    });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer as unknown as Parameters<typeof book.xlsx.load>[0]);
    const values = book
      .getWorksheet("汇总")!
      .getSheetValues()
      .map((row) => (Array.isArray(row) ? row.slice(1) : []));

    expect(values).toContainEqual(["合计", "", 1, 12]);
    expect(values).toContainEqual(["封顶后合计", "", "", 9]);
    expect(values).toContainEqual(["4.5+4.6", "原始 12 分，上限 9 分", "", 9]);
  });

  it("没有封顶核算时不写封顶后合计", async () => {
    const buffer = await buildDeclarationWorkbook(
      { ...pkg, kind: "promotion", year: 2027 },
      { name: "张三", unit: "设计学院", currentTitleSince: null },
    );
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer as unknown as Parameters<typeof book.xlsx.load>[0]);
    const firstColumn = book
      .getWorksheet("汇总")!
      .getColumn(1)
      .values.filter((value) => typeof value === "string");
    expect(firstColumn).not.toContain("封顶后合计");
  });

  it("档案没填任现职日期时，照实说没有起点", () => {
    expect(promotionPeriodLine(2027, null)).toBe(
      "取数范围：算到 2026-12-31（档案未填任现职日期，没有起点）",
    );
  });

  it("绩效表抬头不带取数范围那一行", async () => {
    const buffer = await buildDeclarationWorkbook(pkg, {
      name: "张三",
      unit: "设计学院",
      currentTitleSince: new Date(Date.UTC(2019, 8, 1)),
    });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer as unknown as Parameters<typeof book.xlsx.load>[0]);
    const summary = book.getWorksheet("汇总")!;

    expect(summary.getCell("A1").value).toBe("2026 年度绩效申报汇总");
    expect(summary.getCell("A4").value).toBe("大类");
  });
});
