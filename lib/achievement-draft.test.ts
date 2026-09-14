import { describe, expect, it } from "vitest";
import { projectDisplayName } from "@/lib/achievement-draft";

const base = {
  title: "职业院校数字化教学资源共建共享机制研究",
  shortTitle: "资源共建共享",
};

describe("projectDisplayName", () => {
  it("优先用简称", () => {
    expect(projectDisplayName(base)).toBe("资源共建共享");
  });

  it("没有简称时回落到全称", () => {
    expect(projectDisplayName({ ...base, shortTitle: null })).toBe(base.title);
  });

  it("简称是空白串也回落到全称", () => {
    expect(projectDisplayName({ ...base, shortTitle: "   " })).toBe(base.title);
  });
});
