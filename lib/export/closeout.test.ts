import { describe, expect, it } from "vitest";
import { buildCloseoutDocument, type CloseoutInput } from "./closeout";
import { buildMaterialZipPlan, type MaterialAttachment } from "./materials-zip";
import type { ProjectGap } from "@/lib/gap";

const NOW = new Date(2026, 6, 31);

function material(overrides: Partial<MaterialAttachment> & { id: string }): MaterialAttachment {
  return {
    code: null,
    kind: "PROPOSAL",
    filename: "申报书.pdf",
    storagePath: `projects/p/${overrides.id}.pdf`,
    size: 100,
    uploadedAt: NOW,
    ...overrides,
  };
}

function gap(overrides: Partial<ProjectGap> = {}): ProjectGap {
  return {
    requirements: [],
    totalRequired: 0,
    totalQualified: 0,
    totalGap: 0,
    completionRate: null,
    daysLeft: null,
    applyDaysLeft: null,
    displayDaysLeft: null,
    health: "UNSET",
    reusedAchievementIds: [],
    ...overrides,
  };
}

function input(overrides: Partial<CloseoutInput> = {}): CloseoutInput {
  return {
    project: {
      title: "地方传统技艺数字化传承路径研究",
      shortTitle: "明州社科联年度课题",
      code: "MZGZ202601",
      level: "MUNICIPAL",
      category: "RESEARCH",
      fundingType: "VERTICAL",
      status: "CLOSING",
      role: "LEAD",
      ownerOrder: 1,
      memberCount: 5,
      hostUnit: "明湖职业技术学院",
      sourceName: "明州市社科联",
      startDate: new Date(Date.UTC(2026, 0, 1)),
      endDate: new Date(Date.UTC(2026, 11, 31)),
      closingDeadline: new Date(Date.UTC(2026, 9, 30)),
      requirements: [],
    },
    gap: gap(),
    materialPlan: buildMaterialZipPlan({
      projectMaterials: [],
      achievementEvidence: [],
      selectedIds: null,
    }),
    profile: { name: "张三", unit: "示例学院" },
    generatedAt: NOW,
    ...overrides,
  };
}

const ACHIEVEMENT = {
  id: "a-1",
  title: "AIGC 赋能地方文化 IP 传播路径研究",
  type: "PAPER" as const,
  level: "PROVINCIAL" as const,
  publishedAt: new Date(Date.UTC(2026, 5, 1)),
  completedAt: null,
  datePrecision: "MONTH" as const,
  dateText: "2026年6月",
};

describe("buildCloseoutDocument 基本情况", () => {
  it("标题用简称，全称降为副标题", () => {
    const doc = buildCloseoutDocument(input());
    expect(doc.heading).toBe("明州社科联年度课题 结题材料清单");
    expect(doc.subtitle).toBe("地方传统技艺数字化传承路径研究");
  });

  it("没有简称时不留空副标题", () => {
    const base = input();
    const doc = buildCloseoutDocument({
      ...base,
      project: { ...base.project, shortTitle: null },
    });
    expect(doc.heading).toBe(
      "地方传统技艺数字化传承路径研究 结题材料清单",
    );
    expect(doc.subtitle).toBeNull();
  });

  it("空字段显示破折号，不留白", () => {
    const base = input();
    const doc = buildCloseoutDocument({
      ...base,
      project: { ...base.project, code: null, hostUnit: null, sourceName: null },
    });
    const byLabel = Object.fromEntries(doc.fields.map((f) => [f.label, f.value]));
    expect(byLabel["课题编号"]).toBe("—");
    expect(byLabel["承担单位"]).toBe("—");
    expect(byLabel["立项来源"]).toBe("—");
  });
});

describe("buildCloseoutDocument 要求与成果", () => {
  const withRequirement = () => {
    const base = input();
    return {
      ...base,
      project: {
        ...base.project,
        requirements: [
          {
            id: "r-1",
            rawText: "公开发表与本课题相关的学术论文 1 篇，本人须为第一作者。",
            requiredCount: 1,
            dueDate: new Date(Date.UTC(2026, 8, 30)),
            links: [
              { isQualified: true, qualifyNote: "已见刊，见 2026-06 期", achievement: ACHIEVEMENT },
              {
                isQualified: false,
                qualifyNote: null,
                achievement: { ...ACHIEVEMENT, id: "a-2", title: "在投的第二篇" },
              },
            ],
            materials: [],
          },
        ],
      },
      gap: gap({
        requirements: [
          { requirementId: "r-1", requiredCount: 1, qualifiedCount: 1, inProgressCount: 1, gap: 0 },
        ],
        totalRequired: 1,
        totalQualified: 1,
        totalGap: 0,
        completionRate: 1,
      }),
    };
  };

  /** 立项文件的原话是真相来源，一个字都不许改（CLAUDE.md 第 2 条） */
  it("要求原文原样照抄", () => {
    const doc = buildCloseoutDocument(withRequirement());
    expect(doc.requirements[0].rawText).toBe(
      "公开发表与本课题相关的学术论文 1 篇，本人须为第一作者。",
    );
  });

  /**
   * 系统只计算不判定（CLAUDE.md 第 1 条）：挂了但没勾「确认达标」的
   * 只能进「在办」那一栏，绝不能混进达标清单充数。
   */
  it("只有人工确认达标的进达标栏，其余单列在办", () => {
    const doc = buildCloseoutDocument(withRequirement());
    const requirement = doc.requirements[0];

    expect(requirement.qualified.map((item) => item.title)).toEqual([
      "AIGC 赋能地方文化 IP 传播路径研究",
    ]);
    expect(requirement.pending.map((item) => item.title)).toEqual(["在投的第二篇"]);
  });

  it("达标说明带出来——它写的是「凭什么算达标」", () => {
    const doc = buildCloseoutDocument(withRequirement());
    expect(doc.requirements[0].qualified[0].note).toBe("已见刊，见 2026-06 期");
  });

  /** 精度只到月，就不许显示成某一天（CLAUDE.md 第 8 条） */
  it("成果日期按 datePrecision 渲染", () => {
    const doc = buildCloseoutDocument(withRequirement());
    expect(doc.requirements[0].qualified[0].meta).toContain("2026-06");
    expect(doc.requirements[0].qualified[0].meta).not.toContain("2026-06-01");
  });

  /** 缺口只在 lib/gap.ts 算一处，这里照抄（CLAUDE.md 第 6 条） */
  it("缺口数字取自传入的 gap，不自己数链接", () => {
    const source = withRequirement();
    const doc = buildCloseoutDocument({
      ...source,
      gap: gap({
        requirements: [
          { requirementId: "r-1", requiredCount: 3, qualifiedCount: 1, inProgressCount: 1, gap: 2 },
        ],
        totalRequired: 3,
        totalQualified: 1,
        totalGap: 2,
        completionRate: 1 / 3,
      }),
    });

    expect(doc.requirements[0]).toMatchObject({ requiredCount: 3, qualifiedCount: 1, gap: 2 });
    expect(doc.summary).toMatchObject({ totalRequired: 3, totalQualified: 1, totalGap: 2 });
    expect(doc.summary.completionRate).toBe("33%");
  });

  /** totalRequired 为 0 时 completionRate 是 null，显示「—」而不是 0%（第 7 条） */
  it("没有要求项时完成度显示破折号", () => {
    expect(buildCloseoutDocument(input()).summary.completionRate).toBe("—");
  });

  it("序号与课题详情里从上往下数的位置一致", () => {
    const base = input();
    const doc = buildCloseoutDocument({
      ...base,
      project: {
        ...base.project,
        requirements: ["甲", "乙", "丙"].map((text, i) => ({
          id: `r-${i}`,
          rawText: text,
          requiredCount: 1,
          dueDate: null,
          links: [],
          materials: [],
        })),
      },
    });
    expect(doc.requirements.map((r) => [r.index, r.rawText])).toEqual([
      [1, "甲"],
      [2, "乙"],
      [3, "丙"],
    ]);
  });
});

describe("buildCloseoutDocument 材料目录", () => {
  const withMaterials = () => {
    const base = input();
    const proposal = material({ id: "m-1", code: "1-1", filename: "课题申报书.doc" });
    const report = material({
      id: "m-2",
      code: "1-2",
      kind: "FINAL_REPORT",
      filename: "结项报告.docx",
    });
    const evidence = material({
      id: "m-3",
      code: "2-1",
      kind: "PUBLICATION",
      filename: "见刊页.pdf",
    });

    return {
      ...base,
      project: {
        ...base.project,
        requirements: [
          {
            id: "r-1",
            rawText: "提交结项研究报告一份。",
            requiredCount: 1,
            dueDate: null,
            links: [],
            materials: [{ attachmentId: "m-2", note: "第三章对应本条" }],
          },
        ],
      },
      materialPlan: buildMaterialZipPlan({
        projectMaterials: [proposal, report],
        achievementEvidence: [evidence],
        selectedIds: null,
      }),
    };
  };

  /**
   * 清单上的编号必须能在 ZIP 里找到对应文件，否则这份清单就废了。
   * 两边共用 buildMaterialZipPlan 就是为了这个。
   */
  it("材料编号与 ZIP 内文件名同源", () => {
    const source = withMaterials();
    const doc = buildCloseoutDocument(source);

    expect(doc.materialIndex.map((m) => m.no)).toEqual(["1-1", "1-2", "2-1"]);
    // ZIP 里的文件名以同一个编号开头
    expect(source.materialPlan.entries.map((e) => e.name)).toEqual([
      "1-1_申报书_课题申报书.doc",
      "1-2_结题报告_结项报告.docx",
      "2-1_见刊页_见刊页.pdf",
    ]);
  });

  it("材料目录标出来源，课题材料在前", () => {
    const doc = buildCloseoutDocument(withMaterials());
    expect(doc.materialIndex.map((m) => m.source)).toEqual([
      "课题材料",
      "课题材料",
      "成果证据",
    ]);
  });

  it("要求项下的材料带编号和说明", () => {
    const doc = buildCloseoutDocument(withMaterials());
    expect(doc.requirements[0].materials).toEqual([
      { no: "1-2", kind: "结题报告", filename: "结项报告.docx", note: "第三章对应本条" },
    ]);
  });

  /**
   * 关联的材料刚被删掉时跳过，**不要凭空编一个号**——
   * 清单上的号必须能在包里找到。
   */
  it("关联的材料不在打包范围内时跳过，不造号", () => {
    const source = withMaterials();
    const doc = buildCloseoutDocument({
      ...source,
      project: {
        ...source.project,
        requirements: [
          {
            ...source.project.requirements[0],
            materials: [{ attachmentId: "已删除的", note: null }],
          },
        ],
      },
    });
    expect(doc.requirements[0].materials).toEqual([]);
  });
});

describe("buildCloseoutDocument 页脚", () => {
  it("写明由谁、何时生成，并声明系统不代为判定", () => {
    const doc = buildCloseoutDocument(input());
    expect(doc.footer).toContain("张三");
    expect(doc.footer).toContain("2026-07-31");
    expect(doc.footer).toContain("不代为判定");
  });

  it("没填档案时不留下空的分隔符", () => {
    const doc = buildCloseoutDocument({ ...input(), profile: null });
    expect(doc.footer.startsWith("由高校教师智能工作台生成于")).toBe(true);
  });

  /**
   * generatedAt 是时间戳不是纯日期列，必须按**本地时区**取日期。
   * 按 UTC 取的话，东八区 08:00 前生成的清单会写成前一天——
   * 不抛任何异常，只是日期悄悄错一天（代码约定里 formatTimestampDate 那条）。
   */
  it("凌晨生成的清单写当天，不写成前一天", () => {
    const earlyMorning = new Date(2026, 6, 31, 0, 30);
    const doc = buildCloseoutDocument({ ...input(), generatedAt: earlyMorning });
    expect(doc.footer).toContain("2026-07-31");
  });
});
