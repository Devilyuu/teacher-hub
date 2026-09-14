import { describe, expect, it } from "vitest";
import {
  checkMaterialLinkable,
  groupMaterialsByKind,
  requirementSummariesByAttachment,
} from "./materials";

const PROJECT = "project-1";
const OTHER_PROJECT = "project-2";

describe("checkMaterialLinkable", () => {
  it("同课题的课题级材料可以关联", () => {
    expect(
      checkMaterialLinkable({
        projectId: PROJECT,
        requirement: { projectId: PROJECT },
        attachment: { projectId: PROJECT },
      }),
    ).toEqual({ ok: true });
  });

  /**
   * requirementId 来自 FormData，projectId 来自 URL 绑定。
   * 只信 formData 的话，改一个 id 就能给别人的课题挂材料。
   */
  it("要求项不属于 URL 上的课题时拒绝", () => {
    expect(
      checkMaterialLinkable({
        projectId: PROJECT,
        requirement: { projectId: OTHER_PROJECT },
        attachment: { projectId: PROJECT },
      }),
    ).toEqual({ ok: false, reason: "REQUIREMENT_NOT_FOUND" });
  });

  it("要求项不存在时拒绝", () => {
    expect(
      checkMaterialLinkable({
        projectId: PROJECT,
        requirement: null,
        attachment: { projectId: PROJECT },
      }),
    ).toEqual({ ok: false, reason: "REQUIREMENT_NOT_FOUND" });
  });

  it("材料不存在时拒绝", () => {
    expect(
      checkMaterialLinkable({
        projectId: PROJECT,
        requirement: { projectId: PROJECT },
        attachment: null,
      }),
    ).toEqual({ ok: false, reason: "ATTACHMENT_NOT_FOUND" });
  });

  /**
   * 规格 6.4 的边界：成果级证据不走这张表，否则同一份论文 PDF
   * 会既作为课题材料、又经 RequirementLink → Achievement 进来，
   * ZIP 里出现两次，材料清单也会重复计数。
   */
  it("成果级证据（projectId 为空）拒绝直接关联", () => {
    expect(
      checkMaterialLinkable({
        projectId: PROJECT,
        requirement: { projectId: PROJECT },
        attachment: { projectId: null },
      }),
    ).toEqual({ ok: false, reason: "NOT_PROJECT_MATERIAL" });
  });

  /**
   * 个人常用文档同样没有 projectId，但它不是成果证据。把 docCategoryId 明写出来，
   * 锁住新增第三种 owner 仍只能作为私人参考、不能变成结题材料的边界。
   */
  it("个人常用文档（docCategoryId 非空）拒绝直接关联", () => {
    expect(
      checkMaterialLinkable({
        projectId: PROJECT,
        requirement: { projectId: PROJECT },
        attachment: { projectId: null, docCategoryId: "category-1" },
      }),
    ).toEqual({ ok: false, reason: "NOT_PROJECT_MATERIAL" });
  });

  it("跨课题的材料拒绝关联", () => {
    expect(
      checkMaterialLinkable({
        projectId: PROJECT,
        requirement: { projectId: PROJECT },
        attachment: { projectId: OTHER_PROJECT },
      }),
    ).toEqual({ ok: false, reason: "CROSS_PROJECT" });
  });
});

describe("groupMaterialsByKind", () => {
  it("按生命周期顺序分组，空组不出现", () => {
    const groups = groupMaterialsByKind([
      { id: "c", kind: "OTHER" },
      { id: "a", kind: "FINAL_REPORT" },
      { id: "b", kind: "PROPOSAL" },
      { id: "d", kind: "PROCESS_EVIDENCE" },
    ]);

    expect(groups.map((g) => g.kind)).toEqual([
      "PROPOSAL",
      "PROCESS_EVIDENCE",
      "FINAL_REPORT",
      "OTHER",
    ]);
    expect(groups.map((g) => g.label)).toEqual(["申报书", "过程证据", "结题报告", "其他"]);
  });

  it("同组内保持传入顺序——调用方已经按上传时间排好了", () => {
    const groups = groupMaterialsByKind([
      { id: "first", kind: "PROPOSAL" },
      { id: "second", kind: "PROPOSAL" },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.id)).toEqual(["first", "second"]);
  });

  it("没有材料时返回空数组，不返回一堆空组", () => {
    expect(groupMaterialsByKind([])).toEqual([]);
  });
});

describe("requirementSummariesByAttachment", () => {
  it("序号跟结题清单里从上往下数的位置一致", () => {
    const map = requirementSummariesByAttachment([
      { rawText: "第一条要求", materials: [{ attachmentId: "a" }] },
      { rawText: "第二条要求", materials: [] },
      { rawText: "第三条要求", materials: [{ attachmentId: "a" }, { attachmentId: "b" }] },
    ]);

    expect(map["a"]).toEqual([
      { label: "要求 1", title: "第一条要求" },
      { label: "要求 3", title: "第三条要求" },
    ]);
    expect(map["b"]).toEqual([{ label: "要求 3", title: "第三条要求" }]);
  });

  /** rawText 是真相来源，标签只做短标识，全文原样进 title（CLAUDE.md 第 2 条） */
  it("要求原文原样带出，不截断不改写", () => {
    const rawText = "公开发表与本课题相关的学术论文 2 篇，其中核心期刊不少于 1 篇，本人须为第一作者";
    const map = requirementSummariesByAttachment([
      { rawText, materials: [{ attachmentId: "a" }] },
    ]);

    expect(map["a"][0].title).toBe(rawText);
  });

  it("没有关联的材料不出现在结果里", () => {
    expect(requirementSummariesByAttachment([{ rawText: "x", materials: [] }])).toEqual({});
  });
});
