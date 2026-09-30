import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 学业导师模块写入口（app/(app)/mentees/actions.ts）的行为测试。
 *
 * 707 行、到 09-26 为止一条单测都没有，而 09-24 那个「从上线起就建不成批次」的线上 bug
 * 就出在这里。表单与 schema 的键对不对得上由 lib/schemas/form-contract.test.ts 管；
 * 这里管动作自己的规矩：**每个测试只喂表单真会提交的键**（CLAUDE.md 代码约定）。
 * 事务本体（引用为成果、连带删只提到他一人的记录）在 lib/queries/mentees.ts，
 * 由 `npm run verify:mentor-module` 在真库上验。
 */

const mocks = vi.hoisted(() => {
  const tx = {
    menteeBatch: { count: vi.fn(), create: vi.fn() },
    menteeRecordType: { createMany: vi.fn() },
    menteeProjectKind: { createMany: vi.fn() },
  };
  return {
    tx,
    requireSession: vi.fn(),
    revalidatePath: vi.fn(),
    redirect: vi.fn(),
    deleteUpload: vi.fn(),
    transaction: vi.fn(),
    batchFindUnique: vi.fn(),
    menteeCount: vi.fn(),
    menteeFindMany: vi.fn(),
    menteeCreateMany: vi.fn(),
    recordCreate: vi.fn(),
    recordCount: vi.fn(),
    recordTypeDelete: vi.fn(),
    projectFindUnique: vi.fn(),
    projectCreate: vi.fn(),
    projectDelete: vi.fn(),
    kindFindUnique: vi.fn(),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/server-auth", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/storage", () => ({ deleteUpload: mocks.deleteUpload }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: mocks.transaction,
    menteeBatch: { findUnique: mocks.batchFindUnique },
    mentee: { count: mocks.menteeCount, findMany: mocks.menteeFindMany, createMany: mocks.menteeCreateMany },
    menteeRecord: { create: mocks.recordCreate, count: mocks.recordCount },
    menteeRecordType: { delete: mocks.recordTypeDelete },
    menteeProject: {
      findUnique: mocks.projectFindUnique,
      create: mocks.projectCreate,
      delete: mocks.projectDelete,
    },
    menteeProjectKind: { findUnique: mocks.kindFindUnique },
  },
}));

import {
  bulkImportMentees,
  createMenteeBatch,
  createMenteeProject,
  createMenteeRecord,
  deleteMenteeProject,
  deleteMenteeRecordType,
} from "@/app/(app)/mentees/actions";
import { IDLE_FORM_STATE } from "@/lib/form-state";

function form(entries: Array<[string, string]>): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSession.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation(async (fn: (tx: typeof mocks.tx) => Promise<unknown>) => fn(mocks.tx));
  mocks.tx.menteeBatch.create.mockResolvedValue({ id: "batch-new" });
  mocks.batchFindUnique.mockResolvedValue(null);
});

describe("createMenteeBatch", () => {
  // 建批次的表单只有批次名和年份两个框（batch-empty.tsx），就喂这两个——09-24 的单测多喂了 note，把 bug 盖住了
  const batchForm = () => form([["name", "2025艺术设计"], ["year", "2025"]]);

  it("只凭表单那两个框就能建成，建完跳到新批次", async () => {
    mocks.tx.menteeBatch.count.mockResolvedValue(0);

    await createMenteeBatch(IDLE_FORM_STATE, batchForm());

    expect(mocks.tx.menteeBatch.create).toHaveBeenCalledWith({
      data: { name: "2025艺术设计", year: 2025 },
      select: { id: true },
    });
    expect(mocks.redirect).toHaveBeenCalledWith("/mentees?batch=batch-new");
  });

  it("建第一批时补种两张默认字典", async () => {
    mocks.tx.menteeBatch.count.mockResolvedValue(0);
    await createMenteeBatch(IDLE_FORM_STATE, batchForm());
    expect(mocks.tx.menteeRecordType.createMany).toHaveBeenCalledOnce();
    expect(mocks.tx.menteeProjectKind.createMany).toHaveBeenCalledOnce();
  });

  /** skipDuplicates 只防重复不防复活：用户删掉的默认类型不能每建一批就种回来 */
  it("之后再建批次不再补种字典", async () => {
    mocks.tx.menteeBatch.count.mockResolvedValue(2);
    await createMenteeBatch(IDLE_FORM_STATE, batchForm());
    expect(mocks.tx.menteeRecordType.createMany).not.toHaveBeenCalled();
    expect(mocks.tx.menteeProjectKind.createMany).not.toHaveBeenCalled();
  });

  it("同名批次不重复建，照实说", async () => {
    mocks.batchFindUnique.mockResolvedValue({ id: "batch-old" });
    const state = await createMenteeBatch(IDLE_FORM_STATE, batchForm());
    expect(state.message).toBe("「2025艺术设计」已经建过了");
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe("createMenteeRecord", () => {
  const recordForm = (extra: Array<[string, string]> = []) =>
    form([["typeId", "type-1"], ["date", "2026-09-20"], ["content", "聊了选题"], ...extra]);

  beforeEach(() => {
    mocks.batchFindUnique.mockResolvedValue({ id: "batch-1" });
    mocks.recordCreate.mockResolvedValue({ projectId: null });
  });

  /** 这一批还没有项目时，表单根本不渲染「围绕哪个项目」——键缺席也得能记（09-24 第二处） */
  it("新批次里没有项目下拉，照样记得上第一条", async () => {
    mocks.menteeCount.mockResolvedValue(1);

    const state = await createMenteeRecord("batch-1", IDLE_FORM_STATE, recordForm([["mentees", "m1"]]));

    expect(state.ok).toBe(true);
    expect(mocks.recordCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ batchId: "batch-1", projectId: null, members: { create: [{ menteeId: "m1" }] } }),
      select: { projectId: true },
    });
  });

  /** 拿库里的 batchId 复核，不信表单：跨批次的成员会让「这一届的记录」永远筛不干净 */
  it("勾选的学生里有别的批次的，整条拒绝", async () => {
    mocks.menteeCount.mockResolvedValue(1);
    const state = await createMenteeRecord(
      "batch-1",
      IDLE_FORM_STATE,
      recordForm([["mentees", "m1"], ["mentees", "m-other-batch"]]),
    );
    expect(state).toMatchObject({ ok: false, message: "勾选的学生里有不在这一批的，请刷新后重试" });
    expect(mocks.menteeCount).toHaveBeenCalledWith({
      where: { id: { in: ["m1", "m-other-batch"] }, batchId: "batch-1" },
    });
    expect(mocks.recordCreate).not.toHaveBeenCalled();
  });

  it("挂的项目不在这一批，整条拒绝", async () => {
    mocks.projectFindUnique.mockResolvedValue({ batchId: "batch-2" });
    const state = await createMenteeRecord("batch-1", IDLE_FORM_STATE, recordForm([["projectId", "p-other"]]));
    expect(state).toMatchObject({ ok: false, message: "这个项目不在这一批里，刷新后重试" });
    expect(mocks.recordCreate).not.toHaveBeenCalled();
  });

  it("批次已经没了就不记", async () => {
    mocks.batchFindUnique.mockResolvedValue(null);
    const state = await createMenteeRecord("gone", IDLE_FORM_STATE, recordForm());
    expect(state).toMatchObject({ ok: false, message: "批次不存在" });
  });
});

describe("deleteMenteeRecordType", () => {
  it("还有记录在用就不删，说清有几条", async () => {
    mocks.recordCount.mockResolvedValue(3);
    const state = await deleteMenteeRecordType("type-1");
    expect(state).toMatchObject({ ok: false, message: "还有 3 条记录是这个类型，先改掉它们" });
    expect(mocks.recordTypeDelete).not.toHaveBeenCalled();
  });

  it("没人用了才删", async () => {
    mocks.recordCount.mockResolvedValue(0);
    const state = await deleteMenteeRecordType("type-1");
    expect(state.ok).toBe(true);
    expect(mocks.recordTypeDelete).toHaveBeenCalledWith({ where: { id: "type-1" } });
  });
});

describe("bulkImportMentees", () => {
  /** 双选名单整表重复粘贴是常态：已在名单里的跳过，块内重复也只进一次 */
  it("已在名单里的和块内重复的都跳过，照实报数", async () => {
    mocks.batchFindUnique.mockResolvedValue({ id: "batch-1" });
    mocks.menteeFindMany.mockResolvedValue([{ name: "张三" }]);

    const state = await bulkImportMentees(
      "batch-1",
      IDLE_FORM_STATE,
      form([["lines", "张三\n李四\n李四\n王五"]]),
    );

    const created = mocks.menteeCreateMany.mock.calls[0][0].data.map((row: { name: string }) => row.name);
    expect(created).toEqual(["李四", "王五"]);
    expect(state.message).toBe("导入 2 人，2 人已在名单里跳过");
  });

  it("一个都没解析出来时不写库", async () => {
    mocks.batchFindUnique.mockResolvedValue({ id: "batch-1" });
    const state = await bulkImportMentees("batch-1", IDLE_FORM_STATE, form([["lines", "   ,\t"]]));
    expect(state.ok).toBe(false);
    expect(mocks.menteeCreateMany).not.toHaveBeenCalled();
  });
});

describe("createMenteeProject", () => {
  beforeEach(() => {
    mocks.batchFindUnique.mockResolvedValue({ id: "batch-1" });
    mocks.kindFindUnique.mockResolvedValue({ id: "kind-1" });
    mocks.menteeCount.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.length);
  });

  const projectForm = (extra: Array<[string, string]>) =>
    form([
      ["title", "本地生活服务 APP 交互改版"],
      ["kindId", "kind-1"],
      ["schoolYear", ""],
      ["outcomeText", ""],
      ["note", ""],
      ...extra,
    ]);

  /** 主责明着选：编码最小的人不该因为复选框按姓名排就成了主责（CLAUDE.md 导师模块） */
  it("「主责」单选的那个人排第一，其余保持复选框顺序", async () => {
    await createMenteeProject(
      "batch-1",
      IDLE_FORM_STATE,
      projectForm([["mentees", "m1"], ["mentees", "m2"], ["mentees", "m3"], ["lead", "m3"]]),
    );
    expect(mocks.projectCreate.mock.calls[0][0].data.members.create).toEqual([
      { menteeId: "m3", orderIndex: 0 },
      { menteeId: "m1", orderIndex: 1 },
      { menteeId: "m2", orderIndex: 2 },
    ]);
  });

  it("成员里有别的批次的学生，整个项目不建", async () => {
    mocks.menteeCount.mockResolvedValue(1);
    const state = await createMenteeProject(
      "batch-1",
      IDLE_FORM_STATE,
      projectForm([["mentees", "m1"], ["mentees", "m-other"]]),
    );
    expect(state.ok).toBe(false);
    expect(mocks.projectCreate).not.toHaveBeenCalled();
  });

  it("项目类型被删了就不建，让人刷新", async () => {
    mocks.kindFindUnique.mockResolvedValue(null);
    const state = await createMenteeProject("batch-1", IDLE_FORM_STATE, projectForm([]));
    expect(state).toMatchObject({ ok: false, message: "项目类型不存在，刷新后重试" });
  });
});

describe("deleteMenteeProject", () => {
  /** 那条成果还在台账里，项目一没就查不到「这个优秀毕设是哪个题目、哪几个学生」 */
  it("已引用为成果的项目不给删", async () => {
    mocks.projectFindUnique.mockResolvedValue({ title: "某毕设", achievementId: "a1", attachments: [] });
    const state = await deleteMenteeProject("p1");
    expect(state.ok).toBe(false);
    expect(mocks.projectDelete).not.toHaveBeenCalled();
  });

  /** 材料记录跟着级联删，磁盘文件不会——删完库再逐个清盘 */
  it("删库之后把材料的磁盘文件也清掉", async () => {
    mocks.projectFindUnique.mockResolvedValue({
      title: "某毕设",
      achievementId: null,
      attachments: [{ storagePath: "2026/a" }, { storagePath: "2026/b" }],
    });
    const order: string[] = [];
    mocks.projectDelete.mockImplementation(async () => order.push("db"));
    mocks.deleteUpload.mockImplementation(async (path: string) => order.push(path));

    const state = await deleteMenteeProject("p1");

    expect(state).toMatchObject({ ok: true, message: "已删除「某毕设」" });
    expect(order).toEqual(["db", "2026/a", "2026/b"]);
  });
});
