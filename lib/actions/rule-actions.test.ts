import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 规则表导入动作：**同一个动作提交两次**——第一次只回显预览，带着预览给的键再提交才写库；
 * 键对不上（预览之后改过表格或列的设置）就退回一份新预览，不写。
 * 写库本身（lib/rules/apply.ts）和计划、对比（lib/import、lib/rules/preview）各有单测，这里只锁流程。
 */
const mocks = vi.hoisted(() => {
  const tx = {
    promotionRuleset: { upsert: vi.fn() },
    promotionCategory: { findMany: vi.fn(), upsert: vi.fn() },
    perfCategory: { findMany: vi.fn(), upsert: vi.fn() },
  };
  return {
    requireSession: vi.fn(),
    revalidatePath: vi.fn(),
    logActivity: vi.fn(),
    transaction: vi.fn(),
    rulesetFindUnique: vi.fn(),
    rulesetFindFirst: vi.fn(),
    promotionFindMany: vi.fn(),
    perfFindFirst: vi.fn(),
    tx,
  };
});

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/server-auth", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/activity", () => ({ logActivity: mocks.logActivity }));
vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: mocks.transaction,
    promotionRuleset: { findUnique: mocks.rulesetFindUnique, findFirst: mocks.rulesetFindFirst },
    promotionCategory: { findMany: mocks.promotionFindMany },
    perfCategory: { findFirst: mocks.perfFindFirst },
  },
}));

import { importPastedRules, type RuleImportState } from "./rule-actions";

const TABLE = ["一级指标\t二级指标\t赋分标准\t上限", "教学工作\t课程建设\t国家级8分\t10", "\t教学竞赛\t一等奖5分\t8"].join("\n");

function pasteForm(over: { roles?: string[]; mode?: string; planKey?: string; hasHeader?: boolean; text?: string } = {}) {
  const form = new FormData();
  form.set("table", "promotion");
  form.set("year", "2027");
  form.set("source", "");
  form.set("text", over.text ?? TABLE);
  if (over.hasHeader ?? true) form.set("hasHeader", "on");
  for (const role of over.roles ?? ["major", "minor", "rule", "cap"]) form.append("roles", role);
  if (over.mode) form.set("mode", over.mode);
  if (over.planKey) form.set("planKey", over.planKey);
  return form;
}

const IDLE: RuleImportState = { ok: false };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSession.mockResolvedValue(undefined);
  mocks.rulesetFindUnique.mockResolvedValue(null);
  mocks.rulesetFindFirst.mockResolvedValue({ year: 2026 });
  mocks.promotionFindMany.mockResolvedValue([]);
  mocks.transaction.mockImplementation(async (callback: (tx: typeof mocks.tx) => Promise<unknown>) =>
    callback(mocks.tx),
  );
  mocks.tx.promotionCategory.findMany.mockResolvedValue([]);
});

describe("importPastedRules", () => {
  it("先鉴权，再干别的", async () => {
    mocks.requireSession.mockRejectedValueOnce(new Error("未登录"));
    await expect(importPastedRules(IDLE, pasteForm())).rejects.toThrow("未登录");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("第一次提交只回显预览，不写库", async () => {
    const state = await importPastedRules(IDLE, pasteForm());
    expect(state.ok).toBe(false);
    expect(state.preview).toMatchObject({ table: "promotion", year: 2027 });
    expect(state.preview?.diff.counts).toEqual({ new: 2, changed: 0, same: 0 });
    expect(state.preview?.notes.join()).toMatch(/改用 2027 版/);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("带着预览给的键再提交才写库，写完整站刷新", async () => {
    const preview = await importPastedRules(IDLE, pasteForm());
    const state = await importPastedRules(preview, pasteForm({ mode: "confirm", planKey: preview.preview!.key }));
    expect(state.ok).toBe(true);
    expect(state.message).toBe("已导入 2027 版职称量化表：新增 2 条，更新 0 条");
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.tx.promotionRuleset.upsert).toHaveBeenCalledOnce();
    expect(mocks.tx.promotionCategory.upsert).toHaveBeenCalledTimes(2);
    expect(mocks.logActivity).toHaveBeenCalledWith(
      "RuleTable",
      "promotion:2027",
      "rules.import",
      expect.objectContaining({ via: "paste", created: 2 }),
      mocks.tx,
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("预览之后改了列的设置（键对不上）：退回按现在的内容算的新预览，不写", async () => {
    const preview = await importPastedRules(IDLE, pasteForm());
    const state = await importPastedRules(
      preview,
      pasteForm({ mode: "confirm", planKey: preview.preview!.key, roles: ["major", "minor", "remark", "cap"] }),
    );
    expect(state.ok).toBe(false);
    expect(state.tone).toBe("warning");
    expect(state.message).toMatch(/改过了/);
    expect(state.preview?.key).not.toBe(preview.preview!.key);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("预览之后取消了「第一行是表头」也算改过——2026-09-27 那个表单重置的坑就是这样暴露的", async () => {
    const preview = await importPastedRules(IDLE, pasteForm());
    const state = await importPastedRules(
      preview,
      pasteForm({ mode: "confirm", planKey: preview.preview!.key, hasHeader: false }),
    );
    expect(state.ok).toBe(false);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("列的设置不合法时直接说哪里不对", async () => {
    const state = await importPastedRules(IDLE, pasteForm({ roles: ["major", "rule", "rule", "cap"] }));
    expect(state).toMatchObject({ ok: false, message: "要指定哪一列是「二级指标」" });
    expect(state.preview).toBeUndefined();
  });

  it("一条都没认出来时给一句人话", async () => {
    const state = await importPastedRules(IDLE, pasteForm({ text: "一级指标\t二级指标\n\t\n", roles: ["major", "minor"] }));
    expect(state.ok).toBe(false);
    expect(state.message).toMatch(/一条也没认出来/);
  });

  it("库里这一年已有表头：整表说明和系列总分沿用，不被粘贴导入冲掉", async () => {
    mocks.rulesetFindUnique.mockResolvedValue({
      year: 2027,
      source: "明湖职业技术学院职称评审量化表（虚构）",
      generalNotes: ["同一成果只按一项计分"],
      teacherTotal: 18,
      labTotal: 18,
      ideologyTotal: 18,
      eduAdminTotal: 18,
    });
    const preview = await importPastedRules(IDLE, pasteForm());
    expect(preview.preview?.source).toBe("明湖职业技术学院职称评审量化表（虚构）");
    await importPastedRules(preview, pasteForm({ mode: "confirm", planKey: preview.preview!.key }));
    expect(mocks.tx.promotionRuleset.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ generalNotes: ["同一成果只按一项计分"], teacherTotal: 18 }),
      }),
    );
  });
});
