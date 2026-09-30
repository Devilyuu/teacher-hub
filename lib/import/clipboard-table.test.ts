import { describe, expect, it } from "vitest";
import { expandMergedCells, type HtmlCell } from "./clipboard-table";

const cell = (text: string, rowSpan = 1, colSpan = 1): HtmlCell => ({ text, rowSpan, colSpan });

describe("expandMergedCells", () => {
  it("竖着合并的格子往下每一行都填上——「这几行都属于它」", () => {
    expect(
      expandMergedCells([
        [cell("教学", 2), cell("课程建设"), cell("8分")],
        [cell("教学竞赛"), cell("5分")],
      ]),
    ).toEqual([
      ["教学", "课程建设", "8分"],
      ["教学", "教学竞赛", "5分"],
    ]);
  });

  it("横着合并的只放在第一格——整行合并的多半是分节标题，铺满就成了一条假指标", () => {
    expect(
      expandMergedCells([[cell("一、教学工作", 1, 3)], [cell("1"), cell("课程建设"), cell("8分")]]),
    ).toEqual([
      ["一、教学工作", "", ""],
      ["1", "课程建设", "8分"],
    ]);
  });

  it("同时有竖着和横着的合并，后面的格子往右让位", () => {
    expect(
      expandMergedCells([
        [cell("A", 2), cell("B"), cell("C")],
        [cell("D", 1, 2)],
      ]),
    ).toEqual([
      ["A", "B", "C"],
      ["A", "D", ""],
    ]);
  });

  it("rowspan 写得比表还长时不多造行", () => {
    expect(expandMergedCells([[cell("A", 5), cell("B")], [cell("C")]])).toEqual([
      ["A", "B"],
      ["A", "C"],
    ]);
  });
});
