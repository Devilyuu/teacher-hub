import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  revalidatePath: vi.fn(),
  logActivity: vi.fn(),
  projectFindUnique: vi.fn(),
  requirementFindFirst: vi.fn(),
  requirementFindUnique: vi.fn(),
  requirementCreate: vi.fn(),
  requirementUpdate: vi.fn(),
  requirementDelete: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/server-auth", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/activity", () => ({ logActivity: mocks.logActivity }));
vi.mock("@/lib/db", () => ({
  prisma: {
    project: { findUnique: mocks.projectFindUnique },
    requirement: {
      findFirst: mocks.requirementFindFirst,
      findUnique: mocks.requirementFindUnique,
      create: mocks.requirementCreate,
      update: mocks.requirementUpdate,
      delete: mocks.requirementDelete,
    },
  },
}));

import {
  createRequirement,
  deleteRequirement,
  updateRequirement,
} from "@/app/(app)/projects/[id]/requirement-actions";

function requirementForm(overrides: Record<string, string> = {}) {
  const form = new FormData();
  const fields = {
    rawText: "合同约定研发经费 20 万元分两期到账，结题时须提供到账凭证",
    allowedTypes: "FUNDING_RECEIPT",
    requiredCount: "1",
    dueDate: "",
    constraints: "",
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

/** 拒绝时必须什么都没发生：不写库、不记日志、不刷缓存 */
function expectNothingHappened() {
  expect(mocks.requirementCreate).not.toHaveBeenCalled();
  expect(mocks.requirementUpdate).not.toHaveBeenCalled();
  expect(mocks.requirementDelete).not.toHaveBeenCalled();
  expect(mocks.logActivity).not.toHaveBeenCalled();
  expect(mocks.revalidatePath).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSession.mockResolvedValue(undefined);
  mocks.projectFindUnique.mockResolvedValue({ fundingType: "HORIZONTAL" });
  mocks.requirementFindFirst.mockResolvedValue({ sortOrder: 2 });
  mocks.requirementFindUnique.mockResolvedValue({
    projectId: "project-1",
    rawText: "旧要求原文",
    links: [],
    project: { fundingType: "HORIZONTAL" },
  });
  mocks.requirementCreate.mockResolvedValue({ id: "requirement-1" });
  mocks.requirementUpdate.mockResolvedValue({ id: "requirement-1" });
  mocks.requirementDelete.mockResolvedValue({ id: "requirement-1" });
  mocks.logActivity.mockResolvedValue(undefined);
});

describe("createRequirement", () => {
  it("横向课题能把到账经费存进结题要求", async () => {
    const result = await createRequirement("project-1", { ok: false }, requirementForm());

    expect(mocks.projectFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "project-1" } }),
    );
    expect(mocks.requirementCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        allowedTypes: ["FUNDING_RECEIPT"],
        sortOrder: 3,
      }),
    });
    expect(result).toMatchObject({ ok: true });
  });

  it("纵向课题伪造到账经费，当场拒掉", async () => {
    mocks.projectFindUnique.mockResolvedValueOnce({ fundingType: "VERTICAL" });

    const result = await createRequirement("project-1", { ok: false }, requirementForm());

    expect(result.ok).toBe(false);
    expect(result.message).toContain("到账经费");
    expect(result.fieldErrors?.allowedTypes?.length).toBeGreaterThan(0);
    expectNothingHappened();
  });

  it("纵向课题的其他类型照常保存——只挡横向专属那一档", async () => {
    mocks.projectFindUnique.mockResolvedValueOnce({ fundingType: "VERTICAL" });

    const result = await createRequirement(
      "project-1",
      { ok: false },
      requirementForm({ allowedTypes: "PAPER,REPORT" }),
    );

    expect(result).toMatchObject({ ok: true });
    expect(mocks.requirementCreate).toHaveBeenCalledOnce();
  });

  it("课题不存在就不许建要求项", async () => {
    mocks.projectFindUnique.mockResolvedValueOnce(null);

    await expect(
      createRequirement("project-1", { ok: false }, requirementForm()),
    ).resolves.toMatchObject({ ok: false, message: "课题不存在" });
    expectNothingHappened();
  });

  it("表单本身没填对时不查库", async () => {
    const result = await createRequirement(
      "project-1",
      { ok: false },
      requirementForm({ rawText: "  " }),
    );

    expect(mocks.requireSession).toHaveBeenCalledOnce();
    expect(result.ok).toBe(false);
    expect(mocks.projectFindUnique).not.toHaveBeenCalled();
    expectNothingHappened();
  });
});

describe("updateRequirement", () => {
  it("横向课题下的要求项能改成到账经费", async () => {
    const result = await updateRequirement(
      "requirement-1",
      "project-1",
      { ok: false },
      requirementForm(),
    );

    expect(mocks.requirementUpdate).toHaveBeenCalledWith({
      where: { id: "requirement-1" },
      data: expect.objectContaining({ allowedTypes: ["FUNDING_RECEIPT"] }),
    });
    expect(result).toMatchObject({ ok: true });
  });

  it("课题类型以库里的为准，不信表单来路", async () => {
    mocks.requirementFindUnique.mockResolvedValueOnce({
      projectId: "project-1",
      project: { fundingType: "VERTICAL" },
    });

    const result = await updateRequirement(
      "requirement-1",
      "project-1",
      { ok: false },
      requirementForm(),
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("到账经费");
    expectNothingHappened();
  });

  /** requirementId 来自页面绑定，projectId 也是——凑一对别人的照样得拒 */
  it("要求项不属于这个课题就拒绝", async () => {
    mocks.requirementFindUnique.mockResolvedValueOnce({
      projectId: "project-2",
      project: { fundingType: "HORIZONTAL" },
    });

    await expect(
      updateRequirement("requirement-1", "project-1", { ok: false }, requirementForm()),
    ).resolves.toMatchObject({ ok: false, message: "找不到这条结题要求项" });
    expectNothingHappened();
  });

  it("要求项已被删掉时给一句人话", async () => {
    mocks.requirementFindUnique.mockResolvedValueOnce(null);

    await expect(
      updateRequirement("requirement-1", "project-1", { ok: false }, requirementForm()),
    ).resolves.toMatchObject({ ok: false, message: "找不到这条结题要求项" });
    expectNothingHappened();
  });
});

describe("deleteRequirement", () => {
  it("删本课题的要求项，顺带记下原文和被牵连的挂接数", async () => {
    await deleteRequirement("requirement-1", "project-1");

    expect(mocks.requirementDelete).toHaveBeenCalledWith({ where: { id: "requirement-1" } });
    expect(mocks.logActivity).toHaveBeenCalledWith(
      "Requirement",
      "requirement-1",
      "删除结题要求项",
      expect.objectContaining({ projectId: "project-1", rawText: "旧要求原文" }),
    );
  });

  it("要求项属于别的课题就一动不动", async () => {
    mocks.requirementFindUnique.mockResolvedValueOnce({
      projectId: "project-2",
      rawText: "别人家的要求",
      links: [],
      project: { fundingType: "HORIZONTAL" },
    });

    await deleteRequirement("requirement-1", "project-1");

    expectNothingHappened();
  });
});
