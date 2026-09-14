import { describe, expect, it } from "vitest";
import { ACHIEVEMENT_TYPE_LABELS } from "./labels";
import {
  linkableAchievementTypes,
  rejectedRequirementTypes,
  rejectedRequirementTypesMessage,
} from "./requirement-types";

/** 改动前就能选的那 9 类。它是这次改动的"不许动"基线 */
const BASE = [
  "PAPER",
  "REPORT",
  "TEXTBOOK",
  "CASE",
  "PATENT",
  "SOFTWARE_COPYRIGHT",
  "AWARD",
  "COURSE",
  "OTHER",
];

describe("linkableAchievementTypes · 结题要求能选哪些成果类型", () => {
  it("纵向课题只有基础的 9 类，顺序不变", () => {
    expect(linkableAchievementTypes("VERTICAL")).toEqual(BASE);
  });

  it("横向课题多一个到账经费——合同写着到账多少钱才算完", () => {
    const types = linkableAchievementTypes("HORIZONTAL");
    expect(types).toContain("FUNDING_RECEIPT");
    expect(types.filter((type) => !BASE.includes(type))).toEqual(["FUNDING_RECEIPT"]);
  });

  it("其他永远垫底——它是兜底项，横向多出来的类型不许排到它后面", () => {
    const types = linkableAchievementTypes("HORIZONTAL");
    expect(types[types.length - 1]).toBe("OTHER");
  });

  it("界面名称是「到账经费」，不是「经费到账」", () => {
    expect(ACHIEVEMENT_TYPE_LABELS.FUNDING_RECEIPT).toBe("到账经费");
  });
});

describe("rejectedRequirementTypes · 服务端拿课题真实类型复核", () => {
  it("横向课题保存到账经费，一条都不拒", () => {
    expect(rejectedRequirementTypes("HORIZONTAL", ["FUNDING_RECEIPT", "REPORT"])).toEqual([]);
  });

  it("纵向课题伪造到账经费，挑出来拒掉", () => {
    expect(rejectedRequirementTypes("VERTICAL", ["PAPER", "FUNDING_RECEIPT"])).toEqual([
      "FUNDING_RECEIPT",
    ]);
  });

  it("重复提交同一个类型只报一次", () => {
    expect(rejectedRequirementTypes("VERTICAL", ["FUNDING_RECEIPT", "FUNDING_RECEIPT"])).toEqual([
      "FUNDING_RECEIPT",
    ]);
  });

  it("不限类型（空数组）永远放行", () => {
    expect(rejectedRequirementTypes("VERTICAL", [])).toEqual([]);
    expect(rejectedRequirementTypes("HORIZONTAL", [])).toEqual([]);
  });

  /**
   * 只挡「横向专属」那几类。存量要求项里可能存着当年从别处导进来的类型，
   * 这里一律收紧的话，用户连改一个错别字都保存不了。
   */
  it("不顺手收紧存量：界面上没有的老类型照旧放行", () => {
    expect(rejectedRequirementTypes("VERTICAL", ["MEDIA_REPORT", "TRAINING"])).toEqual([]);
  });
});

describe("rejectedRequirementTypesMessage", () => {
  it("说清是哪个类型、为什么不行", () => {
    const message = rejectedRequirementTypesMessage(["FUNDING_RECEIPT"]);
    expect(message).toContain("到账经费");
    expect(message).toContain("横向");
  });
});
