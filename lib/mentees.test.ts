import { describe, expect, it } from "vitest";
import { dateOnly } from "./date";
import { isAttachmentKindAllowed } from "./attachment-kinds";
import {
  MENTEE_ADOPT_ATTACHMENT_KINDS,
  buildCaseIndexRows,
  menteeAchievementTitle,
  milestoneDeadlineLabel,
  orderProjectMembers,
  summarizeCaseIndex,
  upcomingMilestoneDeadlines,
  type CaseIndexSource,
  type MilestoneSource,
} from "./mentees";

// 复选框在表单里按姓名排，所以 checked 的顺序永远是「何、周、林、苏、郑」这种编码序——
// 下面的用例故意让它和真实主责不一致，锁住「主责不由编码序决定」
describe("orderProjectMembers", () => {
  it("编辑时什么都不改：原主责和原顺序原样保留（这是 2026-09-23 实测出的 bug）", () => {
    expect(
      orderProjectMembers({ checked: ["he", "zheng"], lead: "zheng", existing: ["zheng", "he"] }),
    ).toEqual(["zheng", "he"]);
  });

  it("表单没带主责时也不按编码序改：沿用原来的主责", () => {
    expect(
      orderProjectMembers({ checked: ["he", "zheng"], lead: null, existing: ["zheng", "he"] }),
    ).toEqual(["zheng", "he"]);
  });

  it("换主责：选中的人排第一，其余人保持原来的相对顺序", () => {
    expect(
      orderProjectMembers({
        checked: ["he", "lin", "zheng"],
        lead: "lin",
        existing: ["zheng", "lin", "he"],
      }),
    ).toEqual(["lin", "zheng", "he"]);
  });

  it("新勾上的人排在原有成员后面，不插队", () => {
    expect(
      orderProjectMembers({ checked: ["he", "su", "zheng"], lead: "zheng", existing: ["zheng", "he"] }),
    ).toEqual(["zheng", "he", "su"]);
  });

  it("原主责被取消勾选：由原顺序里下一个还在的人接", () => {
    expect(
      orderProjectMembers({ checked: ["he", "su"], lead: "zheng", existing: ["zheng", "su", "he"] }),
    ).toEqual(["su", "he"]);
  });

  it("新建：主责以单选为准，没选就是第一个勾的", () => {
    expect(orderProjectMembers({ checked: ["he", "zhou"], lead: "zhou", existing: [] })).toEqual([
      "zhou",
      "he",
    ]);
    expect(orderProjectMembers({ checked: ["he", "zhou"], lead: null, existing: [] })).toEqual([
      "he",
      "zhou",
    ]);
  });

  it("单选指向没勾的人（伪造的表单）不采信", () => {
    expect(orderProjectMembers({ checked: ["he"], lead: "zhou", existing: [] })).toEqual(["he"]);
  });

  it("一个都没勾就是空，重复提交的 id 去重", () => {
    expect(orderProjectMembers({ checked: [], lead: "he", existing: ["he"] })).toEqual([]);
    expect(orderProjectMembers({ checked: ["he", "he"], lead: null, existing: [] })).toEqual(["he"]);
  });
});

const TODAY = dateOnly(2026, 5, 10);

function milestone(overrides: Partial<MilestoneSource> & { id: string }): MilestoneSource {
  return {
    label: "答辩",
    date: dateOnly(2026, 6, 1),
    projectId: `p-${overrides.id}`,
    projectTitle: "非遗纹样生成工具",
    ownerName: "林知远",
    ...overrides,
  };
}

describe("upcomingMilestoneDeadlines", () => {
  it("同一天同一个节点合并成一条，不占满倒计时的名额", () => {
    // 这条是这个函数存在的理由：六个学生同一天答辩，不合并的话
    // 首页倒计时四个名额全被「答辩」占满，结题截止被挤出去
    const items = upcomingMilestoneDeadlines(
      ["a", "b", "c", "d", "e", "f"].map((id) => milestone({ id })),
      TODAY,
    );
    expect(items).toHaveLength(1);
    expect(items[0].count).toBe(6);
    expect(milestoneDeadlineLabel(items[0])).toBe("答辩·6 项");
    // 合并后跳列表页——跳到其中任意一个项目都是在替用户瞎选
    expect(items[0].href).toBe("/mentees/projects");
  });

  it("只有一条时跳那个项目，标题带学生名", () => {
    const [item] = upcomingMilestoneDeadlines([milestone({ id: "a" })], TODAY);
    expect(item.count).toBe(1);
    expect(item.href).toBe("/mentees/projects/p-a");
    expect(milestoneDeadlineLabel(item)).toBe("答辩·林知远");
  });

  it("没挂学生时退回题目，不留空", () => {
    const [item] = upcomingMilestoneDeadlines(
      [milestone({ id: "a", ownerName: null })],
      TODAY,
    );
    expect(milestoneDeadlineLabel(item)).toBe("答辩·非遗纹样生成工具");
  });

  it("过去的节点不进来——答辩不是欠账，发生过就是发生过了", () => {
    // 课题结题截止会显示「已逾期」，因为那件事还欠着；节点不欠
    const items = upcomingMilestoneDeadlines(
      [milestone({ id: "a", date: dateOnly(2026, 5, 9) })],
      TODAY,
    );
    expect(items).toEqual([]);
  });

  it("今天的节点算 0 天，仍然进来", () => {
    const [item] = upcomingMilestoneDeadlines(
      [milestone({ id: "a", date: TODAY })],
      TODAY,
    );
    expect(item.daysLeft).toBe(0);
  });

  it("没填精确日期的进不来（第 8 条铁律：「五月底」不硬转成某一天）", () => {
    expect(upcomingMilestoneDeadlines([milestone({ id: "a", date: null })], TODAY)).toEqual([]);
  });

  it("按剩余天数排序；同一天按节点名稳定排序", () => {
    const items = upcomingMilestoneDeadlines(
      [
        milestone({ id: "a", label: "答辩", date: dateOnly(2026, 6, 1) }),
        milestone({ id: "b", label: "开题", date: dateOnly(2026, 5, 20) }),
        milestone({ id: "c", label: "中期检查", date: dateOnly(2026, 6, 1) }),
      ],
      TODAY,
    );
    // 同一天的两条按拼音序：答(d) 在 中(zh) 前面
    expect(items.map((item) => item.label)).toEqual(["开题", "答辩", "中期检查"]);
    expect(items.map((item) => item.daysLeft)).toEqual([10, 22, 22]);
  });

  it("同一个节点名在不同日期不合并", () => {
    const items = upcomingMilestoneDeadlines(
      [
        milestone({ id: "a", date: dateOnly(2026, 6, 1) }),
        milestone({ id: "b", date: dateOnly(2026, 6, 2) }),
      ],
      TODAY,
    );
    expect(items).toHaveLength(2);
  });
});

// ─── M3：引用为成果 + 案例索引 ──────────────────────────────────────

describe("menteeAchievementTitle", () => {
  it("类型 + 书名号题目 + 冒号 + 结项原文", () => {
    expect(
      menteeAchievementTitle({
        title: "非遗纹样生成工具",
        kindName: "毕业设计",
        outcomeText: "获评校级优秀毕业设计",
      }),
    ).toBe("指导学生毕业设计《非遗纹样生成工具》：获评校级优秀毕业设计");
  });

  it("结项原文不带动词也读得通——冒号隔开，不替人补「获」字", () => {
    expect(
      menteeAchievementTitle({
        title: "非遗纹样生成工具",
        kindName: "毕业设计",
        outcomeText: "校级优秀毕业设计",
      }),
    ).toBe("指导学生毕业设计《非遗纹样生成工具》：校级优秀毕业设计");
  });

  it("题目自己带书名号就不再套一层", () => {
    expect(
      menteeAchievementTitle({
        title: "AI 短片《江南纹样》",
        kindName: "课程作品",
        outcomeText: "入选明州市高校优秀作品联展",
      }),
    ).toBe("指导学生课程作品AI 短片《江南纹样》：入选明州市高校优秀作品联展");
  });

  it("首尾空白去掉", () => {
    expect(
      menteeAchievementTitle({ title: " 题目 ", kindName: " 大创项目 ", outcomeText: " 省级立项 " }),
    ).toBe("指导学生大创项目《题目》：省级立项");
  });
});

describe("MENTEE_ADOPT_ATTACHMENT_KINDS", () => {
  it("跟着成果走的类型，学生项目的上传下拉里都选得到——选不到就永远搬不过去", () => {
    for (const kind of MENTEE_ADOPT_ATTACHMENT_KINDS) {
      expect(isAttachmentKindAllowed("menteeProject", kind)).toBe(true);
    }
  });

  it("过程材料不跟着走：它们是指导档案，不是绩效证据", () => {
    for (const kind of ["PROCESS_EVIDENCE", "MIDTERM", "CHECK_REPORT", "FINAL_REPORT"]) {
      expect(MENTEE_ADOPT_ATTACHMENT_KINDS).not.toContain(kind);
    }
  });
});

function caseSource(overrides: Partial<CaseIndexSource> = {}): CaseIndexSource {
  return {
    title: "非遗纹样生成工具",
    schoolYear: "2025—2026 学年",
    outcomeText: null,
    createdAt: new Date("2026-03-01T00:00:00Z"),
    kind: { name: "毕业设计", sortOrder: 0 },
    batch: { year: 2022 },
    members: [{ mentee: { name: "林知远" } }],
    attachments: [],
    achievement: null,
    ...overrides,
  };
}

describe("buildCaseIndexRows", () => {
  it("一行八列，列头照抄那张空表", () => {
    const [row] = buildCaseIndexRows([
      caseSource({
        outcomeText: "获评校级优秀毕业设计",
        members: [{ mentee: { name: "林知远" } }, { mentee: { name: "苏明宇" } }],
      }),
    ]);
    expect(row).toEqual({
      time: "2025—2026 学年",
      title: "非遗纹样生成工具",
      kind: "毕业设计",
      students: "林知远、苏明宇",
      role: "指导教师",
      outcome: "获评校级优秀毕业设计",
      evidence: "",
      usableFor: "",
    });
  });

  it("没填的留空，不写「未填」——这张表是拿去往申报表里贴的", () => {
    const [row] = buildCaseIndexRows([
      caseSource({ schoolYear: null, outcomeText: null, members: [] }),
    ]);
    expect(row.time).toBe("");
    expect(row.outcome).toBe("");
    expect(row.students).toBe("");
  });

  it("按类型分组，组内届次新的在前、同届按建立时间新的在前", () => {
    const rows = buildCaseIndexRows([
      caseSource({ title: "课程作品甲", kind: { name: "课程作品", sortOrder: 2 } }),
      caseSource({ title: "毕设·老届", batch: { year: 2021 } }),
      caseSource({
        title: "毕设·新届早建",
        batch: { year: 2022 },
        createdAt: new Date("2026-01-01T00:00:00Z"),
      }),
      caseSource({
        title: "毕设·新届晚建",
        batch: { year: 2022 },
        createdAt: new Date("2026-05-01T00:00:00Z"),
      }),
    ]);
    expect(rows.map((row) => row.title)).toEqual([
      "毕设·新届晚建",
      "毕设·新届早建",
      "毕设·老届",
      "课程作品甲",
    ]);
  });

  it("支撑材料按类型数，项目上的和已转到成果上的证书一起数", () => {
    const [row] = buildCaseIndexRows([
      caseSource({
        attachments: [
          { kind: "PROCESS_EVIDENCE" },
          { kind: "MIDTERM" },
          { kind: "PROCESS_EVIDENCE" },
        ],
        achievement: { usableFor: [], attachments: [{ kind: "AWARD_CERTIFICATE" }] },
      }),
    ]);
    expect(row.evidence).toBe("中期检查材料、过程证据 2 份、获奖证书");
  });

  it("「可用于」只读台账上的用途标记，不替人推断", () => {
    const rows = buildCaseIndexRows([
      caseSource({ title: "没引用" }),
      caseSource({
        title: "引用了没标",
        achievement: { usableFor: [], attachments: [] },
      }),
      caseSource({
        title: "引用了标了",
        achievement: { usableFor: ["PERFORMANCE", "PROMOTION"], attachments: [] },
      }),
    ]);
    const byTitle = Object.fromEntries(rows.map((row) => [row.title, row.usableFor]));
    expect(byTitle).toEqual({
      没引用: "",
      引用了没标: "已入台账，用途未标",
      引用了标了: "绩效、职称",
    });
  });
});

describe("summarizeCaseIndex", () => {
  it("按类型字典的顺序数，只数不评", () => {
    expect(
      summarizeCaseIndex([
        caseSource({ kind: { name: "课程作品", sortOrder: 2 } }),
        caseSource(),
        caseSource({ achievement: { usableFor: [], attachments: [] } }),
      ]),
    ).toEqual([
      { kind: "毕业设计", total: 2, adopted: 1 },
      { kind: "课程作品", total: 1, adopted: 0 },
    ]);
  });
});
