import { describe, expect, it } from "vitest";
import { canUseForPromotion, isSchoolRewarded } from "@/lib/school-rewards";
import { schoolRewardFormSchema } from "@/lib/schemas/school-reward";

const validSubmission = {
  approvedAt: "2026-07-30",
  batch: "2026 年第一批",
  domain: "RESEARCH",
  awardItem: "市级社科课题优秀成果",
  awardLevel: "一等奖",
  awardAmountYuan: "3000.50",
  evidenceRef: "常机电〔2026〕18号",
  note: "学校会议审定通过",
};

describe("school reward exclusion", () => {
  it("one approved decision permanently excludes performance", () => {
    expect(isSchoolRewarded([{ id: "reward-1" }])).toBe(true);
    expect(isSchoolRewarded([])).toBe(false);
  });

  it("does not imply title-review exclusion", () => {
    expect(
      canUseForPromotion({ promotionCategoryId: "5.2", schoolRewarded: true }),
    ).toBe(true);
    expect(
      canUseForPromotion({ promotionCategoryId: null, schoolRewarded: false }),
    ).toBe(false);
  });
});

describe("schoolRewardFormSchema", () => {
  it("parses an approved fact and stores the approval date as a UTC date-only value", () => {
    const result = schoolRewardFormSchema.safeParse(validSubmission);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.approvedAt.toISOString()).toBe("2026-07-30T00:00:00.000Z");
    expect(result.data.awardAmountYuan).toBe(3000.5);
  });

  it("turns optional blank fields into null", () => {
    const result = schoolRewardFormSchema.safeParse({
      ...validSubmission,
      batch: "",
      awardLevel: " ",
      awardAmountYuan: "",
      evidenceRef: "",
      note: "",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({
      batch: null,
      awardLevel: null,
      awardAmountYuan: null,
      evidenceRef: null,
      note: null,
    });
  });

  it("requires a real award item and one of the persisted domains", () => {
    expect(
      schoolRewardFormSchema.safeParse({ ...validSubmission, awardItem: "   " }).success,
    ).toBe(false);
    expect(
      schoolRewardFormSchema.safeParse({ ...validSubmission, domain: "PROJECT_LEVEL" })
        .success,
    ).toBe(false);
  });

  it("rejects invalid dates and amounts that Decimal(12,2) cannot store", () => {
    for (const approvedAt of ["", "2026/07/30", "2026-02-30"]) {
      expect(
        schoolRewardFormSchema.safeParse({ ...validSubmission, approvedAt }).success,
        `approvedAt=${approvedAt}`,
      ).toBe(false);
    }

    for (const awardAmountYuan of [
      "-1",
      "1.234",
      "10000000000",
      "1e3",
      "0x10",
      "三千",
    ]) {
      expect(
        schoolRewardFormSchema.safeParse({ ...validSubmission, awardAmountYuan })
          .success,
        `awardAmountYuan=${awardAmountYuan}`,
      ).toBe(false);
    }
  });
});
