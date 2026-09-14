import { describe, expect, it } from "vitest";
import {
  achievementStatusLabel,
  ATTACHMENT_KIND_LABELS,
  formatRoleWithRank,
  statusesForAchievementType,
  RECORDING_STATUS_LABELS,
} from "./labels";

describe("RECORDING_STATUS_LABELS", () => {
  it("covers every persisted recording state without exposing enum codes", () => {
    expect(Object.keys(RECORDING_STATUS_LABELS)).toEqual([
      "UPLOADING", "UPLOADED", "TRANSCRIBING", "TRANSCRIBED", "DRAFT_READY",
      "CONFIRMED", "DELETE_PENDING", "AUDIO_DELETED", "FAILED",
    ]);
    expect(RECORDING_STATUS_LABELS.FAILED).toBe("转写失败");
  });
});

describe("statusesForAchievementType", () => {
  it("论文和研究报告走完整生命周期", () => {
    expect(statusesForAchievementType("PAPER")).toHaveLength(13);
    expect(statusesForAchievementType("REPORT")).toHaveLength(13);
  });

  it("其余类型只放 5 档——查重、外审、修回对获奖没有意义", () => {
    for (const type of ["AWARD", "PATENT", "TRAINING", "FUNDING_RECEIPT"] as const) {
      expect(statusesForAchievementType(type), type).toEqual([
        "PLANNED",
        "WRITING",
        "DRAFTED",
        "ACCEPTED",
        "PUBLISHED",
      ]);
    }
  });
});

describe("achievementStatusLabel", () => {
  it("论文类用原生命周期文案", () => {
    expect(achievementStatusLabel("PLANNED", "PAPER")).toBe("选题");
    expect(achievementStatusLabel("PUBLISHED", "PAPER")).toBe("已见刊");
    expect(achievementStatusLabel("UNDER_REVIEW", "REPORT")).toBe("外审中");
  });

  /**
   * 只过滤档位不够。「第四届全省高校网络教育优秀作品推选活动一等奖」
   * 的状态显示成「选题 / 写作中 / 初稿完成 / 已录用 / 已见刊」，五个词没一个说得通。
   */
  it("非论文类换成中性文案", () => {
    expect(achievementStatusLabel("PLANNED", "AWARD")).toBe("计划中");
    expect(achievementStatusLabel("WRITING", "AWARD")).toBe("进行中");
    expect(achievementStatusLabel("DRAFTED", "TRAINING")).toBe("已提交");
    expect(achievementStatusLabel("ACCEPTED", "PATENT")).toBe("已确认");
    expect(achievementStatusLabel("PUBLISHED", "AWARD")).toBe("已完成");
  });

  /**
   * 存量导入给非论文类留下过 SHELVED / REJECTED 这类简版之外的状态。
   * **必须回退到完整文案，不能显示成空白**——那会让人以为数据丢了。
   */
  it("非论文类存着简版之外的状态时回退，不返回空", () => {
    expect(achievementStatusLabel("SHELVED", "AWARD")).toBe("暂缓");
    expect(achievementStatusLabel("REJECTED", "AWARD")).toBe("退稿");
    expect(achievementStatusLabel("INDEXED", "PATENT")).toBe("已收录");
  });
});

describe("formatRoleWithRank", () => {
  it("排名与总数都有时显示 3/6", () => {
    expect(formatRoleWithRank("MEMBER", 3, 6)).toBe("参与 3/6");
    expect(formatRoleWithRank("LEAD", 1, 6)).toBe("主持 1/6");
  });

  it("只有排名时显示「第3」", () => {
    expect(formatRoleWithRank("MEMBER", 3, null)).toBe("参与 第3");
  });

  it("没填排名就只显示角色", () => {
    expect(formatRoleWithRank("LEAD", null, null)).toBe("主持");
    // 只知道总人数不知道自己排第几，说不出有用的话
    expect(formatRoleWithRank("MEMBER", null, 6)).toBe("参与");
  });

  it("第一参与也走同一套", () => {
    expect(formatRoleWithRank("CO_LEAD", 2, 5)).toBe("第一参与 2/5");
  });
});

/**
 * 规格 7.4：课题详情按申报文件、过程证据、参考资料、结题材料等类别分组。
 * 分组顺序就是这份对象的键顺序（`ATTACHMENT_KIND_OPTIONS` 直接派生），
 * 所以顺序是行为不是格式——锁住它，免得以后有人按字母序排一遍，
 * 材料区就从"课题走到哪一步"变成一堆无序标题。
 */
describe("ATTACHMENT_KIND_LABELS", () => {
  it("按课题生命周期排：申报 → 过程 → 结题 → 成果证据 → 参考与教学 → 其他", () => {
    expect(Object.keys(ATTACHMENT_KIND_LABELS)).toEqual([
      "PROPOSAL",
      "APPROVAL",
      "CONTRACT",
      "MIDTERM",
      "PROCESS_EVIDENCE",
      "CHECK_REPORT",
      "FINAL_REPORT",
      "CERTIFICATE",
      "AWARD_CERTIFICATE",
      "ACCEPTANCE",
      "PUBLICATION",
      "INDEX_PROOF",
      "REFERENCE",
      "TEACHING_PLAN",
      "OTHER",
    ]);
  });

  it("其他永远垫底——它是兜底项，排在中间会被当成一个真实类别", () => {
    const keys = Object.keys(ATTACHMENT_KIND_LABELS);
    expect(keys[keys.length - 1]).toBe("OTHER");
  });
});
