import { describe, expect, it } from "vitest";
import { buildExportRunData } from "./run";

describe("buildExportRunData", () => {
  it("记录覆盖选项、问题摘要与能回答上次导出哪些行的快照", () => {
    const data = buildExportRunData({
      requestKey: "request-1",
      kind: "performance",
      year: 2026,
      options: { includeUnverified: true, includeMissingYear: false },
      format: "xlsx",
      issues: [
        { code: "unverified", count: 1 },
        { code: "missingMaterial", count: 2 },
      ],
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
    });

    expect(data).toMatchObject({
      kind: "PERF_DECLARATION",
      requestKey: "request-1",
      year: 2026,
      options: {
        includeUnverified: true,
        includeMissingYear: false,
        format: "xlsx",
      },
      includedCount: 1,
      issueSummary: [
        { code: "unverified", count: 1 },
        { code: "missingMaterial", count: 2 },
      ],
    });
    expect(data.snapshot).toEqual([
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
        group: { key: "科研/论文", label: "论文", parent: "科研" },
      },
    ]);
  });

  /** 附件之后删了换了，也查得到当时交出去的是哪几份 */
  it("ZIP 导出在每行快照里记下附了哪些文件，没附的行记空数组", () => {
    const row = (index: number, sourceId: string) => ({
      index,
      sourceKind: "ACHIEVEMENT" as const,
      sourceId,
      title: sourceId,
      year: 2026,
      level: "省级",
      ownerRole: "",
      score: 1,
      attachmentCount: index === 1 ? 2 : 0,
    });
    const data = buildExportRunData({
      requestKey: "request-2",
      kind: "promotion",
      year: 2027,
      options: { includeUnverified: false, includeMissingYear: false },
      format: "zip",
      issues: [],
      groups: [
        { key: "5.1", label: "5.1 论文", parent: "科研", subtotal: 2, rows: [row(1, "a1"), row(2, "a2")] },
      ],
      materials: [
        { rowIndex: 1, attachmentId: "f1", name: "支撑材料/01-1_见刊页_a.pdf", size: 10 },
        { rowIndex: 1, attachmentId: "f2", name: "支撑材料/01-2_收录证明_b.pdf", size: 20 },
      ],
    });

    expect(data.options).toEqual({ includeUnverified: false, includeMissingYear: false, format: "zip" });
    expect(data.snapshot.map((item) => ("materials" in item ? item.materials : null))).toEqual([
      [
        { attachmentId: "f1", name: "支撑材料/01-1_见刊页_a.pdf", size: 10 },
        { attachmentId: "f2", name: "支撑材料/01-2_收录证明_b.pdf", size: 20 },
      ],
      [],
    ]);
  });
});
