import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const achievementCreate = vi.fn();
  const attachmentUpdateMany = vi.fn();
  const projectUpdateMany = vi.fn();
  const tx = {
    achievement: { create: achievementCreate },
    attachment: { updateMany: attachmentUpdateMany },
    menteeProject: { updateMany: projectUpdateMany },
  };
  return {
    projectFindUnique: vi.fn(),
    transaction: vi.fn(),
    achievementCreate,
    attachmentUpdateMany,
    projectUpdateMany,
    tx,
  };
});

vi.mock("@/lib/db", () => ({
  prisma: {
    menteeProject: { findUnique: mocks.projectFindUnique },
    $transaction: mocks.transaction,
  },
}));

import { adoptMenteeProjectAsAchievement } from "@/lib/queries/mentees";

const project = {
  id: "project-1",
  title: "非遗纹样生成工具",
  outcomeText: "获评校级优秀毕业设计",
  achievementId: null,
  kind: { name: "毕业设计" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.projectFindUnique.mockResolvedValue(project);
  mocks.achievementCreate.mockResolvedValue({ id: "achievement-1" });
  mocks.projectUpdateMany.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation(
    async (fn: (tx: typeof mocks.tx) => Promise<unknown>) => fn(mocks.tx),
  );
});

describe("adoptMenteeProjectAsAchievement", () => {
  it("按结项原文拼标题，落进待核实；级别、年度、分类口径一概不填", async () => {
    const result = await adoptMenteeProjectAsAchievement("project-1");

    expect(result).toEqual({ status: "adopted", achievementId: "achievement-1" });
    const data = mocks.achievementCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({
      type: "STUDENT_ACHIEVEMENT",
      title: "指导学生毕业设计《非遗纹样生成工具》：获评校级优秀毕业设计",
      status: "PUBLISHED",
      declareNature: "RESULT",
      ownerRole: "指导教师",
      isVerified: false,
    });
    // 「校级」是原文不是枚举；绩效「优秀毕设」只有校级和学院级有分值，
    // 按级别推分会推出错的（规格 §7.1，第 11 条铁律）
    for (const key of ["level", "year", "perfCategoryId", "promotionCategoryId", "usableFor"]) {
      expect(data).not.toHaveProperty(key);
    }
  });

  it("只搬证书和获奖证书，两个归属字段在同一条 UPDATE 里改", async () => {
    await adoptMenteeProjectAsAchievement("project-1");

    // 分两步的中间态归属数是 0 或 2，会被 Attachment_single_owner 当场拒绝整个事务
    expect(mocks.attachmentUpdateMany).toHaveBeenCalledWith({
      where: {
        menteeProjectId: "project-1",
        kind: { in: ["CERTIFICATE", "AWARD_CERTIFICATE"] },
      },
      data: { menteeProjectId: null, achievementId: "achievement-1" },
    });
  });

  it("回填指针带「还没引用过」的条件——并发的第二次在这里落空", async () => {
    await adoptMenteeProjectAsAchievement("project-1");

    expect(mocks.projectUpdateMany).toHaveBeenCalledWith({
      where: { id: "project-1", achievementId: null },
      data: { achievementId: "achievement-1" },
    });
  });

  it("并发时后到的那次回滚整个事务，报「已经引用过」而不是留一条孤儿成果", async () => {
    mocks.projectUpdateMany.mockResolvedValue({ count: 0 });
    mocks.projectFindUnique
      .mockResolvedValueOnce(project)
      .mockResolvedValueOnce({ achievementId: "achievement-0" });

    const result = await adoptMenteeProjectAsAchievement("project-1");

    expect(result).toEqual({ status: "already-adopted", achievementId: "achievement-0" });
  });

  it("已经引用过就不再建第二条", async () => {
    mocks.projectFindUnique.mockResolvedValue({ ...project, achievementId: "achievement-0" });

    const result = await adoptMenteeProjectAsAchievement("project-1");

    expect(result).toEqual({ status: "already-adopted", achievementId: "achievement-0" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["没填", null],
    ["只有空白", "   "],
  ])("结项情况%s时不建——台账那条拿它当标题", async (_label, outcomeText) => {
    mocks.projectFindUnique.mockResolvedValue({ ...project, outcomeText });

    const result = await adoptMenteeProjectAsAchievement("project-1");

    expect(result).toEqual({ status: "no-outcome" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("项目不在了", async () => {
    mocks.projectFindUnique.mockResolvedValue(null);
    expect(await adoptMenteeProjectAsAchievement("project-x")).toEqual({ status: "not-found" });
  });

  it("别的异常照常抛出，不被当成「已经引用过」吞掉", async () => {
    mocks.achievementCreate.mockRejectedValue(new Error("数据库断了"));
    await expect(adoptMenteeProjectAsAchievement("project-1")).rejects.toThrow("数据库断了");
  });
});
