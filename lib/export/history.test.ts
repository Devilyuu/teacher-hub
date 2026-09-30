import { describe, expect, it } from "vitest";
import {
  describeExportRun,
  parseDeclarationRunOptions,
  parseDeclarationSnapshot,
  type ExportRunSummary,
} from "./history";

function run(overrides: Partial<ExportRunSummary> = {}): ExportRunSummary {
  return {
    id: "run-1",
    kind: "PERF_DECLARATION",
    year: 2026,
    projectId: null,
    options: { includeUnverified: false, includeMissingYear: false, format: "xlsx" },
    includedCount: 12,
    issueSummary: [],
    createdAt: new Date("2026-09-26T02:30:00Z"),
    ...overrides,
  };
}

describe("describeExportRun", () => {
  it("绩效表写「年度」，点进去看当时的行快照", () => {
    expect(describeExportRun(run(), new Map())).toMatchObject({
      title: "2026 年度 · 绩效申报表",
      formatLabel: "申报表",
      overrides: [],
      includedCount: 12,
      href: "/export/runs/run-1",
    });
  });

  /** 职称表的 year 是申报年度（任现职时间窗），写「年度」会被读成那一年的成果 */
  it("职称表写「年申报」，不写「年度」", () => {
    expect(describeExportRun(run({ kind: "PROMOTION_DECLARATION", year: 2027 }), new Map()).title).toBe(
      "2027 年申报 · 职称量化表",
    );
  });

  it("申报包 ZIP 和带问题导出都写出来", () => {
    const view = describeExportRun(
      run({ options: { includeUnverified: true, includeMissingYear: true, format: "zip" } }),
      new Map(),
    );
    expect(view.formatLabel).toBe("申报包 ZIP");
    expect(view.overrides).toEqual(["含未核实", "含没填年度"]);
  });

  /** 09-26 以前的记录 options 里没有 format，那时只有 xlsx */
  it("旧记录没有 format 就当申报表", () => {
    const view = describeExportRun(
      run({ options: { includeUnverified: false, includeMissingYear: false } }),
      new Map(),
    );
    expect(view.formatLabel).toBe("申报表");
  });

  it("当时仍带的问题按预检的叫法列出，没数的不列", () => {
    const view = describeExportRun(
      run({
        issueSummary: [
          { code: "missingMaterial", count: 3 },
          { code: "missingScore", count: 0 },
          { code: "somethingNew", count: 1 },
          "garbage",
        ],
      }),
      new Map(),
    );
    expect(view.issues).toEqual(["没有支撑材料 3", "somethingNew 1"]);
  });

  it("课题那两种写课题简称，回课题详情；课题删了照实说，不给死链接", () => {
    const titles = new Map([["p1", "AI+数字创意"]]);
    expect(
      describeExportRun(run({ kind: "MATERIAL_ZIP", year: null, projectId: "p1", options: {} }), titles),
    ).toMatchObject({ title: "课题材料 ZIP · AI+数字创意", formatLabel: null, href: "/projects/p1" });
    expect(
      describeExportRun(run({ kind: "PROJECT_CLOSEOUT", year: null, projectId: "gone", options: {} }), titles),
    ).toMatchObject({ title: "结题清单 · 已删除的课题", href: null });
  });
});

describe("parseDeclarationRunOptions", () => {
  it("认不出的一律按默认值：不覆盖、xlsx", () => {
    expect(parseDeclarationRunOptions(null)).toEqual({
      includeUnverified: false,
      includeMissingYear: false,
      format: "xlsx",
    });
    expect(parseDeclarationRunOptions({ includeUnverified: "true", format: "pdf" })).toEqual({
      includeUnverified: false,
      includeMissingYear: false,
      format: "xlsx",
    });
  });
});

describe("parseDeclarationSnapshot", () => {
  const group = { key: "5.1", label: "5.1 论文", parent: "科研成果及业绩" };

  it("按序号排好，缺的字段按旧版本含义补，认不出的行跳过", () => {
    expect(
      parseDeclarationSnapshot([
        { index: 2, title: "乙", year: null, level: "省级", ownerRole: "", score: null, attachmentCount: 0, group },
        { index: 1, title: "甲", year: 2025, level: "国家级", ownerRole: "主持", score: 3.5, attachmentCount: 2, group },
        { title: "没有序号" },
        "garbage",
      ]),
    ).toEqual([
      {
        index: 1,
        title: "甲",
        year: 2025,
        level: "国家级",
        ownerRole: "主持",
        score: 3.5,
        attachmentCount: 2,
        group,
        materials: null,
      },
      {
        index: 2,
        title: "乙",
        year: null,
        level: "省级",
        ownerRole: "",
        score: null,
        attachmentCount: 0,
        group,
        materials: null,
      },
    ]);
  });

  /** 申报包 ZIP 时每行记了附上的文件；只导了表的记录没有这一项 */
  it("ZIP 的行带出附了哪些文件，只导表的是 null", () => {
    const [row] = parseDeclarationSnapshot([
      {
        index: 1,
        title: "甲",
        group,
        materials: [{ attachmentId: "f1", name: "支撑材料/01-1_见刊页_a.pdf", size: 1 }, { bad: true }],
      },
    ]);
    expect(row.materials).toEqual(["支撑材料/01-1_见刊页_a.pdf"]);
  });

  it("快照不是数组（课题那两种的形状）时给空列表", () => {
    expect(parseDeclarationSnapshot({ heading: "结题清单" })).toEqual([]);
  });
});
