import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const achievementCreate = vi.fn();
  const attachmentUpdateMany = vi.fn();
  const entryUpdate = vi.fn();
  const tx = {
    achievement: { create: achievementCreate },
    attachment: { updateMany: attachmentUpdateMany },
    competitionEntry: { update: entryUpdate },
  };
  return {
    requireSession: vi.fn(),
    revalidatePath: vi.fn(),
    logActivity: vi.fn(),
    transaction: vi.fn(),
    entryFindUnique: vi.fn(),
    achievementCreate,
    attachmentUpdateMany,
    entryUpdate,
    tx,
  };
});

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/server-auth", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/activity", () => ({ logActivity: mocks.logActivity }));
vi.mock("@/lib/db", () => ({
  prisma: {
    competitionEntry: { findUnique: mocks.entryFindUnique },
    $transaction: mocks.transaction,
  },
}));

import { adoptCompetitionEntry } from "@/app/(app)/competitions/actions";
import { IDLE_FORM_STATE } from "@/lib/form-state";

function form(entryId: string): FormData {
  const data = new FormData();
  data.set("entryId", entryId);
  return data;
}

const entry = {
  id: "entry-1",
  year: 2026,
  track: "软件测试赛项",
  level: "PROVINCIAL" as const,
  award: "FIRST" as const,
  awardTitle: "省一等奖",
  awardedAt: new Date(Date.UTC(2026, 5, 18)),
  awardDateText: null,
  awardDatePrecision: "DAY" as const,
  myOrder: 1,
  achievementId: null,
  competition: { name: "职业院校技能大赛" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSession.mockResolvedValue(undefined);
  mocks.entryFindUnique.mockResolvedValue(entry);
  mocks.achievementCreate.mockResolvedValue({ id: "achievement-1" });
  mocks.transaction.mockImplementation(
    async (fn: (tx: typeof mocks.tx) => Promise<unknown>) => fn(mocks.tx),
  );
});

describe("adoptCompetitionEntry", () => {
  it("按奖状原文建成果，落进待核实，分类口径一概不猜", async () => {
    const state = await adoptCompetitionEntry(IDLE_FORM_STATE, form("entry-1"));

    expect(state.ok).toBe(true);
    const data = mocks.achievementCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({
      type: "STUDENT_ACHIEVEMENT",
      title: "指导学生获省一等奖",
      level: "PROVINCIAL",
      year: 2026,
      // 绩效小类和职称指标是两套正交坐标系（第 11 条），系统替人挑必然挑错
      isVerified: false,
      ownerRole: "第1指导教师",
      authorPosition: 1,
    });
    expect(data).not.toHaveProperty("perfCategoryId");
    expect(data).not.toHaveProperty("promotionCategoryId");
  });

  it("只搬获奖证书——通知和报名表是备赛档案，留在参赛记录上", async () => {
    await adoptCompetitionEntry(IDLE_FORM_STATE, form("entry-1"));

    // 两个字段必须在同一条 UPDATE 里：分两步的中间态归属数是 0 或 2，
    // 会被 Attachment_single_owner 当场拒绝整个事务
    expect(mocks.attachmentUpdateMany).toHaveBeenCalledWith({
      where: { competitionEntryId: "entry-1", kind: "AWARD_CERTIFICATE" },
      data: { competitionEntryId: null, achievementId: "achievement-1" },
    });
  });

  it("已经引用过就不再建第二条", async () => {
    mocks.entryFindUnique.mockResolvedValue({ ...entry, achievementId: "achievement-0" });

    const state = await adoptCompetitionEntry(IDLE_FORM_STATE, form("entry-1"));

    expect(state.ok).toBe(true);
    expect(mocks.achievementCreate).not.toHaveBeenCalled();
  });

  it.each([
    ["还没出结果", null],
    ["参赛未获奖", "NONE"],
  ])("%s 时不建成果——没有奖项的记录进了台账没法核实", async (_label, award) => {
    mocks.entryFindUnique.mockResolvedValue({ ...entry, award });

    const state = await adoptCompetitionEntry(IDLE_FORM_STATE, form("entry-1"));

    expect(state.ok).toBe(false);
    expect(mocks.achievementCreate).not.toHaveBeenCalled();
  });

  it("没有奖状原文时按枚举拼标题，模糊获奖日期原样带过去（第 8 条铁律）", async () => {
    mocks.entryFindUnique.mockResolvedValue({
      ...entry,
      award: "SECOND",
      awardTitle: null,
      awardedAt: null,
      awardDateText: "2026年6月",
      awardDatePrecision: "UNKNOWN",
    });

    await adoptCompetitionEntry(IDLE_FORM_STATE, form("entry-1"));

    expect(mocks.achievementCreate.mock.calls[0][0].data).toMatchObject({
      title: "指导学生参加2026年省级职业院校技能大赛软件测试赛项二等奖",
      publishedAt: null,
      dateText: "2026年6月",
      datePrecision: "UNKNOWN",
    });
  });

  it("每次写入前都验签——Server Action 是可直接请求的公开端点", async () => {
    await adoptCompetitionEntry(IDLE_FORM_STATE, form("entry-1"));
    expect(mocks.requireSession).toHaveBeenCalledOnce();
  });
});
