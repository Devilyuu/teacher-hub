import { describe, expect, it } from "vitest";
import { PROJECT_STATUS_LABELS } from "@/lib/labels";
import {
  ACHIEVEMENT_STATUS_OPTIONS,
  ACHIEVEMENT_TYPE_OPTIONS,
  ATTACHMENT_KIND_OPTIONS,
} from "@/lib/options";
import { achievementFormSchema, achievementQuickEditSchema } from "./achievement";
import { attachmentKindEnum, attachmentUploadSchema } from "./attachment";
import { qualifyFormSchema, requirementFormSchema } from "./link";
import { projectFormSchema, projectStatusEnum } from "./project";
import { projectPerformanceFormSchema } from "./project-performance";

/**
 * 表单提交的原始形态：值全是字符串，**未勾选的复选框根本不出现在 FormData 里**。
 * 这组用例守住"照着界面填一遍能存下来"这条底线——
 * 曾经因为复选框没写 .optional()，整个成果表单提交不了。
 */

const achievementSubmission = {
  title: "中小制造企业品牌传播研究报告",
  type: "REPORT",
  status: "DRAFTED",
  level: "UNRATED",
  authorPosition: "1",
  ownerRole: "",
  journalName: "",
  journalLevel: "",
  indexedBy: "",
  wordCount: "9400",
  completedAt: "",
  publishedAt: "",
  datePrecision: "MONTH",
  dateText: "2026年9月（拟）",
  tags: "课题结题、年度考核",
  evidenceRef: "",
  obsidianPath: "",
  externalRef: "",
  // 两个职称字段是**必填 key**（值可以是空串）。故意不给它们 .optional()：
  // 漏掉时宁可当场报错，也不能静默把已挂好的指标清成 null
  promotionCategoryId: "",
  promotionScore: "",
  perfCategoryId: "",
  declaredScore: "",
  note: "",
};

describe("achievementFormSchema", () => {
  it("复选框没勾（key 缺失）也能通过", () => {
    const result = achievementFormSchema.safeParse(achievementSubmission);
    if (!result.success) {
      throw new Error(result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }
    expect(result.data.isVerified).toBe(false);
    expect(result.data.wordCount).toBe(9400);
    expect(result.data.tags).toEqual(["课题结题", "年度考核"]);
    expect(result.data.journalLevel).toBeNull();
    expect(result.data.ownerRole).toBeNull();
  });

  it("勾了「信息已核实」传 on", () => {
    const result = achievementFormSchema.safeParse({ ...achievementSubmission, isVerified: "on" });
    expect(result.success && result.data.isVerified).toBe(true);
  });

  it("日期转成 UTC 纯日期，不差一天", () => {
    const result = achievementFormSchema.safeParse({
      ...achievementSubmission,
      publishedAt: "2026-09-30",
    });
    expect(result.success && result.data.publishedAt?.toISOString()).toBe(
      "2026-09-30T00:00:00.000Z",
    );
  });

  it("标签支持顿号与中英文逗号混用", () => {
    const result = achievementFormSchema.safeParse({
      ...achievementSubmission,
      tags: "课题结题、职称评审,年度考核，课程建设",
    });
    expect(result.success && result.data.tags).toEqual([
      "课题结题",
      "职称评审",
      "年度考核",
      "课程建设",
    ]);
  });

  it("题目为空时报中文错", () => {
    const result = achievementFormSchema.safeParse({ ...achievementSubmission, title: "  " });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe("请填写成果题目");
  });

  it("两个分类留空都是 null——「不计入」是有意义的一档，不是没填", () => {
    const result = achievementFormSchema.safeParse(achievementSubmission);
    expect(result.success && result.data.promotionCategoryId).toBeNull();
    expect(result.success && result.data.promotionScore).toBeNull();
    expect(result.success && result.data.perfCategoryId).toBeNull();
    expect(result.success && result.data.declaredScore).toBeNull();
  });

  // 两套坐标系，一条成果可以同时属于两边——这不是互斥的
  it("职称指标和绩效分类可以同时挂", () => {
    const result = achievementFormSchema.safeParse({
      ...achievementSubmission,
      promotionCategoryId: "pc_5_1",
      promotionScore: "1",
      perfCategoryId: "perf_lunwen",
      declaredScore: "8",
    });
    expect(result.success && result.data.promotionCategoryId).toBe("pc_5_1");
    expect(result.success && result.data.perfCategoryId).toBe("perf_lunwen");
    expect(result.success && result.data.promotionScore).toBe(1);
    expect(result.success && result.data.declaredScore).toBe(8);
  });

  it("职称分接受小数与负数——赋分细则里有 0.1，也有「扣3分」", () => {
    const decimal = achievementFormSchema.safeParse({
      ...achievementSubmission,
      promotionScore: "1.2",
    });
    expect(decimal.success && decimal.data.promotionScore).toBe(1.2);

    const negative = achievementFormSchema.safeParse({
      ...achievementSubmission,
      promotionScore: "-3",
    });
    expect(negative.success && negative.data.promotionScore).toBe(-3);
  });

  it("职称分填了非数字要报错", () => {
    const result = achievementFormSchema.safeParse({
      ...achievementSubmission,
      promotionScore: "六分",
    });
    expect(result.success).toBe(false);
  });

  /**
   * 这条守的是一个**故意的严格**：两个职称字段没给 .optional()。
   * 漏渲染时当场报错，好过静默把人花一小时挂好的指标清成 null——
   * 所以每个表单在隐藏分支里也必须把它们作为 hidden input 带上。
   */
  it("漏传职称字段会报错，而不是静默清空", () => {
    const withoutPromotion: Record<string, string> = { ...achievementSubmission };
    delete withoutPromotion.promotionCategoryId;
    delete withoutPromotion.promotionScore;
    delete withoutPromotion.perfCategoryId;
    delete withoutPromotion.declaredScore;
    const result = achievementFormSchema.safeParse(withoutPromotion);
    expect(result.success).toBe(false);
  });
});

describe("projectFormSchema", () => {
  const submission = {
    title: "中小制造企业数字化品牌传播的现状与对策研究",
    shortTitle: "",
    code: "MZRK2026-118",
    level: "MUNICIPAL",
    category: "RESEARCH",
    fundingType: "VERTICAL",
    sourceId: "src_kejiju",
    newSourceName: "",
    hostUnit: "",
    ownerOrder: "",
    memberCount: "",
    role: "LEAD",
    status: "ONGOING",
    applyDeadline: "",
    startDate: "",
    endDate: "",
    closingDeadline: "2026-09-30",
    promotionCategoryId: "",
    promotionScore: "",
    researchContent: "",
    note: "",
  };

  it("空字段转成 null 而不是空串", () => {
    const result = projectFormSchema.safeParse(submission);
    expect(result.success && result.data.shortTitle).toBeNull();
    expect(result.success && result.data.startDate).toBeNull();
  });

  it("纵向 / 横向是独立字段，与研究类型互不干扰", () => {
    const result = projectFormSchema.safeParse({
      ...submission,
      fundingType: "HORIZONTAL",
      category: "RESEARCH",
    });
    // 横向项目同样可以是科研，这两栏不该互相覆盖
    expect(result.success && result.data.fundingType).toBe("HORIZONTAL");
    expect(result.success && result.data.category).toBe("RESEARCH");
  });

  it("级别枚举里不再有「横向」", () => {
    const result = projectFormSchema.safeParse({ ...submission, level: "HORIZONTAL" });
    expect(result.success).toBe(false);
  });

  it("排名与人数解析成数字", () => {
    const result = projectFormSchema.safeParse({
      ...submission,
      ownerOrder: "3",
      memberCount: "6",
    });
    expect(result.success && result.data.ownerOrder).toBe(3);
    expect(result.success && result.data.memberCount).toBe(6);
  });

  it("排名留空是 null，不是 0", () => {
    const result = projectFormSchema.safeParse({ ...submission, ownerOrder: "", memberCount: "" });
    expect(result.success && result.data.ownerOrder).toBeNull();
    expect(result.success && result.data.memberCount).toBeNull();
  });

  // 台账里出现「7/6」多半是打错了
  it("排名大于总人数时报错", () => {
    const result = projectFormSchema.safeParse({
      ...submission,
      ownerOrder: "7",
      memberCount: "6",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("不能大于"))).toBe(true);
    }
  });

  it("只填排名不填总数也允许", () => {
    const result = projectFormSchema.safeParse({ ...submission, ownerOrder: "3", memberCount: "" });
    expect(result.success && result.data.ownerOrder).toBe(3);
  });

  it("排名不接受 0 与负数", () => {
    expect(projectFormSchema.safeParse({ ...submission, ownerOrder: "0" }).success).toBe(false);
    expect(projectFormSchema.safeParse({ ...submission, ownerOrder: "-1" }).success).toBe(false);
  });

  it("现场新增来源时 sourceId 留空", () => {
    const result = projectFormSchema.safeParse({
      ...submission,
      sourceId: "",
      newSourceName: "明州市社科联",
    });
    expect(result.success && result.data.sourceId).toBeNull();
    expect(result.success && result.data.newSourceName).toBe("明州市社科联");
  });

  it("结题截止日按 UTC 存", () => {
    const result = projectFormSchema.safeParse(submission);
    expect(result.success && result.data.closingDeadline?.toISOString()).toBe(
      "2026-09-30T00:00:00.000Z",
    );
  });

  it("日期格式不对时报错", () => {
    const result = projectFormSchema.safeParse({ ...submission, closingDeadline: "2026/9/30" });
    expect(result.success).toBe(false);
  });

  // 一个课题一行：5.2 是「每项加 N 分」，不是立项一次结题一次
  it("课题也能挂职称指标与分值", () => {
    const result = projectFormSchema.safeParse({
      ...submission,
      promotionCategoryId: "pc_5_2",
      promotionScore: "2",
    });
    expect(result.success && result.data.promotionCategoryId).toBe("pc_5_2");
    expect(result.success && result.data.promotionScore).toBe(2);
  });
});

describe("projectPerformanceFormSchema", () => {
  const submission = {
    kind: "APPROVED",
    year: "2026",
    perfCategoryId: "perf_project",
    declaredScore: "",
  };

  it.each(["APPLY", "APPROVED", "FUNDING", "CLOSEOUT", "OTHER"])(
    "accepts the persisted %s kind",
    (kind) => {
      const result = projectPerformanceFormSchema.safeParse({ ...submission, kind });
      expect(result.success && result.data.kind).toBe(kind);
    },
  );

  it("parses a trimmed four-digit year and accepts both supported boundaries", () => {
    const middle = projectPerformanceFormSchema.safeParse(submission);
    expect(middle.success && middle.data.year).toBe(2026);
    const trimmed = projectPerformanceFormSchema.safeParse({ ...submission, year: " 2026 " });
    expect(trimmed.success && trimmed.data.year).toBe(2026);
    expect(
      projectPerformanceFormSchema.safeParse({ ...submission, year: "2000" }).success,
    ).toBe(true);
    expect(
      projectPerformanceFormSchema.safeParse({ ...submission, year: "2100" }).success,
    ).toBe(true);
  });

  it("rejects non-decimal syntax, unsupported years, and non-string input", () => {
    for (const year of [
      "1999",
      "2101",
      "0x7ea",
      "2e3",
      "+2026",
      "2026.5",
      "不详",
    ]) {
      expect(
        projectPerformanceFormSchema.safeParse({ ...submission, year }).success,
        `year=${year}`,
      ).toBe(false);
    }
    expect(
      projectPerformanceFormSchema.safeParse({ ...submission, year: 2026 }).success,
    ).toBe(false);
  });

  it("requires a real performance category id", () => {
    expect(
      projectPerformanceFormSchema.safeParse({ ...submission, perfCategoryId: "" })
        .success,
    ).toBe(false);
    expect(
      projectPerformanceFormSchema.safeParse({ ...submission, perfCategoryId: "   " })
        .success,
    ).toBe(false);
  });

  it("uses the shared optional-score convention", () => {
    const empty = projectPerformanceFormSchema.safeParse(submission);
    expect(empty.success && empty.data.declaredScore).toBeNull();

    const decimal = projectPerformanceFormSchema.safeParse({
      ...submission,
      declaredScore: "1.2",
    });
    expect(decimal.success && decimal.data.declaredScore).toBe(1.2);

    const negative = projectPerformanceFormSchema.safeParse({
      ...submission,
      declaredScore: "-3",
    });
    expect(negative.success && negative.data.declaredScore).toBe(-3);

    const upperBoundary = projectPerformanceFormSchema.safeParse({
      ...submission,
      declaredScore: "9999.99",
    });
    expect(upperBoundary.success && upperBoundary.data.declaredScore).toBe(9999.99);

    const lowerBoundary = projectPerformanceFormSchema.safeParse({
      ...submission,
      declaredScore: "-9999.99",
    });
    expect(lowerBoundary.success && lowerBoundary.data.declaredScore).toBe(-9999.99);
  });

  it("rejects score syntax or precision that Decimal(6,2) cannot store", () => {
    for (const declaredScore of [
      "10000",
      "-10000",
      "1.234",
      "0x10",
      "1e2",
      "+1",
      "NaN",
      "Infinity",
      "六分",
    ]) {
      expect(
        projectPerformanceFormSchema.safeParse({ ...submission, declaredScore }).success,
        `declaredScore=${declaredScore}`,
      ).toBe(false);
    }
  });

  it("rejects event kinds outside the persisted enum", () => {
    expect(
      projectPerformanceFormSchema.safeParse({ ...submission, kind: "PUBLISHED" })
        .success,
    ).toBe(false);
  });
});

describe("requirementFormSchema", () => {
  const submission = {
    rawText: "10月15日前提交研究报告，重复率不超过25%。",
    allowedTypes: "REPORT",
    requiredCount: "1",
    dueDate: "2026-09-30",
    constraints: '{"maxDupRate": 20}',
  };

  it("正常提交", () => {
    const result = requirementFormSchema.safeParse(submission);
    expect(result.success && result.data.allowedTypes).toEqual(["REPORT"]);
    expect(result.success && result.data.requiredCount).toBe(1);
    expect(result.success && result.data.constraints).toEqual({ maxDupRate: 20 });
  });

  it("类型多选用逗号分隔", () => {
    const result = requirementFormSchema.safeParse({
      ...submission,
      allowedTypes: "PAPER,TEXTBOOK",
    });
    expect(result.success && result.data.allowedTypes).toEqual(["PAPER", "TEXTBOOK"]);
  });

  it("一个类型都不选 = 不限类型", () => {
    const result = requirementFormSchema.safeParse({ ...submission, allowedTypes: "" });
    expect(result.success && result.data.allowedTypes).toEqual([]);
  });

  it("约束留空当成 {}", () => {
    const result = requirementFormSchema.safeParse({ ...submission, constraints: "" });
    expect(result.success && result.data.constraints).toEqual({});
  });

  it("JSON 写坏了给人话，不抛异常", () => {
    const result = requirementFormSchema.safeParse({
      ...submission,
      constraints: '{"maxDupRate": 20,}',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("JSON 格式有误"))).toBe(true);
    }
  });

  it("约束写成数组也拦下来", () => {
    const result = requirementFormSchema.safeParse({ ...submission, constraints: "[1,2]" });
    expect(result.success).toBe(false);
  });

  // rawText 是真相来源，不许只填结构化约束就存（CLAUDE.md 第 2 条）
  it("原文为空时拒绝保存", () => {
    const result = requirementFormSchema.safeParse({ ...submission, rawText: "   " });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("原文");
    }
  });
});

describe("qualifyFormSchema", () => {
  it("不勾达标时 key 缺失，解析成 false", () => {
    const result = qualifyFormSchema.safeParse({ linkId: "abc", qualifyNote: "" });
    expect(result.success && result.data.isQualified).toBe(false);
    expect(result.success && result.data.qualifyNote).toBeNull();
  });

  it("勾了达标传 on", () => {
    const result = qualifyFormSchema.safeParse({
      linkId: "abc",
      isQualified: "on",
      qualifyNote: "已见刊",
    });
    expect(result.success && result.data.isQualified).toBe(true);
    expect(result.success && result.data.qualifyNote).toBe("已见刊");
  });
});

/**
 * 下拉里摆出来的选项，校验必须全部认。
 *
 * 曾经不认：`AttachmentKind` 后加的 `AWARD_CERTIFICATE`（获奖证书）
 * 补进了 `ATTACHMENT_KIND_LABELS`、跟着出现在下拉里，却没补进 action 里
 * 手抄的 z.enum，选它上传必然失败——而台账里这类材料最多。
 * schema 现在从 labels 派生，这组用例把「选项 = 校验」这条约定钉死。
 */
describe("选项与校验的一致性", () => {
  it("attachmentKindEnum 认下拉里的每一个材料类型", () => {
    for (const option of ATTACHMENT_KIND_OPTIONS) {
      const result = attachmentUploadSchema.safeParse({ kind: option.value, note: "" });
      expect(result.success, `${option.value}（${option.label}）没通过校验`).toBe(true);
    }
  });

  it("attachmentKindEnum 不多认下拉里没有的值", () => {
    expect(attachmentKindEnum.options).toHaveLength(ATTACHMENT_KIND_OPTIONS.length);
    expect([...attachmentKindEnum.options].sort()).toEqual(
      ATTACHMENT_KIND_OPTIONS.map((o) => o.value).sort(),
    );
  });

  // 成果表单的两个枚举眼下是全的，但同样是手抄的。这里只做断言不改实现，
  // 哪天 schema.prisma 加了新类型而这边忘了跟，测试当场红
  it("成果类型下拉与 achievementFormSchema 认的值一一对应", () => {
    for (const option of ACHIEVEMENT_TYPE_OPTIONS) {
      const result = achievementFormSchema.safeParse({
        ...achievementSubmission,
        type: option.value,
      });
      expect(result.success, `${option.value}（${option.label}）没通过校验`).toBe(true);
    }
  });

  it("成果状态下拉与 achievementFormSchema 认的值一一对应", () => {
    for (const option of ACHIEVEMENT_STATUS_OPTIONS) {
      const result = achievementFormSchema.safeParse({
        ...achievementSubmission,
        status: option.value,
      });
      expect(result.success, `${option.value}（${option.label}）没通过校验`).toBe(true);
    }
  });
});

/**
 * 行内订正。梳理几十条成果时全靠它，两套口径的分都在这一行里改。
 */
describe("achievementQuickEditSchema", () => {
  const quickEdit = {
    year: "2026",
    type: "PAPER",
    // 状态和绩效小类是 2.4 补进来的：存量导入的 68 条状态还是「选题」、
    // 大量记录没挂绩效小类，而这两项以前只能在详情页改
    status: "PUBLISHED",
    level: "PROVINCIAL",
    perfCategoryId: "",
    promotionCategoryId: "",
    promotionScore: "",
    declaredScore: "",
    isVerified: "on",
  };

  it("三个复选框都不勾时 key 缺失，解析成 false", () => {
    const result = achievementQuickEditSchema.safeParse({ ...quickEdit, isVerified: undefined });
    expect(result.success && result.data.usableForPerformance).toBe(false);
    expect(result.success && result.data.isVerified).toBe(false);
  });

  it("两套口径的分各自解析，互不影响", () => {
    const result = achievementQuickEditSchema.safeParse({
      ...quickEdit,
      promotionScore: "1.5",
      declaredScore: "18",
    });
    expect(result.success && result.data.promotionScore).toBe(1.5);
    expect(result.success && result.data.declaredScore).toBe(18);
  });

  // 同上面那条「故意的严格」：申报分漏渲染时要当场报错，
  // 而不是把人对着绩效规则填好的分静默清成 null
  it("漏传申报分会报错，而不是静默清空", () => {
    const withoutScore: Record<string, string | undefined> = { ...quickEdit };
    delete withoutScore.declaredScore;
    expect(achievementQuickEditSchema.safeParse(withoutScore).success).toBe(false);
  });

  it("漏传职称字段同样报错", () => {
    const withoutPromotion: Record<string, string | undefined> = { ...quickEdit };
    delete withoutPromotion.promotionScore;
    expect(achievementQuickEditSchema.safeParse(withoutPromotion).success).toBe(false);
  });

  it("申报分留空是 null——「没填分」和「填了 0 分」不是一回事", () => {
    const result = achievementQuickEditSchema.safeParse(quickEdit);
    expect(result.success && result.data.declaredScore).toBeNull();

    const zero = achievementQuickEditSchema.safeParse({ ...quickEdit, declaredScore: "0" });
    expect(zero.success && zero.data.declaredScore).toBe(0);
  });

  // ── 2.4 补进来的两项 ──────────────────────────────────────────────
  //
  // 存量里 68 条状态还是「选题」、大量记录没挂绩效小类，而导出预检会把它们
  // 分别标成「状态存疑」和「填了绩效分却没挂分类」。这两项以前只能进详情页改，
  // 24 条就是 24 次跳转。

  it("状态能在行内改——清存量时最要紧的一项", () => {
    const result = achievementQuickEditSchema.safeParse({ ...quickEdit, status: "PUBLISHED" });
    expect(result.success && result.data.status).toBe("PUBLISHED");
  });

  it("漏传状态会报错，而不是静默把它退回默认值", () => {
    const withoutStatus: Record<string, string | undefined> = { ...quickEdit };
    delete withoutStatus.status;
    expect(achievementQuickEditSchema.safeParse(withoutStatus).success).toBe(false);
  });

  it("绩效小类留空解析成 null，不是空串", () => {
    const result = achievementQuickEditSchema.safeParse(quickEdit);
    expect(result.success && result.data.perfCategoryId).toBeNull();
  });

  it("漏传绩效小类同样报错——理由同职称指标，不能被这一趟清空", () => {
    const withoutPerf: Record<string, string | undefined> = { ...quickEdit };
    delete withoutPerf.perfCategoryId;
    expect(achievementQuickEditSchema.safeParse(withoutPerf).success).toBe(false);
  });
});

/**
 * 未获立项与已终止是两个状态。混成一个，导出年度绩效包时会算错分——
 * 纵向课题按「基本分 3 + 级别分」相加，未获立项只有 3 分，
 * 而立项后终止的仍按级别算（省级 3+15=18），一条差 15 分。
 */
describe("projectStatusEnum", () => {
  it("认得未获立项", () => {
    expect(projectStatusEnum.options).toContain("REJECTED");
  });

  it("未获立项与已终止并存，不是一回事", () => {
    expect(projectStatusEnum.options).toContain("TERMINATED");
    expect(projectStatusEnum.options).toContain("REJECTED");
  });

  it("与中文映射表一一对应，加枚举值时不会漏", () => {
    expect([...projectStatusEnum.options].sort()).toEqual(
      Object.keys(PROJECT_STATUS_LABELS).sort(),
    );
  });
});
