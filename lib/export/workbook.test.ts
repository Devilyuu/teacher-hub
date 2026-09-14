import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { DeclarationPackage } from "./declaration";
import { buildDeclarationWorkbook } from "./workbook";

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
    const buffer = await buildDeclarationWorkbook(pkg, { name: "张三", unit: "设计学院" });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer as unknown as Parameters<typeof book.xlsx.load>[0]);
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(["汇总", "明细"]);
  });

  it("带问题导出增加质量说明并列出被覆盖的问题", async () => {
    const buffer = await buildDeclarationWorkbook(
      pkg,
      { name: "张三", unit: "设计学院" },
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
});
