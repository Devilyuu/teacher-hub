import { describe, expect, it } from "vitest";
import { buildExportRunData } from "./run";

describe("buildExportRunData", () => {
  it("记录覆盖选项、问题摘要与能回答上次导出哪些行的快照", () => {
    const data = buildExportRunData({
      requestKey: "request-1",
      kind: "performance",
      year: 2026,
      options: { includeUnverified: true, includeMissingYear: false },
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
});
