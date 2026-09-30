import { describe, expect, it } from "vitest";
import { buildCatalogPlan } from "./perf-rules";
import { buildPromotionPlan } from "./promotion-rules";
import {
  cleanName,
  gridToTsv,
  guessColumnRoles,
  looksLikeHeader,
  parseCapText,
  parsePastedTable,
  tableToPerfPack,
  tableToPromotionPack,
  validateRoles,
  type ColumnRole,
} from "./pasted-table";

/** 一行一个数组，拼成 Excel 复制出来的样子：制表符分列、换行分行 */
const tsv = (...rows: string[][]) => rows.map((cells) => cells.join("\t")).join("\n");

const OPTIONS = { hasHeader: true, year: 2026, source: "明湖职业技术学院职称评审量化表（虚构）" };

function promotion(text: string, roles?: ColumnRole[]) {
  const grid = parsePastedTable(text);
  const hasHeader = looksLikeHeader("promotion", grid[0]!);
  const resolved = roles ?? guessColumnRoles("promotion", grid, hasHeader);
  return { grid, roles: resolved, ...tableToPromotionPack(grid, resolved, { ...OPTIONS, hasHeader }) };
}

describe("parsePastedTable", () => {
  it("制表符分列、换行分行，每格去首尾空白，补齐成一样宽", () => {
    expect(parsePastedTable("甲\t乙\t丙\r\n 丁 \t戊\n")).toEqual([
      ["甲", "乙", "丙"],
      ["丁", "戊", ""],
    ]);
  });

  it("Excel 的引号：格子里有换行、制表符时整格包引号，里面的引号写两遍", () => {
    const text = '课程建设\t"国家级8分\n省级5分"\t"写着""备注""\t的格子"';
    expect(parsePastedTable(text)).toEqual([["课程建设", "国家级8分\n省级5分", '写着"备注"\t的格子']]);
  });

  it("首尾的空行去掉，中间的空行留着（后面按空行跳过）", () => {
    expect(parsePastedTable("\n\n甲\t乙\n\t\n丙\t丁\n\n")).toEqual([
      ["甲", "乙"],
      ["", ""],
      ["丙", "丁"],
    ]);
  });

  it("全角空格当空白", () => {
    expect(parsePastedTable("　甲　\t乙")).toEqual([["甲", "乙"]]);
  });

  it("gridToTsv 写回去再读，一个字不差", () => {
    const grid = [
      ["一级", '含"引号"', "含\t制表符"],
      ["含\n换行", "", "普通"],
    ];
    expect(parsePastedTable(gridToTsv(grid))).toEqual(grid);
  });
});

describe("parseCapText", () => {
  it.each([
    ["10", 10],
    ["10分", 10],
    ["上限10分", 10],
    ["不超过 12 分", 12],
    ["8分封顶", 8],
    ["≤6", 6],
    ["２.５", 2.5],
  ])("认「%s」", (text, value) => {
    expect(parseCapText(text)).toBe(value);
  });

  it.each(["每项2分，累计不超过10分", "按实际计", "", "10-15分", "国家级10分"])(
    "不认「%s」——两个数或别的字一律不猜",
    (text) => {
      expect(parseCapText(text)).toBeNull();
    },
  );
});

describe("cleanName", () => {
  it("汉字之间的换行直接接上，别的换成空格", () => {
    expect(cleanName("指导学生\n竞赛获奖")).toBe("指导学生竞赛获奖");
    expect(cleanName("SCI\nEI 论文")).toBe("SCI EI 论文");
  });
});

describe("表头与列的角色", () => {
  it("认得出常见的列名", () => {
    const grid = parsePastedTable(tsv(["序号", "一级指标", "二级指标", "赋分标准", "分值上限", "备注"]));
    expect(looksLikeHeader("promotion", grid[0]!)).toBe(true);
    expect(guessColumnRoles("promotion", grid, true)).toEqual(["code", "major", "minor", "rule", "cap", "remark"]);
  });

  it("「一级指标上限」认成一级上限，不被「一级」抢走", () => {
    const grid = parsePastedTable(tsv(["一级指标", "一级指标上限", "二级指标", "评分标准"]));
    expect(guessColumnRoles("promotion", grid, true)).toEqual(["major", "majorCap", "minor", "rule"]);
  });

  it("绩效表认得出分级那几列", () => {
    const grid = parsePastedTable(tsv(["类别", "项目", "基本分", "国家级", "省级", "市级", "校级", "学院级", "备注"]));
    expect(guessColumnRoles("perf", grid, true)).toEqual([
      "major",
      "minor",
      "base",
      "national",
      "provincial",
      "city",
      "school",
      "college",
      "remark",
    ]);
  });

  it("认不出的列名：有字的并进赋分原文（带表头不丢），整列空的不导入", () => {
    const grid = parsePastedTable(tsv(["大类", "小类", "一等奖", "空列"], ["教学", "课程", "5", ""]));
    expect(guessColumnRoles("perf", grid, true)).toEqual(["major", "minor", "rule", "ignore"]);
  });

  it("没表头时按内容猜：像编号的当编号、全是数的当上限，文字列依次当一级、二级、赋分", () => {
    const grid = parsePastedTable(
      tsv(["1.1", "教学", "课程建设", "国家级8分", "10"], ["1.2", "教学", "教学竞赛", "一等奖5分", "8"]),
    );
    expect(looksLikeHeader("promotion", grid[0]!)).toBe(false);
    expect(guessColumnRoles("promotion", grid, false)).toEqual(["code", "major", "minor", "rule", "cap"]);
  });

  it("同一个只能有一列的角色猜给了两列：后面那列退掉", () => {
    const grid = parsePastedTable(tsv(["二级指标", "指标名称", "国家级", "国家级"]));
    const roles = guessColumnRoles("perf", grid, true);
    expect(roles.filter((role) => role === "minor")).toHaveLength(1);
    expect(roles.filter((role) => role === "national")).toHaveLength(1);
  });

  it("validateRoles：二级指标必须有、只能一列的不能重复、列数要对得上", () => {
    expect(validateRoles("promotion", ["major", "rule"], 2)).toMatch(/二级指标/);
    expect(validateRoles("promotion", ["minor", "minor"], 2)).toMatch(/只能指定一列/);
    expect(validateRoles("promotion", ["minor", "rule", "rule"], 3)).toBeNull();
    expect(validateRoles("promotion", ["minor"], 2)).toMatch(/列数/);
    expect(validateRoles("perf", ["minor", "national"], 2)).toBeNull();
    expect(validateRoles("perf", ["minor", "code"], 2)).toMatch(/不认识/);
  });
});

describe("tableToPromotionPack", () => {
  const excel = tsv(
    ["一级指标", "二级指标", "赋分标准", "上限"],
    ["教学工作", "课程建设", "国家级8分，省级5分", "10"],
    ["", "教学竞赛", "一等奖5分", "8"],
    ["科研工作", "纵向项目", "国家级6分", "上限12分"],
    ["", "横向项目", "每10万元1分，累计不超过10分", "不超过10分"],
  );

  it("Excel 合并的一级指标：下面几格是空的，往下沿用", () => {
    const { doc } = promotion(excel);
    expect(doc.indicators.map((row) => [row.major_indicator, row.minor_indicator])).toEqual([
      ["教学工作", "课程建设"],
      ["教学工作", "教学竞赛"],
      ["科研工作", "纵向项目"],
      ["科研工作", "横向项目"],
    ]);
  });

  it("没有编号列：按顺序编 1.1、1.2、2.1，并写明", () => {
    const { doc, notes } = promotion(excel);
    expect(doc.indicators.map((row) => row.code)).toEqual(["1.1", "1.2", "2.1", "2.2"]);
    expect(notes[0]).toMatch(/原表没有编号列.*1\.1/);
  });

  it("上限认得出的写成数，赋分原文一个字不改", () => {
    const { doc } = promotion(excel);
    expect(doc.indicators.map((row) => row.cap)).toEqual([10, 8, 12, 10]);
    expect(doc.indicators[3]!.scoring_rule).toBe("每10万元1分，累计不超过10分");
  });

  it("转出来的规则包直接喂得进 buildPromotionPlan", () => {
    const { doc } = promotion(excel);
    const plan = buildPromotionPlan(doc);
    expect(plan.drafts).toHaveLength(4);
    expect(plan.warnings).toEqual([]);
  });

  it("上限写成一句话的不猜，照原样留着并告警", () => {
    const { doc, warnings } = promotion(
      tsv(["一级指标", "二级指标", "上限"], ["教学", "课程", "每项2分，累计不超过10分"]),
    );
    expect(doc.indicators[0]!.cap).toBeNull();
    expect(warnings[0]).toMatch(/第 2 行的上限「每项2分，累计不超过10分」不是一个单独的数/);
  });

  it("合并单元格拆出来的续行（二级指标空着、只有规则）接到上一条后面", () => {
    const { doc, notes, itemCount } = promotion(
      tsv(["一级指标", "二级指标", "赋分标准"], ["教学", "课程建设", "国家级8分"], ["", "", "省级5分"]),
    );
    expect(itemCount).toBe(1);
    expect(doc.indicators[0]!.scoring_rule).toBe("国家级8分\n省级5分");
    expect(notes.join()).toMatch(/1 行是上一条的续行/);
  });

  it("剪贴板 HTML 展开后，竖着合并的二级指标每行都有：同名相邻的也并成一条", () => {
    const { doc, itemCount } = promotion(
      tsv(
        ["一级指标", "二级指标", "赋分标准"],
        ["教学", "课程建设", "国家级8分"],
        ["教学", "课程建设", "省级5分"],
        ["教学", "教学竞赛", "一等奖5分"],
      ),
    );
    expect(itemCount).toBe(2);
    expect(doc.indicators[0]!.scoring_rule).toBe("国家级8分\n省级5分");
  });

  it("写在编号列里的分节标题（「一、教学工作」）当一级指标；编号在各节里重新数，就整表重编", () => {
    const { doc, notes } = promotion(
      tsv(
        ["序号", "指标", "分值"],
        ["一、教学工作", "", ""],
        ["1", "课程建设", "8"],
        ["2", "教学竞赛", "5"],
        ["二、科研工作", "", ""],
        ["1", "纵向项目", "6"],
      ),
    );
    expect(doc.indicators.map((row) => [row.code, row.major_indicator, row.minor_indicator])).toEqual([
      ["1.1", "一、教学工作", "课程建设"],
      ["1.2", "一、教学工作", "教学竞赛"],
      ["2.1", "二、科研工作", "纵向项目"],
    ]);
    expect(notes[0]).toMatch(/编号那一列有重复（1）/);
  });

  it("一级、二级写在同一列里：没有规则的「一、…」行是分节标题", () => {
    const { doc } = promotion(
      tsv(["指标", "赋分"], ["一、教学工作", ""], ["课程建设", "8分"], ["二、科研", ""], ["纵向项目", "6分"]),
      ["minor", "rule"],
    );
    expect(doc.indicators.map((row) => [row.major_indicator, row.minor_indicator])).toEqual([
      ["一、教学工作", "课程建设"],
      ["二、科研", "纵向项目"],
    ]);
  });

  it("原表编号齐全、不重复就照原样用", () => {
    const { doc, notes } = promotion(
      tsv(["编号", "一级指标", "二级指标"], ["A1", "教学", "课程"], ["B3", "科研", "纵向"]),
    );
    expect(doc.indicators.map((row) => row.code)).toEqual(["A1", "B3"]);
    expect(notes).toEqual([]);
  });

  it("合计行不导入", () => {
    const { itemCount, notes } = promotion(
      tsv(["一级指标", "二级指标", "上限"], ["教学", "课程", "10"], ["合计", "", "100"]),
    );
    expect(itemCount).toBe(1);
    expect(notes.join()).toMatch(/第 3 行是合计行/);
  });

  it("多列都是赋分原文时并成一格，每段带上表头", () => {
    const { doc } = promotion(
      tsv(["一级指标", "二级指标", "国家级", "省级"], ["科研", "纵向项目", "6分", "4分"]),
      ["major", "minor", "rule", "rule"],
    );
    expect(doc.indicators[0]!.scoring_rule).toBe("国家级 6分；省级 4分");
  });

  it("看不出归属的放进「未分组」并告警", () => {
    const { doc, warnings } = promotion(tsv(["二级指标", "赋分"], ["课程建设", "8分"]), ["minor", "rule"]);
    expect(doc.indicators[0]!.major_indicator).toBe("未分组");
    expect(warnings.join()).toMatch(/未分组/);
  });

  it("前面没有指标可接的规则行不导入，并告警", () => {
    const { itemCount, warnings } = promotion(
      tsv(["一级指标", "二级指标", "赋分"], ["", "", "孤零零的一句"], ["教学", "课程", "8分"]),
    );
    expect(itemCount).toBe(1);
    expect(warnings.join()).toMatch(/第 2 行有规则文字，但前面没有指标可以接上/);
  });

  it("一级上限列：合并单元格只在第一行有值，整组都认", () => {
    const { doc } = promotion(
      tsv(
        ["一级指标", "一级指标上限", "二级指标", "上限"],
        ["教学", "20", "课程", "12"],
        ["", "", "竞赛", "8"],
      ),
    );
    expect(doc.indicators.map((row) => row.major_cap)).toEqual([20, 20]);
    expect(buildPromotionPlan(doc).checks).toEqual([
      { label: "一级指标「教学」", expected: 20, actual: 20, ok: true },
    ]);
  });
});

describe("tableToPerfPack", () => {
  it("分级列各进各的格，续行接上，排序号按先后", () => {
    const grid = parsePastedTable(
      tsv(
        ["类别", "项目", "国家级", "省级", "市级", "校级", "备注"],
        ["教科研项目", "纵向项目立项", "30/项", "15/项", "8/项", "3/项", "基本分另计"],
        ["", "横向到账", "", "", "", "", "按到账金额"],
        ["", "", "", "", "", "", "以财务凭证为准"],
      ),
    );
    const roles = guessColumnRoles("perf", grid, true);
    const { doc } = tableToPerfPack(grid, roles, OPTIONS);
    expect(doc.rules).toEqual([
      expect.objectContaining({
        category: "教科研项目",
        subcategory: "纵向项目立项",
        national_rule: "30/项",
        school_rule: "3/项",
        remark: "基本分另计",
        sort_order: 10,
      }),
      expect.objectContaining({
        category: "教科研项目",
        subcategory: "横向到账",
        national_rule: null,
        remark: "按到账金额\n以财务凭证为准",
        sort_order: 20,
      }),
    ]);
    expect(buildCatalogPlan(doc).drafts).toHaveLength(2);
  });

  it("不是分级的赋分列（一等奖、二等奖）并进基本分那一格，带表头", () => {
    const grid = parsePastedTable(tsv(["大类", "小类", "一等奖", "二等奖"], ["竞赛", "技能大赛", "10", "6"]));
    const { doc } = tableToPerfPack(grid, guessColumnRoles("perf", grid, true), OPTIONS);
    expect(doc.rules[0]!.base_rule).toBe("一等奖 10；二等奖 6");
  });
});
